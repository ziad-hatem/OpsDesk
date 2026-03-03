import { randomBytes, createHash, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const CUSTOMER_PORTAL_SESSION_COOKIE = "opsdesk_customer_portal";
export const CUSTOMER_PORTAL_LOGIN_LINK_TTL_MINUTES = 20;
export const CUSTOMER_PORTAL_SESSION_TTL_DAYS = 14;

type CustomerPortalSessionRow = {
  id: string;
  organization_id: string;
  customer_id: string;
  email: string;
  expires_at: string;
  revoked_at: string | null;
};

type PortalCustomerRow = {
  id: string;
  organization_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: "active" | "inactive" | "blocked";
};

type PortalOrganizationRow = {
  id: string;
  name: string;
};

type CustomerPortalIdentityRow = {
  customer_id: string;
  organization_id: string;
  user_id: string;
};

type UserRow = {
  id: string;
};

export interface CustomerPortalContext {
  sessionId: string;
  sessionToken: string;
  organizationId: string;
  customerId: string;
  email: string;
  customer: PortalCustomerRow;
  organization: PortalOrganizationRow;
}

function normalizeBaseUrl(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export function getCustomerPortalBaseUrl(): string {
  const baseUrl =
    process.env.NEXTAUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000";
  return normalizeBaseUrl(baseUrl);
}

export function normalizePortalEmail(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
    ? normalized
    : null;
}

export function generatePortalToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashPortalToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function buildCustomerPortalVerifyLink(token: string): string {
  return `${getCustomerPortalBaseUrl()}/api/portal/auth/verify?token=${encodeURIComponent(token)}`;
}

export function getPortalLoginLinkExpiresAt(): string {
  const expiresAt = new Date(
    Date.now() + CUSTOMER_PORTAL_LOGIN_LINK_TTL_MINUTES * 60 * 1000,
  );
  return expiresAt.toISOString();
}

export function getPortalSessionExpiresAt(): string {
  const expiresAt = new Date(
    Date.now() + CUSTOMER_PORTAL_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
  return expiresAt.toISOString();
}

export function setCustomerPortalSessionCookie(
  response: NextResponse,
  token: string,
  expiresAtIso: string,
): void {
  response.cookies.set(CUSTOMER_PORTAL_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAtIso),
  });
}

export function clearCustomerPortalSessionCookie(response: NextResponse): void {
  response.cookies.delete(CUSTOMER_PORTAL_SESSION_COOKIE);
}

export function isMissingCustomerPortalSchema(
  error: { message?: string } | null | undefined,
  tableName?: string,
): boolean {
  const message = (error?.message ?? "").toLowerCase();
  if (!message) {
    return false;
  }

  if (tableName) {
    return (
      message.includes(tableName.toLowerCase()) &&
      (message.includes("schema cache") || message.includes("does not exist"))
    );
  }

  return (
    message.includes("customer_portal") &&
    (message.includes("schema cache") || message.includes("does not exist"))
  );
}

function getSyntheticPortalUserEmail(customerId: string): string {
  return `portal+${customerId.replace(/-/g, "")}@customers.opsdesk.local`;
}

export async function ensureCustomerPortalIdentityUser(params: {
  organizationId: string;
  customerId: string;
  customerName: string;
}): Promise<string> {
  const { organizationId, customerId, customerName } = params;
  const supabase = createSupabaseAdminClient();

  const { data: existingIdentity, error: existingIdentityError } = await supabase
    .from("customer_portal_identities")
    .select("customer_id, organization_id, user_id")
    .eq("organization_id", organizationId)
    .eq("customer_id", customerId)
    .maybeSingle<CustomerPortalIdentityRow>();

  if (existingIdentityError) {
    throw new Error(`Failed to load customer portal identity: ${existingIdentityError.message}`);
  }

  if (existingIdentity?.user_id) {
    return existingIdentity.user_id;
  }

  const syntheticEmail = getSyntheticPortalUserEmail(customerId);
  const { data: existingUser, error: existingUserError } = await supabase
    .from("users")
    .select("id")
    .eq("email", syntheticEmail)
    .maybeSingle<UserRow>();

  if (existingUserError) {
    throw new Error(`Failed to verify customer portal identity user: ${existingUserError.message}`);
  }

  let userId = existingUser?.id ?? "";
  if (!userId) {
    userId = randomUUID();
    const { error: insertUserError } = await supabase.from("users").insert({
      id: userId,
      email: syntheticEmail,
      name: `${customerName} (Customer)`,
      avatar_url: null,
    });

    if (insertUserError) {
      throw new Error(`Failed to create customer portal identity user: ${insertUserError.message}`);
    }
  }

  const { data: upsertedIdentity, error: upsertIdentityError } = await supabase
    .from("customer_portal_identities")
    .upsert(
      {
        customer_id: customerId,
        organization_id: organizationId,
        user_id: userId,
      },
      { onConflict: "customer_id" },
    )
    .select("customer_id, organization_id, user_id")
    .maybeSingle<CustomerPortalIdentityRow>();

  if (upsertIdentityError) {
    throw new Error(`Failed to create customer portal identity: ${upsertIdentityError.message}`);
  }

  return upsertedIdentity?.user_id ?? userId;
}

export async function getCustomerPortalContext(
  options: { touch?: boolean } = {},
): Promise<CustomerPortalContext | null> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(CUSTOMER_PORTAL_SESSION_COOKIE)?.value?.trim() ?? "";
  if (!sessionToken) {
    return null;
  }

  const supabase = createSupabaseAdminClient();
  const tokenHash = hashPortalToken(sessionToken);

  const { data: session, error: sessionError } = await supabase
    .from("customer_portal_sessions")
    .select("id, organization_id, customer_id, email, expires_at, revoked_at")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .maybeSingle<CustomerPortalSessionRow>();

  if (sessionError || !session) {
    return null;
  }

  const expiresAtTime = new Date(session.expires_at).getTime();
  if (!Number.isFinite(expiresAtTime) || expiresAtTime <= Date.now()) {
    return null;
  }

  const [{ data: customer }, { data: organization }] = await Promise.all([
    supabase
      .from("customers")
      .select("id, organization_id, name, email, phone, status")
      .eq("id", session.customer_id)
      .eq("organization_id", session.organization_id)
      .maybeSingle<PortalCustomerRow>(),
    supabase
      .from("organizations")
      .select("id, name")
      .eq("id", session.organization_id)
      .maybeSingle<PortalOrganizationRow>(),
  ]);

  if (!customer || !organization || customer.status === "blocked") {
    return null;
  }

  if (options.touch !== false) {
    await supabase
      .from("customer_portal_sessions")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", session.id);
  }

  return {
    sessionId: session.id,
    sessionToken,
    organizationId: session.organization_id,
    customerId: session.customer_id,
    email: session.email,
    customer,
    organization,
  };
}

