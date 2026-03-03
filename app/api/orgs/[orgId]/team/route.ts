import { NextResponse } from "next/server";
import { getOrganizationActorContext } from "@/lib/server/organization-context";
import {
  authorizeRbacAction,
  fallbackAssignableInviteRoles,
  fallbackAssignableMemberRoles,
} from "@/lib/server/rbac";
import { isMissingTeamSchema, missingTeamSchemaMessage } from "@/lib/team/errors";
import type { TeamInvite, TeamMember, TeamResponse } from "@/lib/team/types";
import type { OrganizationRole } from "@/lib/topbar/types";

type RouteContext = {
  params: Promise<{ orgId: string }>;
};

type MembershipRow = {
  id: string;
  user_id: string;
  role: OrganizationRole;
  status: TeamMember["status"];
  joined_at: string | null;
  created_at: string;
  updated_at: string;
};

type UserRow = {
  id: string;
  name: string | null;
  email: string;
  avatar_url: string | null;
};

type InviteRow = {
  id: string;
  email: string;
  role: OrganizationRole;
  invited_by: string;
  expires_at: string;
  created_at: string;
};

function compareMembersByName(a: TeamMember, b: TeamMember): number {
  const left = (a.name ?? a.email).toLowerCase();
  const right = (b.name ?? b.email).toLowerCase();
  return left.localeCompare(right);
}

async function resolveOrgId(context: RouteContext): Promise<string> {
  const params = await context.params;
  return params.orgId?.trim() ?? "";
}

