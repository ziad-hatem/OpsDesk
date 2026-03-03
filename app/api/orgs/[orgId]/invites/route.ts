import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getOrganizationActorContext } from "@/lib/server/organization-context";
import { writeAuditLog } from "@/lib/server/audit-logs";
import {
  buildInviteLink,
  sendTeamInviteEmail,
} from "@/lib/server/team-invite-email";
import { isMissingTeamSchema, missingTeamSchemaMessage } from "@/lib/team/errors";
import type { TeamInvite } from "@/lib/team/types";
import {
  canManageInviteRole,
  getRolePermissions,
  isOrganizationRole,
  normalizeEmail,
} from "@/lib/team/validation";
import type { OrganizationRole } from "@/lib/topbar/types";

type RouteContext = {
  params: Promise<{ orgId: string }>;
};

type InviteBody = {
  email?: string;
  role?: unknown;
};

type InviteRow = {
  id: string;
  email: string;
  role: OrganizationRole;
  invited_by: string;
  expires_at: string;
  created_at: string;
};

type UserRow = {
  id: string;
  name: string | null;
};

type OrganizationRow = {
  id: string;
  name: string;
};

async function resolveOrgId(context: RouteContext): Promise<string> {
  const params = await context.params;
  return params.orgId?.trim() ?? "";
}

