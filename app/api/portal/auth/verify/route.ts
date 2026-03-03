import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  clearCustomerPortalSessionCookie,
  generatePortalToken,
  getPortalSessionExpiresAt,
  hashPortalToken,
  isMissingCustomerPortalSchema,
  setCustomerPortalSessionCookie,
} from "@/lib/server/customer-portal-auth";
import { missingTableMessageWithMigration } from "@/lib/tickets/errors";

type LoginLinkRow = {
  id: string;
  organization_id: string;
  customer_id: string;
  email: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
};

type CustomerRow = {
  id: string;
  status: "active" | "inactive" | "blocked";
};

function normalizeToken(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function redirectToSignIn(request: Request, code: string) {
  const signInUrl = new URL("/portal/sign-in", request.url);
  signInUrl.searchParams.set("error", code);
  return NextResponse.redirect(signInUrl);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = normalizeToken(searchParams.get("token"));
  if (!token) {
    return redirectToSignIn(req, "invalid_link");
  }

  const supabase = createSupabaseAdminClient();
  const tokenHash = hashPortalToken(token);

  const { data: loginLink, error: loginLinkError } = await supabase
    .from("customer_portal_login_links")
    .select("id, organization_id, customer_id, email, expires_at, used_at, revoked_at")
    .eq("token_hash", tokenHash)
    .is("used_at", null)
    .is("revoked_at", null)
    .maybeSingle<LoginLinkRow>();

  if (loginLinkError) {
    if (isMissingCustomerPortalSchema(loginLinkError, "customer_portal_login_links")) {
      return NextResponse.json(
        {
          error: missingTableMessageWithMigration(
            "customer_portal_login_links",
            "db/customer-portal-schema.sql",
          ),
        },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { error: `Failed to verify customer portal token: ${loginLinkError.message}` },
      { status: 500 },
    );
  }

  if (!loginLink) {
    return redirectToSignIn(req, "invalid_or_expired");
  }

  const expiresAtTime = new Date(loginLink.expires_at).getTime();
  if (!Number.isFinite(expiresAtTime) || expiresAtTime <= Date.now()) {
    return redirectToSignIn(req, "invalid_or_expired");
  }

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select("id, status")
    .eq("id", loginLink.customer_id)
    .eq("organization_id", loginLink.organization_id)
    .maybeSingle<CustomerRow>();

  if (customerError) {
    return NextResponse.json(
      { error: `Failed to validate customer portal access: ${customerError.message}` },
      { status: 500 },
    );
  }

  if (!customer || customer.status === "blocked") {
    return redirectToSignIn(req, "customer_blocked");
  }

  const nowIso = new Date().toISOString();
  const { error: markUsedError } = await supabase
    .from("customer_portal_login_links")
    .update({ used_at: nowIso })
    .eq("id", loginLink.id);

  if (markUsedError) {
    return NextResponse.json(
      { error: `Failed to finalize customer portal sign-in: ${markUsedError.message}` },
      { status: 500 },
    );
  }

  const sessionToken = generatePortalToken();
  const sessionTokenHash = hashPortalToken(sessionToken);
  const sessionExpiresAt = getPortalSessionExpiresAt();
  const { error: createSessionError } = await supabase
    .from("customer_portal_sessions")
    .insert({
      organization_id: loginLink.organization_id,
      customer_id: loginLink.customer_id,
      email: loginLink.email,
      token_hash: sessionTokenHash,
      expires_at: sessionExpiresAt,
      last_seen_at: nowIso,
    });

  if (createSessionError) {
    if (isMissingCustomerPortalSchema(createSessionError, "customer_portal_sessions")) {
      return NextResponse.json(
        {
          error: missingTableMessageWithMigration(
            "customer_portal_sessions",
            "db/customer-portal-schema.sql",
          ),
        },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { error: `Failed to create customer portal session: ${createSessionError.message}` },
      { status: 500 },
    );
  }

  const redirectUrl = new URL("/portal", req.url);
  const response = NextResponse.redirect(redirectUrl);
  clearCustomerPortalSessionCookie(response);
  setCustomerPortalSessionCookie(response, sessionToken, sessionExpiresAt);

  return response;
}

