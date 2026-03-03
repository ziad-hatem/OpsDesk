import { NextResponse } from "next/server";
import { getOrganizationActorContext } from "@/lib/server/organization-context";
import { writeAuditLog } from "@/lib/server/audit-logs";
import { authorizeRbacAction } from "@/lib/server/rbac";
import { isMissingTeamSchema, missingTeamSchemaMessage } from "@/lib/team/errors";
import type { OrganizationRole } from "@/lib/topbar/types";

type RouteContext = {
  params: Promise<{ orgId: string; inviteId: string }>;
};

type InviteRow = {
  id: string;
  email: string;
  role: OrganizationRole;
  accepted_at: string | null;
  revoked_at: string | null;
};

async function resolveParams(context: RouteContext): Promise<{
  orgId: string;
  inviteId: string;
}> {
  const params = await context.params;
  return {
    orgId: params.orgId?.trim() ?? "",
    inviteId: params.inviteId?.trim() ?? "",
  };
}

export async function DELETE(_req: Request, context: RouteContext) {
  const { orgId, inviteId } = await resolveParams(context);
  if (!inviteId) {
    return NextResponse.json({ error: "Invite id is required" }, { status: 400 });
  }

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

  const { data: inviteData, error: inviteError } = await supabase
    .from("organization_invites")
    .select("id, email, role, accepted_at, revoked_at")
    .eq("organization_id", orgId)
    .eq("id", inviteId)
    .maybeSingle<InviteRow>();

  if (inviteError) {
    if (isMissingTeamSchema(inviteError)) {
      return NextResponse.json({ error: missingTeamSchemaMessage() }, { status: 500 });
    }
    return NextResponse.json(
      { error: `Failed to load invite: ${inviteError.message}` },
      { status: 500 },
    );
  }

  if (!inviteData) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }

  const authorizeRevoke = await authorizeRbacAction({
    supabase,
    organizationId: orgId,
    userId,
    permissionKey: "action.team.invite.revoke",
    actionLabel: "Revoke team invite",
    fallbackAllowed: actorRole === "admin" || actorRole === "manager",
    useApprovalFlow: true,
    entityType: "organization_invite",
    entityId: inviteId,
    payload: {
      targetRole: inviteData.role,
      invitedEmail: inviteData.email,
    },
  });
  if (!authorizeRevoke.ok) {
    return NextResponse.json(
      {
        error: authorizeRevoke.error,
        code: authorizeRevoke.code,
        approvalRequestId: authorizeRevoke.approvalRequestId ?? null,
      },
      { status: authorizeRevoke.status },
    );
  }

  const rolePermissionKey =
    inviteData.role === "admin"
      ? "field.team.invite.role.admin.assign"
      : inviteData.role === "manager"
        ? "field.team.invite.role.manager.assign"
        : inviteData.role === "support"
          ? "field.team.invite.role.support.assign"
          : "field.team.invite.role.read_only.assign";
  const roleFallbackAllowed =
    actorRole === "admin" ||
    (actorRole === "manager" &&
      (inviteData.role === "support" || inviteData.role === "read_only"));
  const authorizeRoleTarget = await authorizeRbacAction({
    supabase,
    organizationId: orgId,
    userId,
    permissionKey: rolePermissionKey,
    actionLabel: `Manage ${inviteData.role} invite`,
    fallbackAllowed: roleFallbackAllowed,
    useApprovalFlow: false,
  });
  if (!authorizeRoleTarget.ok) {
    return NextResponse.json(
      { error: authorizeRoleTarget.error },
      { status: authorizeRoleTarget.status },
    );
  }

  if (inviteData.accepted_at) {
    return NextResponse.json(
      { error: "Cannot revoke an invite that has already been accepted" },
      { status: 409 },
    );
  }

  if (inviteData.revoked_at) {
    return NextResponse.json({ success: true }, { status: 200 });
  }

  const { error: revokeError } = await supabase
    .from("organization_invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("organization_id", orgId)
    .eq("id", inviteId);

  if (revokeError) {
    if (isMissingTeamSchema(revokeError)) {
      return NextResponse.json({ error: missingTeamSchemaMessage() }, { status: 500 });
    }
    return NextResponse.json(
      { error: `Failed to revoke invite: ${revokeError.message}` },
      { status: 500 },
    );
  }

  await writeAuditLog({
    supabase,
    organizationId: orgId,
    actorUserId: userId,
    action: "team.invite.revoked",
    entityType: "organization_invite",
    entityId: inviteId,
    details: {
      invitedEmail: inviteData.email,
      invitedRole: inviteData.role,
    },
  });

  return NextResponse.json({ success: true }, { status: 200 });
}
