import { cookies } from "next/headers";
import { auth } from "@/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { ACTIVE_ORG_COOKIE } from "@/lib/topbar/constants";

type MembershipRow = {
  organization_id: string;
};

export interface TicketRequestContext {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  userId: string;
  activeOrgId: string | null;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

export async function getTicketRequestContext(): Promise<
  { ok: true; context: TicketRequestContext } | { ok: false; status: number; error: string }
> {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const supabase = createSupabaseAdminClient();
  const { data: authUserResult, error: authUserError } =
    await supabase.auth.admin.getUserById(session.user.id);

  if (authUserError || !authUserResult.user?.email) {
    return { ok: false, status: 500, error: "Failed to read current user profile" };
  }

  const authUser = authUserResult.user;
  const authEmail = authUser.email;
  if (!authEmail) {
    return { ok: false, status: 500, error: "Current user email is missing" };
  }

  const firstName = normalizeText(authUser.user_metadata?.first_name);
  const lastName = normalizeText(authUser.user_metadata?.last_name);
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  const fallbackName = authEmail.split("@")[0];

  const { error: ensureUserError } = await supabase.from("users").upsert(
    {
      id: session.user.id,
      email: authEmail,
      name: fullName || fallbackName,
      avatar_url:
        typeof authUser.user_metadata?.avatar_url === "string"
          ? authUser.user_metadata.avatar_url
          : null,
    },
    { onConflict: "id" },
  );

  if (ensureUserError) {
    return {
      ok: false,
      status: 500,
      error: `Failed to sync user profile: ${ensureUserError.message}`,
    };
  }

  const { data: membershipsData, error: membershipsError } = await supabase
    .from("organization_memberships")
    .select("organization_id")
    .eq("user_id", session.user.id)
    .returns<MembershipRow[]>();

  if (membershipsError) {
    return {
      ok: false,
      status: 500,
      error: `Failed to load organization memberships: ${membershipsError.message}`,
    };
  }

  const orgIds = (membershipsData ?? []).map((membership) => membership.organization_id);
  const cookieStore = await cookies();
  const activeOrgFromCookie = cookieStore.get(ACTIVE_ORG_COOKIE)?.value ?? null;
  const activeOrgId =
    activeOrgFromCookie && orgIds.includes(activeOrgFromCookie)
      ? activeOrgFromCookie
      : orgIds[0] ?? null;

  return {
    ok: true,
    context: {
      supabase,
      userId: session.user.id,
      activeOrgId,
    },
  };
}
