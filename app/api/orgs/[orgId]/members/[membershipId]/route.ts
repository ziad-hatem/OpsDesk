import { NextResponse } from "next/server";
import { getOrganizationActorContext } from "@/lib/server/organization-context";
import { writeAuditLog } from "@/lib/server/audit-logs";
import { authorizeRbacAction } from "@/lib/server/rbac";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isMissingTeamSchema, missingTeamSchemaMessage } from "@/lib/team/errors";
import type { TeamMember } from "@/lib/team/types";
import {
  isMembershipStatus,
  isOrganizationRole,
} from "@/lib/team/validation";
import type { OrganizationRole } from "@/lib/topbar/types";

type RouteContext = {
  params: Promise<{ orgId: string; membershipId: string }>;
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

type UpdateMemberBody = {
  role?: unknown;
  status?: unknown;
};

async function resolveParams(context: RouteContext): Promise<{
  orgId: string;
  membershipId: string;
}> {
  const params = await context.params;
  return {
    orgId: params.orgId?.trim() ?? "",
    membershipId: params.membershipId?.trim() ?? "",
  };
}

function hasOwnProperty<T extends object>(obj: T, key: keyof T): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

async function countActiveAdmins(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  orgId: string,
) {
  const { count, error } = await supabase
    .from("organization_memberships")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("role", "admin")
    .eq("status", "active");

  return { count: count ?? 0, error };
}

async function toTeamMember(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  membership: MembershipRow,
): Promise<{ member: TeamMember | null; error: string | null }> {
  const { data: userData, error: userError } = await supabase
    .from("users")
    .select("id, name, email, avatar_url")
    .eq("id", membership.user_id)
    .maybeSingle<UserRow>();

  if (userError) {
    return { member: null, error: `Failed to load user profile: ${userError.message}` };
  }

  if (!userData) {
    return { member: null, error: "Member profile was not found" };
  }

  return {
    member: {
      id: membership.id,
      user_id: membership.user_id,
      name: userData.name,
      email: userData.email,
      avatar_url: userData.avatar_url,
      role: membership.role,
      status: membership.status,
      joined_at: membership.joined_at ?? membership.created_at,
      created_at: membership.created_at,
      updated_at: membership.updated_at,
    },
    error: null,
  };
}

export async function PATCH(req: Request, context: RouteContext) {
  const { orgId, membershipId } = await resolveParams(context);
  if (!membershipId) {
    return NextResponse.json({ error: "Membership id is required" }, { status: 400 });
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

  let body: UpdateMemberBody;
  try {
    body = (await req.json()) as UpdateMemberBody;
  } catch {
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }

  const includesRole = hasOwnProperty(body, "role");
  const includesStatus = hasOwnProperty(body, "status");
  if (!includesRole && !includesStatus) {
    return NextResponse.json(
      { error: "One of role or status is required" },
      { status: 400 },
    );
  }
  if (includesRole && includesStatus) {
    return NextResponse.json(
      { error: "Only one of role or status can be updated at a time" },
      { status: 400 },
    );
  }

  const { data: targetMembership, error: targetMembershipError } = await supabase
    .from("organization_memberships")
    .select("id, user_id, role, status, joined_at, created_at, updated_at")
    .eq("organization_id", orgId)
    .eq("id", membershipId)
    .maybeSingle<MembershipRow>();

  if (targetMembershipError) {
    if (isMissingTeamSchema(targetMembershipError)) {
      return NextResponse.json({ error: missingTeamSchemaMessage() }, { status: 500 });
    }
    return NextResponse.json(
      { error: `Failed to load member: ${targetMembershipError.message}` },
      { status: 500 },
    );
  }

  if (!targetMembership) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  if (includesRole) {
    if (!isOrganizationRole(body.role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    const nextRole = body.role;
    const authorizeRoleChange = await authorizeRbacAction({
      supabase,
      organizationId: orgId,
      userId,
      permissionKey: "action.team.member.role.change",
      actionLabel: "Change team member role",
      fallbackAllowed: actorRole === "admin",
      useApprovalFlow: true,
      entityType: "organization_membership",
      entityId: membershipId,
      payload: {
        targetUserId: targetMembership.user_id,
        nextRole,
      },
    });
    if (!authorizeRoleChange.ok) {
      return NextResponse.json(
        {
          error: authorizeRoleChange.error,
          code: authorizeRoleChange.code,
          approvalRequestId: authorizeRoleChange.approvalRequestId ?? null,
        },
        { status: authorizeRoleChange.status },
      );
    }

    const rolePermissionKey =
      nextRole === "admin"
        ? "field.team.member.role.admin.assign"
        : nextRole === "manager"
          ? "field.team.member.role.manager.assign"
          : nextRole === "support"
            ? "field.team.member.role.support.assign"
            : "field.team.member.role.read_only.assign";
    const authorizeTargetRole = await authorizeRbacAction({
      supabase,
      organizationId: orgId,
      userId,
      permissionKey: rolePermissionKey,
      actionLabel: `Assign ${nextRole} role`,
      fallbackAllowed: actorRole === "admin",
      useApprovalFlow: false,
    });
    if (!authorizeTargetRole.ok) {
      return NextResponse.json(
        { error: authorizeTargetRole.error },
        { status: authorizeTargetRole.status },
      );
    }

    if (targetMembership.role !== nextRole) {
      if (
        targetMembership.role === "admin" &&
        targetMembership.status === "active" &&
        nextRole !== "admin"
      ) {
        const { count: activeAdminCount, error: activeAdminCountError } =
          await countActiveAdmins(supabase, orgId);

        if (activeAdminCountError) {
          if (isMissingTeamSchema(activeAdminCountError)) {
            return NextResponse.json(
              { error: missingTeamSchemaMessage() },
              { status: 500 },
            );
          }
          return NextResponse.json(
            {
              error: `Failed to validate admin constraints: ${activeAdminCountError.message}`,
            },
            { status: 500 },
          );
        }

        if (activeAdminCount <= 1) {
          return NextResponse.json(
            { error: "Cannot demote the last active admin" },
            { status: 400 },
          );
        }
      }

      const { data: updatedMembership, error: updateError } = await supabase
        .from("organization_memberships")
        .update({
          role: nextRole,
          updated_at: new Date().toISOString(),
        })
        .eq("organization_id", orgId)
        .eq("id", membershipId)
        .select("id, user_id, role, status, joined_at, created_at, updated_at")
        .single<MembershipRow>();

      if (updateError || !updatedMembership) {
        if (isMissingTeamSchema(updateError)) {
          return NextResponse.json({ error: missingTeamSchemaMessage() }, { status: 500 });
        }
        return NextResponse.json(
          { error: `Failed to update member role: ${updateError?.message ?? "Unknown error"}` },
          { status: 500 },
        );
      }

      await writeAuditLog({
        supabase,
        organizationId: orgId,
        actorUserId: userId,
        action: "team.member.role_changed",
        entityType: "organization_membership",
        entityId: membershipId,
        targetUserId: targetMembership.user_id,
        details: {
          fromRole: targetMembership.role,
          toRole: nextRole,
        },
      });

      const mappedMemberResult = await toTeamMember(supabase, updatedMembership);
      if (!mappedMemberResult.member || mappedMemberResult.error) {
        return NextResponse.json(
          { error: mappedMemberResult.error ?? "Failed to load updated member" },
          { status: 500 },
        );
      }

      return NextResponse.json({ member: mappedMemberResult.member }, { status: 200 });
    }

    const mappedMemberResult = await toTeamMember(supabase, targetMembership);
    if (!mappedMemberResult.member || mappedMemberResult.error) {
      return NextResponse.json(
        { error: mappedMemberResult.error ?? "Failed to load member" },
        { status: 500 },
      );
    }
    return NextResponse.json({ member: mappedMemberResult.member }, { status: 200 });
  }

  const authorizeStatusChange = await authorizeRbacAction({
    supabase,
    organizationId: orgId,
    userId,
    permissionKey: "action.team.member.status.change",
    actionLabel: "Change team member status",
    fallbackAllowed: actorRole === "admin",
    useApprovalFlow: true,
    entityType: "organization_membership",
    entityId: membershipId,
    payload: {
      targetUserId: targetMembership.user_id,
      currentStatus: targetMembership.status,
      nextStatus: body.status,
    },
  });
  if (!authorizeStatusChange.ok) {
    return NextResponse.json(
      {
        error: authorizeStatusChange.error,
        code: authorizeStatusChange.code,
        approvalRequestId: authorizeStatusChange.approvalRequestId ?? null,
      },
      { status: authorizeStatusChange.status },
    );
  }

  if (!isMembershipStatus(body.status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const nextStatus = body.status;
  if (nextStatus === "suspended" && targetMembership.user_id === userId) {
    return NextResponse.json(
      { error: "You cannot suspend your own membership" },
      { status: 400 },
    );
  }

  if (targetMembership.status !== nextStatus) {
    if (
      targetMembership.role === "admin" &&
      targetMembership.status === "active" &&
      nextStatus === "suspended"
    ) {
      const { count: activeAdminCount, error: activeAdminCountError } =
        await countActiveAdmins(supabase, orgId);

      if (activeAdminCountError) {
        if (isMissingTeamSchema(activeAdminCountError)) {
          return NextResponse.json({ error: missingTeamSchemaMessage() }, { status: 500 });
        }
        return NextResponse.json(
          {
            error: `Failed to validate admin constraints: ${activeAdminCountError.message}`,
          },
          { status: 500 },
        );
      }

      if (activeAdminCount <= 1) {
        return NextResponse.json(
          { error: "Cannot suspend the last active admin" },
          { status: 400 },
        );
      }
    }

    const { data: updatedMembership, error: updateError } = await supabase
      .from("organization_memberships")
      .update({
        status: nextStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", orgId)
      .eq("id", membershipId)
      .select("id, user_id, role, status, joined_at, created_at, updated_at")
      .single<MembershipRow>();

    if (updateError || !updatedMembership) {
      if (isMissingTeamSchema(updateError)) {
        return NextResponse.json({ error: missingTeamSchemaMessage() }, { status: 500 });
      }
      return NextResponse.json(
        { error: `Failed to update member status: ${updateError?.message ?? "Unknown error"}` },
        { status: 500 },
      );
    }

    await writeAuditLog({
      supabase,
      organizationId: orgId,
      actorUserId: userId,
      action: nextStatus === "suspended" ? "team.member.suspended" : "team.member.reactivated",
      entityType: "organization_membership",
      entityId: membershipId,
      targetUserId: targetMembership.user_id,
      details: {
        fromStatus: targetMembership.status,
        toStatus: nextStatus,
      },
    });

    const mappedMemberResult = await toTeamMember(supabase, updatedMembership);
    if (!mappedMemberResult.member || mappedMemberResult.error) {
      return NextResponse.json(
        { error: mappedMemberResult.error ?? "Failed to load updated member" },
        { status: 500 },
      );
    }

    return NextResponse.json({ member: mappedMemberResult.member }, { status: 200 });
  }

  const mappedMemberResult = await toTeamMember(supabase, targetMembership);
  if (!mappedMemberResult.member || mappedMemberResult.error) {
    return NextResponse.json(
      { error: mappedMemberResult.error ?? "Failed to load member" },
      { status: 500 },
    );
  }
  return NextResponse.json({ member: mappedMemberResult.member }, { status: 200 });
}

export async function DELETE(_req: Request, context: RouteContext) {
  const { orgId, membershipId } = await resolveParams(context);
  if (!membershipId) {
    return NextResponse.json({ error: "Membership id is required" }, { status: 400 });
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

  const authorizeRemove = await authorizeRbacAction({
    supabase,
    organizationId: orgId,
    userId,
    permissionKey: "action.team.member.remove",
    actionLabel: "Remove team member",
    fallbackAllowed: actorRole === "admin",
    useApprovalFlow: true,
    entityType: "organization_membership",
    entityId: membershipId,
  });
  if (!authorizeRemove.ok) {
    return NextResponse.json(
      {
        error: authorizeRemove.error,
        code: authorizeRemove.code,
        approvalRequestId: authorizeRemove.approvalRequestId ?? null,
      },
      { status: authorizeRemove.status },
    );
  }

  const { data: targetMembership, error: targetMembershipError } = await supabase
    .from("organization_memberships")
    .select("id, user_id, role, status, joined_at, created_at, updated_at")
    .eq("organization_id", orgId)
    .eq("id", membershipId)
    .maybeSingle<MembershipRow>();

  if (targetMembershipError) {
    if (isMissingTeamSchema(targetMembershipError)) {
      return NextResponse.json({ error: missingTeamSchemaMessage() }, { status: 500 });
    }
    return NextResponse.json(
      { error: `Failed to load member: ${targetMembershipError.message}` },
      { status: 500 },
    );
  }

  if (!targetMembership) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  if (targetMembership.user_id === userId) {
    return NextResponse.json(
      { error: "You cannot remove your own membership" },
      { status: 400 },
    );
  }

  if (targetMembership.role === "admin" && targetMembership.status === "active") {
    const { count: activeAdminCount, error: activeAdminCountError } =
      await countActiveAdmins(supabase, orgId);

    if (activeAdminCountError) {
      if (isMissingTeamSchema(activeAdminCountError)) {
        return NextResponse.json({ error: missingTeamSchemaMessage() }, { status: 500 });
      }
      return NextResponse.json(
        {
          error: `Failed to validate admin constraints: ${activeAdminCountError.message}`,
        },
        { status: 500 },
      );
    }

    if (activeAdminCount <= 1) {
      return NextResponse.json(
        { error: "Cannot remove the last active admin" },
        { status: 400 },
      );
    }
  }

  const { error: deleteError } = await supabase
    .from("organization_memberships")
    .delete()
    .eq("organization_id", orgId)
    .eq("id", membershipId);

  if (deleteError) {
    if (isMissingTeamSchema(deleteError)) {
      return NextResponse.json({ error: missingTeamSchemaMessage() }, { status: 500 });
    }
    return NextResponse.json(
      { error: `Failed to remove member: ${deleteError.message}` },
      { status: 500 },
    );
  }

  await writeAuditLog({
    supabase,
    organizationId: orgId,
    actorUserId: userId,
    action: "team.member.removed",
    entityType: "organization_membership",
    entityId: membershipId,
    targetUserId: targetMembership.user_id,
    details: {
      role: targetMembership.role,
      status: targetMembership.status,
    },
  });

  return NextResponse.json({ success: true }, { status: 200 });
}