export async function POST(req: Request, context: RouteContext) {
  const orgId = await resolveOrgId(context);
  const actorContextResult = await getOrganizationActorContext(orgId);
  if (!actorContextResult.ok) {
    return NextResponse.json(
      { error: actorContextResult.error },
      { status: actorContextResult.status },
    );
  }

  const {
    supabase,
    userId,
    actorMembership: { role: actorRole },
  } = actorContextResult.context;

  const rolePermissions = getRolePermissions(actorRole);
  if (!rolePermissions.canInvite) {
    return NextResponse.json(
      { error: "You do not have permission to invite members" },
      { status: 403 },
    );
  }

  let body: InviteBody;
  try {
    body = (await req.json()) as InviteBody;
  } catch {
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }

  const email = normalizeEmail(body.email);
  if (!email) {
    return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
  }

  if (!isOrganizationRole(body.role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }
  const role = body.role;

  if (!canManageInviteRole(actorRole, role)) {
    return NextResponse.json(
      { error: "You do not have permission to invite this role" },
      { status: 403 },
    );
  }

  const { data: existingUser, error: existingUserError } = await supabase
    .from("users")
    .select("id")
    .ilike("email", email)
    .maybeSingle<{ id: string }>();

  if (existingUserError) {
    return NextResponse.json(
      { error: `Failed to verify member state: ${existingUserError.message}` },
      { status: 500 },
    );
  }

  if (existingUser?.id) {
    const { count: existingMembershipCount, error: existingMembershipError } =
      await supabase
        .from("organization_memberships")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("user_id", existingUser.id);

    if (existingMembershipError) {
      if (isMissingTeamSchema(existingMembershipError)) {
        return NextResponse.json(
          { error: missingTeamSchemaMessage() },
          { status: 500 },
        );
      }
      return NextResponse.json(
        { error: `Failed to verify member state: ${existingMembershipError.message}` },
        { status: 500 },
      );
    }

    if ((existingMembershipCount ?? 0) > 0) {
      return NextResponse.json(
        { error: "This user is already a member of the organization" },
        { status: 409 },
      );
    }
  }

  const { data: pendingInvites, error: pendingInvitesError } = await supabase
    .from("organization_invites")
    .select("id, expires_at")
    .eq("organization_id", orgId)
    .eq("email", email)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .returns<Array<{ id: string; expires_at: string }>>();

  if (pendingInvitesError) {
    if (isMissingTeamSchema(pendingInvitesError)) {
      return NextResponse.json({ error: missingTeamSchemaMessage() }, { status: 500 });
    }
    return NextResponse.json(
      { error: `Failed to verify existing invites: ${pendingInvitesError.message}` },
      { status: 500 },
    );
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const hasUnexpiredPendingInvite = (pendingInvites ?? []).some(
    (invite) => new Date(invite.expires_at).getTime() > now.getTime(),
  );
  if (hasUnexpiredPendingInvite) {
    return NextResponse.json(
      { error: "A pending invite already exists for this email" },
      { status: 409 },
    );
  }

  const staleInviteIds = (pendingInvites ?? []).map((invite) => invite.id);
  if (staleInviteIds.length > 0) {
    const { error: staleInviteUpdateError } = await supabase
      .from("organization_invites")
      .update({ revoked_at: nowIso })
      .eq("organization_id", orgId)
      .in("id", staleInviteIds);

    if (staleInviteUpdateError) {
      return NextResponse.json(
        { error: `Failed to clean up stale invites: ${staleInviteUpdateError.message}` },
        { status: 500 },
      );
    }
  }

  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: insertedInvite, error: insertInviteError } = await supabase
    .from("organization_invites")
    .insert({
      organization_id: orgId,
      email,
      role,
      token_hash: tokenHash,
      expires_at: expiresAt,
      invited_by: userId,
    })
    .select("id, email, role, invited_by, expires_at, created_at")
    .single<InviteRow>();

  if (insertInviteError || !insertedInvite) {
    if (isMissingTeamSchema(insertInviteError)) {
      return NextResponse.json({ error: missingTeamSchemaMessage() }, { status: 500 });
    }
    return NextResponse.json(
      { error: `Failed to create invite: ${insertInviteError?.message ?? "Unknown error"}` },
      { status: 500 },
    );
  }

  const { data: inviterData } = await supabase
    .from("users")
    .select("id, name")
    .eq("id", userId)
    .maybeSingle<UserRow>();

  const { data: organizationData, error: organizationError } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("id", orgId)
    .maybeSingle<OrganizationRow>();

  if (organizationError) {
    const revokeNowIso = new Date().toISOString();
    const { error: revokeInviteError } = await supabase
      .from("organization_invites")
      .update({ revoked_at: revokeNowIso })
      .eq("organization_id", orgId)
      .eq("id", insertedInvite.id);

    if (revokeInviteError) {
      console.error(
        `Failed to revoke invite ${insertedInvite.id} after organization lookup error: ${revokeInviteError.message}`,
      );
    }

    return NextResponse.json(
      { error: `Failed to load organization details: ${organizationError.message}` },
      { status: 500 },
    );
  }

  const inviteLink = buildInviteLink(token);
  const organizationName = organizationData?.name ?? "your organization";

  try {
    await sendTeamInviteEmail({
      toEmail: insertedInvite.email,
      organizationName,
      inviterName: inviterData?.name ?? null,
      role: insertedInvite.role,
      inviteLink,
      expiresAt: insertedInvite.expires_at,
    });
  } catch (error: unknown) {
    const revokeNowIso = new Date().toISOString();
    const { error: revokeInviteError } = await supabase
      .from("organization_invites")
      .update({ revoked_at: revokeNowIso })
      .eq("organization_id", orgId)
      .eq("id", insertedInvite.id);

    if (revokeInviteError) {
      console.error(
        `Failed to revoke unsent invite ${insertedInvite.id}: ${revokeInviteError.message}`,
      );
    }

    const message =
      error instanceof Error ? error.message : "Failed to send invite email";
    return NextResponse.json(
      { error: `Invite email failed: ${message}` },
      { status: 502 },
    );
  }

  const invite: TeamInvite = {
    ...insertedInvite,
    invited_by_name: inviterData?.name ?? null,
  };

  await writeAuditLog({
    supabase,
    organizationId: orgId,
    actorUserId: userId,
    action: "team.invite.created",
    entityType: "organization_invite",
    entityId: insertedInvite.id,
    details: {
      invitedEmail: insertedInvite.email,
      invitedRole: insertedInvite.role,
      expiresAt: insertedInvite.expires_at,
    },
  });

  return NextResponse.json(
    {
      invite,
      inviteLink,
    },
    { status: 201 },
  );
}
