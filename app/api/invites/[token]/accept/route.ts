import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/server/audit-logs";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isMissingTeamSchema, missingTeamSchemaMessage } from "@/lib/team/errors";
import { hashInviteToken, normalizeInviteToken } from "@/lib/team/invite-token";
import { normalizeEmail } from "@/lib/team/validation";
import type { OrganizationRole } from "@/lib/topbar/types";

type RouteContext = {
  params: Promise<{ token: string }>;
};

type AcceptInviteBody = {
  firstName?: string;
  lastName?: string;
  password?: string;
};

type InviteRow = {
  id: string;
  organization_id: string;
  email: string;
  role: OrganizationRole;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
};

type OrganizationRow = {
  id: string;
  name: string;
};

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

async function resolveToken(context: RouteContext): Promise<string | null> {
  const params = await context.params;
  return normalizeInviteToken(params.token);
}

export async function POST(req: Request, context: RouteContext) {
  const token = await resolveToken(context);
  if (!token) {
    return NextResponse.json({ error: "Invalid invite token" }, { status: 400 });
  }

  let body: AcceptInviteBody;
  try {
    body = (await req.json()) as AcceptInviteBody;
  } catch {
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }

  const firstName = normalizeName(body.firstName);
  const lastName = normalizeName(body.lastName);
  const password = typeof body.password === "string" ? body.password : "";

  if (!firstName || !lastName) {
    return NextResponse.json(
      { error: "First name and last name are required" },
      { status: 400 },
    );
  }

  if (password.length < 6) {
    return NextResponse.json(
      { error: "Password must be at least 6 characters" },
      { status: 400 },
    );
  }

  const tokenHash = hashInviteToken(token);
  const now = new Date();
  const nowIso = now.toISOString();
  const supabase = createSupabaseAdminClient();

  const { data: inviteData, error: inviteError } = await supabase
    .from("organization_invites")
    .select("id, organization_id, email, role, expires_at, accepted_at, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle<InviteRow>();

  if (inviteError) {
    if (isMissingTeamSchema(inviteError)) {
      return NextResponse.json({ error: missingTeamSchemaMessage() }, { status: 500 });
    }
    return NextResponse.json(
      { error: `Failed to verify invite: ${inviteError.message}` },
      { status: 500 },
    );
  }

  if (!inviteData || inviteData.revoked_at || inviteData.accepted_at) {
    return NextResponse.json({ error: "Invite is not valid" }, { status: 404 });
  }

  if (new Date(inviteData.expires_at).getTime() <= now.getTime()) {
    return NextResponse.json({ error: "Invite has expired" }, { status: 410 });
  }

  const { data: organizationData, error: organizationError } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("id", inviteData.organization_id)
    .maybeSingle<OrganizationRow>();

  if (organizationError || !organizationData) {
    return NextResponse.json(
      {
        error: organizationError
          ? `Failed to load organization: ${organizationError.message}`
          : "Organization not found for this invite",
      },
      { status: 500 },
    );
  }

  const inviteEmail = normalizeEmail(inviteData.email);
  if (!inviteEmail) {
    return NextResponse.json(
      { error: "Invite email is invalid. Ask the inviter to resend." },
      { status: 500 },
    );
  }

  const { data: createdAuthUserData, error: createAuthUserError } =
    await supabase.auth.admin.createUser({
      email: inviteEmail,
      password,
      email_confirm: true,
      user_metadata: {
        first_name: firstName,
        last_name: lastName,
        company: organizationData.name,
        created_from_invite: true,
        invited_organization_id: inviteData.organization_id,
        invited_role: inviteData.role,
      },
    });

  if (createAuthUserError || !createdAuthUserData.user?.id) {
    const errorMessage =
      createAuthUserError?.message ?? "Failed to create account from invite";

    if (errorMessage.toLowerCase().includes("already")) {
      return NextResponse.json(
        {
          error:
            "An account already exists for this invited email. Sign in with that email to continue.",
        },
        { status: 409 },
      );
    }

    return NextResponse.json({ error: errorMessage }, { status: 400 });
  }

  const authUserId = createdAuthUserData.user.id;
  const fullName = `${firstName} ${lastName}`.trim();

  const { error: syncUserError } = await supabase.from("users").upsert(
    {
      id: authUserId,
      email: inviteEmail,
      name: fullName,
      avatar_url: null,
    },
    { onConflict: "id" },
  );

  if (syncUserError) {
    await supabase.auth.admin.deleteUser(authUserId);
    return NextResponse.json(
      { error: `Failed to finalize profile: ${syncUserError.message}` },
      { status: 500 },
    );
  }

  const { error: membershipError } = await supabase
    .from("organization_memberships")
    .insert({
      organization_id: inviteData.organization_id,
      user_id: authUserId,
      role: inviteData.role,
      status: "active",
      joined_at: nowIso,
      updated_at: nowIso,
    });

  if (membershipError) {
    await supabase.auth.admin.deleteUser(authUserId);
    return NextResponse.json(
      { error: `Failed to join organization: ${membershipError.message}` },
      { status: 500 },
    );
  }

  const { error: acceptInviteError } = await supabase
    .from("organization_invites")
    .update({ accepted_at: nowIso })
    .eq("id", inviteData.id)
    .is("accepted_at", null)
    .is("revoked_at", null);

  if (acceptInviteError) {
    return NextResponse.json(
      {
        error: `Account created and membership added, but failed to mark invite accepted: ${acceptInviteError.message}`,
      },
      { status: 500 },
    );
  }

  await writeAuditLog({
    supabase,
    organizationId: inviteData.organization_id,
    actorUserId: authUserId,
    action: "team.invite.accepted",
    entityType: "organization_membership",
    entityId: authUserId,
    details: {
      invitedRole: inviteData.role,
      invitedEmail: inviteData.email,
    },
  });

  return NextResponse.json(
    {
      success: true,
      email: inviteEmail,
      organizationId: inviteData.organization_id,
      organizationName: organizationData.name,
      role: inviteData.role,
    },
    { status: 201 },
  );
}