export async function GET(_req: Request, context: RouteContext) {
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
    actorMembership,
  } = actorContextResult.context;
  const actorRole = actorMembership.role;

  const { data: membershipsData, error: membershipsError } = await supabase
    .from("organization_memberships")
    .select("id, user_id, role, status, joined_at, created_at, updated_at")
    .eq("organization_id", orgId)
    .returns<MembershipRow[]>();

  if (membershipsError) {
    if (isMissingTeamSchema(membershipsError)) {
      return NextResponse.json({ error: missingTeamSchemaMessage() }, { status: 500 });
    }
    return NextResponse.json(
      { error: `Failed to load organization members: ${membershipsError.message}` },
      { status: 500 },
    );
  }

  const membershipRows = membershipsData ?? [];
  const memberUserIds = Array.from(
    new Set(membershipRows.map((membership) => membership.user_id)),
  );

  let usersById = new Map<string, UserRow>();
  if (memberUserIds.length > 0) {
    const { data: usersData, error: usersError } = await supabase
      .from("users")
      .select("id, name, email, avatar_url")
      .in("id", memberUserIds)
      .returns<UserRow[]>();

    if (usersError) {
      return NextResponse.json(
        { error: `Failed to load member profiles: ${usersError.message}` },
        { status: 500 },
      );
    }

    usersById = new Map((usersData ?? []).map((user) => [user.id, user]));
  }

  const members: TeamMember[] = [];
  for (const membership of membershipRows) {
    const user = usersById.get(membership.user_id);
    if (!user) {
      continue;
    }

    members.push({
      id: membership.id,
      user_id: membership.user_id,
      name: user.name,
      email: user.email,
      avatar_url: user.avatar_url,
      role: membership.role,
      status: membership.status,
      joined_at: membership.joined_at ?? membership.created_at,
      created_at: membership.created_at,
      updated_at: membership.updated_at,
    });
  }

  members.sort(compareMembersByName);

  const { data: invitesData, error: invitesError } = await supabase
    .from("organization_invites")
    .select("id, email, role, invited_by, expires_at, created_at")
    .eq("organization_id", orgId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .returns<InviteRow[]>();

  if (invitesError) {
    if (isMissingTeamSchema(invitesError)) {
      return NextResponse.json({ error: missingTeamSchemaMessage() }, { status: 500 });
    }
    return NextResponse.json(
      { error: `Failed to load organization invites: ${invitesError.message}` },
      { status: 500 },
    );
  }

  const inviteRows = invitesData ?? [];
  const inviterIds = Array.from(new Set(inviteRows.map((invite) => invite.invited_by)));

  if (inviterIds.length > 0) {
    const { data: invitersData, error: invitersError } = await supabase
      .from("users")
      .select("id, name, email, avatar_url")
      .in("id", inviterIds)
      .returns<UserRow[]>();

    if (invitersError) {
      return NextResponse.json(
        { error: `Failed to load inviter profiles: ${invitersError.message}` },
        { status: 500 },
      );
    }

    for (const inviter of invitersData ?? []) {
      usersById.set(inviter.id, inviter);
    }
  }

  const invites: TeamInvite[] = inviteRows.map((invite) => ({
    id: invite.id,
    email: invite.email,
    role: invite.role,
    invited_by: invite.invited_by,
    invited_by_name: usersById.get(invite.invited_by)?.name ?? null,
    created_at: invite.created_at,
    expires_at: invite.expires_at,
  }));

  const actorForPermission = {
    id: actorMembership.id,
    userId,
    role: actorMembership.role,
    status: actorMembership.status,
    customRoleId: actorMembership.custom_role_id ?? null,
  };

  const fallbackInviteRoles = fallbackAssignableInviteRoles(actorRole);
  const fallbackMemberRoles = fallbackAssignableMemberRoles(actorRole);

  const [
    canInviteResult,
    canChangeRolesResult,
    canSuspendResult,
    canRemoveResult,
    inviteAdminResult,
    inviteManagerResult,
    inviteSupportResult,
    inviteReadOnlyResult,
    memberAdminResult,
    memberManagerResult,
    memberSupportResult,
    memberReadOnlyResult,
  ] = await Promise.all([
    authorizeRbacAction({
      supabase,
      organizationId: orgId,
      userId,
      permissionKey: "action.team.invite.create",
      actionLabel: "View invite permissions",
      fallbackAllowed: actorRole === "admin" || actorRole === "manager",
      useApprovalFlow: false,
      actorMembership: actorForPermission,
    }),
    authorizeRbacAction({
      supabase,
      organizationId: orgId,
      userId,
      permissionKey: "action.team.member.role.change",
      actionLabel: "View member role permissions",
      fallbackAllowed: actorRole === "admin",
      useApprovalFlow: false,
      actorMembership: actorForPermission,
    }),
    authorizeRbacAction({
      supabase,
      organizationId: orgId,
      userId,
      permissionKey: "action.team.member.status.change",
      actionLabel: "View member status permissions",
      fallbackAllowed: actorRole === "admin",
      useApprovalFlow: false,
      actorMembership: actorForPermission,
    }),
    authorizeRbacAction({
      supabase,
      organizationId: orgId,
      userId,
      permissionKey: "action.team.member.remove",
      actionLabel: "View member remove permissions",
      fallbackAllowed: actorRole === "admin",
      useApprovalFlow: false,
      actorMembership: actorForPermission,
    }),
    authorizeRbacAction({
      supabase,
      organizationId: orgId,
      userId,
      permissionKey: "field.team.invite.role.admin.assign",
      actionLabel: "View admin invite permission",
      fallbackAllowed: fallbackInviteRoles.includes("admin"),
      useApprovalFlow: false,
      actorMembership: actorForPermission,
    }),
    authorizeRbacAction({
      supabase,
      organizationId: orgId,
      userId,
      permissionKey: "field.team.invite.role.manager.assign",
      actionLabel: "View manager invite permission",
      fallbackAllowed: fallbackInviteRoles.includes("manager"),
      useApprovalFlow: false,
      actorMembership: actorForPermission,
    }),
    authorizeRbacAction({
      supabase,
      organizationId: orgId,
      userId,
      permissionKey: "field.team.invite.role.support.assign",
      actionLabel: "View support invite permission",
      fallbackAllowed: fallbackInviteRoles.includes("support"),
      useApprovalFlow: false,
      actorMembership: actorForPermission,
    }),
    authorizeRbacAction({
      supabase,
      organizationId: orgId,
      userId,
      permissionKey: "field.team.invite.role.read_only.assign",
      actionLabel: "View read-only invite permission",
      fallbackAllowed: fallbackInviteRoles.includes("read_only"),
      useApprovalFlow: false,
      actorMembership: actorForPermission,
    }),
    authorizeRbacAction({
      supabase,
      organizationId: orgId,
      userId,
      permissionKey: "field.team.member.role.admin.assign",
      actionLabel: "View admin member role permission",
      fallbackAllowed: fallbackMemberRoles.includes("admin"),
      useApprovalFlow: false,
      actorMembership: actorForPermission,
    }),
    authorizeRbacAction({
      supabase,
      organizationId: orgId,
      userId,
      permissionKey: "field.team.member.role.manager.assign",
      actionLabel: "View manager member role permission",
      fallbackAllowed: fallbackMemberRoles.includes("manager"),
      useApprovalFlow: false,
      actorMembership: actorForPermission,
    }),
    authorizeRbacAction({
      supabase,
      organizationId: orgId,
      userId,
      permissionKey: "field.team.member.role.support.assign",
      actionLabel: "View support member role permission",
      fallbackAllowed: fallbackMemberRoles.includes("support"),
      useApprovalFlow: false,
      actorMembership: actorForPermission,
    }),
    authorizeRbacAction({
      supabase,
      organizationId: orgId,
      userId,
      permissionKey: "field.team.member.role.read_only.assign",
      actionLabel: "View read-only member role permission",
      fallbackAllowed: fallbackMemberRoles.includes("read_only"),
      useApprovalFlow: false,
      actorMembership: actorForPermission,
    }),
  ]);

  const assignableInviteRoles: OrganizationRole[] = [];
  if (inviteAdminResult.ok) assignableInviteRoles.push("admin");
  if (inviteManagerResult.ok) assignableInviteRoles.push("manager");
  if (inviteSupportResult.ok) assignableInviteRoles.push("support");
  if (inviteReadOnlyResult.ok) assignableInviteRoles.push("read_only");

  const assignableMemberRoles: OrganizationRole[] = [];
  if (memberAdminResult.ok) assignableMemberRoles.push("admin");
  if (memberManagerResult.ok) assignableMemberRoles.push("manager");
  if (memberSupportResult.ok) assignableMemberRoles.push("support");
  if (memberReadOnlyResult.ok) assignableMemberRoles.push("read_only");

  const payload: TeamResponse = {
    activeOrgId: orgId,
    currentUserId: userId,
    currentUserRole: actorRole,
    permissions: {
      canInvite: canInviteResult.ok,
      canChangeRoles: canChangeRolesResult.ok,
      canSuspendRemove: canSuspendResult.ok || canRemoveResult.ok,
      manageableInviteRoles: [...assignableInviteRoles],
      assignableInviteRoles: [...assignableInviteRoles],
      assignableMemberRoles: [...assignableMemberRoles],
    },
    members,
    invites,
  };

  return NextResponse.json(payload, { status: 200 });
}
