import { NextResponse } from "next/server";
import type {
  ApprovalPolicyItem,
  CustomRoleItem,
  RbacMemberAssignmentItem,
  RbacSettingsPatchBody,
  RbacSettingsResponse,
} from "@/lib/rbac/types";
import {
  authorizeRbacAction,
  isMissingRbacSchema,
  listPermissionCatalog,
  toApprovalPolicyItem,
} from "@/lib/server/rbac";
import { getOrganizationActorContext } from "@/lib/server/organization-context";
import { writeAuditLog } from "@/lib/server/audit-logs";
import type { OrganizationRole } from "@/lib/topbar/types";

type RouteContext = {
  params: Promise<{ orgId: string }>;
};

type CustomRoleRow = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  created_at: string;
  updated_at: string;
};

type CustomRolePermissionRow = {
  role_id: string;
  permission_key: string;
  effect: "allow" | "deny";
};

type MembershipRow = {
  id: string;
  user_id: string;
  role: OrganizationRole;
  status: "active" | "suspended";
  custom_role_id: string | null;
};

type UserRow = {
  id: string;
  name: string | null;
  email: string;
};

type ApprovalPolicyRow = {
  id: string;
  permission_key: string;
  enabled: boolean;
  min_approvals: number;
  approver_roles: OrganizationRole[] | null;
  approver_custom_role_ids: string[] | null;
  created_at: string;
  updated_at: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeUuid(value: unknown): string | null {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

function normalizePermissionKey(value: unknown): string | null {
  const normalized = normalizeText(value)?.toLowerCase() ?? null;
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, 160);
}

function dedupeRoles(value: unknown): OrganizationRole[] {
  const accepted = new Set<OrganizationRole>();
  const values = Array.isArray(value) ? value : [];
  for (const item of values) {
    if (
      item === "admin" ||
      item === "manager" ||
      item === "support" ||
      item === "read_only"
    ) {
      accepted.add(item);
    }
  }
  return Array.from(accepted);
}

function dedupeUuids(value: unknown): string[] {
  const accepted = new Set<string>();
  const values = Array.isArray(value) ? value : [];
  for (const item of values) {
    const normalized = normalizeUuid(item);
    if (normalized) {
      accepted.add(normalized);
    }
  }
  return Array.from(accepted);
}

function missingSchemaResponse() {
  return NextResponse.json(
    {
      error:
        "RBAC schema is missing. Run db/rbac-approvals-schema.sql in Supabase SQL Editor, then run: NOTIFY pgrst, 'reload schema';",
    },
    { status: 500 },
  );
}

async function resolveOrgId(context: RouteContext): Promise<string> {
  const params = await context.params;
  return params.orgId?.trim() ?? "";
}

async function loadRbacSettings(params: {
  supabase: ReturnType<typeof import("@/lib/supabase-admin").createSupabaseAdminClient>;
  orgId: string;
  userId: string;
  actorRole: OrganizationRole;
  actorCustomRoleId: string | null;
  canManageRbac: boolean;
}): Promise<RbacSettingsResponse> {
  const { supabase, orgId, userId, actorRole, actorCustomRoleId, canManageRbac } = params;

  const [
    customRolesResult,
    customRolePermissionsResult,
    membershipsResult,
    approvalPoliciesResult,
    pendingRequestsCountResult,
  ] = await Promise.all([
    supabase
      .from("custom_roles")
      .select("id, organization_id, name, description, is_system, created_at, updated_at")
      .eq("organization_id", orgId)
      .order("name", { ascending: true })
      .returns<CustomRoleRow[]>(),
    supabase
      .from("custom_role_permissions")
      .select("role_id, permission_key, effect")
      .eq("organization_id", orgId)
      .returns<CustomRolePermissionRow[]>(),
    supabase
      .from("organization_memberships")
      .select("id, user_id, role, status, custom_role_id")
      .eq("organization_id", orgId)
      .returns<MembershipRow[]>(),
    supabase
      .from("approval_policies")
      .select(
        "id, permission_key, enabled, min_approvals, approver_roles, approver_custom_role_ids, created_at, updated_at",
      )
      .eq("organization_id", orgId)
      .order("permission_key", { ascending: true })
      .returns<ApprovalPolicyRow[]>(),
    supabase
      .from("approval_requests")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("status", "pending"),
  ]);

  if (customRolesResult.error || customRolePermissionsResult.error || membershipsResult.error) {
    const error =
      customRolesResult.error ??
      customRolePermissionsResult.error ??
      membershipsResult.error;
    if (isMissingRbacSchema(error)) {
      throw new Error("__RBAC_SCHEMA_MISSING__");
    }
    throw new Error(`Failed to load RBAC data: ${error?.message ?? "Unknown error"}`);
  }

  if (approvalPoliciesResult.error) {
    if (isMissingRbacSchema(approvalPoliciesResult.error)) {
      throw new Error("__RBAC_SCHEMA_MISSING__");
    }
    throw new Error(
      `Failed to load approval policies: ${approvalPoliciesResult.error.message}`,
    );
  }
  if (pendingRequestsCountResult.error) {
    if (isMissingRbacSchema(pendingRequestsCountResult.error)) {
      throw new Error("__RBAC_SCHEMA_MISSING__");
    }
    throw new Error(
      `Failed to load approval request stats: ${pendingRequestsCountResult.error.message}`,
    );
  }

  const customRoleRows = customRolesResult.data ?? [];
  const permissionsRows = customRolePermissionsResult.data ?? [];
  const membershipRows = membershipsResult.data ?? [];
  const membershipUserIds = Array.from(new Set(membershipRows.map((row) => row.user_id)));
  let userRows: UserRow[] = [];
  if (membershipUserIds.length > 0) {
    const { data: usersData, error: usersError } = await supabase
      .from("users")
      .select("id, name, email")
      .in("id", membershipUserIds)
      .returns<UserRow[]>();
    if (usersError) {
      throw new Error(`Failed to load users: ${usersError.message}`);
    }
    userRows = usersData ?? [];
  }
  const approvalPolicyRows = approvalPoliciesResult.data ?? [];

  const permissionsByRole = new Map<
    string,
    Array<{ key: string; effect: "allow" | "deny" }>
  >();
  for (const row of permissionsRows) {
    const permissionKey = normalizePermissionKey(row.permission_key);
    if (!permissionKey) {
      continue;
    }
    const existing = permissionsByRole.get(row.role_id) ?? [];
    existing.push({
      key: permissionKey,
      effect: row.effect === "deny" ? "deny" : "allow",
    });
    permissionsByRole.set(row.role_id, existing);
  }

  const memberCountByCustomRole = new Map<string, number>();
  for (const membership of membershipRows) {
    if (!membership.custom_role_id) {
      continue;
    }
    memberCountByCustomRole.set(
      membership.custom_role_id,
      (memberCountByCustomRole.get(membership.custom_role_id) ?? 0) + 1,
    );
  }

  const customRoles: CustomRoleItem[] = customRoleRows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    is_system: row.is_system,
    member_count: memberCountByCustomRole.get(row.id) ?? 0,
    permissions: permissionsByRole.get(row.id) ?? [],
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));

  const userById = new Map(userRows.map((user) => [user.id, user]));
  const members: RbacMemberAssignmentItem[] = membershipRows
    .map((membership) => {
      const user = userById.get(membership.user_id);
      if (!user) {
        return null;
      }
      return {
        membership_id: membership.id,
        user_id: membership.user_id,
        name: user.name,
        email: user.email,
        status: membership.status,
        system_role: membership.role,
        custom_role_id: membership.custom_role_id,
      };
    })
    .filter((item): item is RbacMemberAssignmentItem => Boolean(item))
    .sort((left, right) => {
      const leftName = (left.name ?? left.email).toLowerCase();
      const rightName = (right.name ?? right.email).toLowerCase();
      return leftName.localeCompare(rightName);
    });

  const approvalPolicies: ApprovalPolicyItem[] = approvalPolicyRows.map((row) =>
    toApprovalPolicyItem(row),
  );

  return {
    activeOrgId: orgId,
    currentUserId: userId,
    actorRole,
    actorCustomRoleId,
    canManageRbac,
    permissionCatalog: listPermissionCatalog(),
    customRoles,
    members,
    approvalPolicies,
    pendingApprovalsCount: pendingRequestsCountResult.count ?? 0,
  };
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
    actorMembership: { role: actorRole, custom_role_id: actorCustomRoleId },
  } = actorContextResult.context;

  const canManageResult = await authorizeRbacAction({
    supabase,
    organizationId: orgId,
    userId,
    permissionKey: "action.rbac.manage",
    actionLabel: "Manage RBAC settings",
    fallbackAllowed: actorRole === "admin",
    useApprovalFlow: false,
  });

  const canReviewApprovalsResult = await authorizeRbacAction({
    supabase,
    organizationId: orgId,
    userId,
    permissionKey: "action.approvals.review",
    actionLabel: "Review approval requests",
    fallbackAllowed: actorRole === "admin" || actorRole === "manager",
    useApprovalFlow: false,
  });

  if (!canManageResult.ok && !canReviewApprovalsResult.ok) {
    return NextResponse.json(
      { error: "You do not have permission to access RBAC settings" },
      { status: 403 },
    );
  }

  try {
    const payload = await loadRbacSettings({
      supabase,
      orgId,
      userId,
      actorRole,
      actorCustomRoleId: actorCustomRoleId ?? null,
      canManageRbac: canManageResult.ok,
    });
    return NextResponse.json(payload, { status: 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to load RBAC settings";
    if (message === "__RBAC_SCHEMA_MISSING__") {
      return missingSchemaResponse();
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request, context: RouteContext) {
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
    actorMembership: { role: actorRole, custom_role_id: actorCustomRoleId },
  } = actorContextResult.context;

  const canManageResult = await authorizeRbacAction({
    supabase,
    organizationId: orgId,
    userId,
    permissionKey: "action.rbac.manage",
    actionLabel: "Update RBAC settings",
    fallbackAllowed: actorRole === "admin",
    useApprovalFlow: false,
  });

  if (!canManageResult.ok) {
    return NextResponse.json(
      { error: canManageResult.error },
      { status: canManageResult.status },
    );
  }

  let body: RbacSettingsPatchBody;
  try {
    body = (await req.json()) as RbacSettingsPatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }

  const upsertRoles = Array.isArray(body.upsertRoles) ? body.upsertRoles : [];
  const deleteRoleIds = Array.isArray(body.deleteRoleIds) ? body.deleteRoleIds : [];
  const memberAssignments = Array.isArray(body.memberAssignments)
    ? body.memberAssignments
    : [];
  const upsertPolicies = Array.isArray(body.upsertPolicies) ? body.upsertPolicies : [];

  const customRoleIdsInPayload = new Set<string>();
  const touchedRoleIds = new Set<string>();

  for (const roleInput of upsertRoles) {
    const roleId = normalizeUuid(roleInput.id);
    const roleName = normalizeText(roleInput.name)?.slice(0, 80);
    const roleDescription = normalizeText(roleInput.description)?.slice(0, 600) ?? null;
    const permissions = Array.isArray(roleInput.permissions)
      ? roleInput.permissions
      : [];

    if (!roleId && !roleName) {
      return NextResponse.json(
        { error: "Role name is required for new custom roles" },
        { status: 400 },
      );
    }

    let effectiveRoleId = roleId;
    if (roleId) {
      const { data: existingRole, error: existingRoleError } = await supabase
        .from("custom_roles")
        .select("id, is_system")
        .eq("organization_id", orgId)
        .eq("id", roleId)
        .maybeSingle<{ id: string; is_system: boolean }>();

      if (existingRoleError) {
        if (isMissingRbacSchema(existingRoleError)) {
          return missingSchemaResponse();
        }
        return NextResponse.json(
          { error: `Failed to validate custom role: ${existingRoleError.message}` },
          { status: 500 },
        );
      }
      if (!existingRole) {
        return NextResponse.json({ error: "Custom role not found" }, { status: 404 });
      }
      if (existingRole.is_system) {
        return NextResponse.json(
          { error: "System roles cannot be modified" },
          { status: 400 },
        );
      }

      const updatePayload: Record<string, unknown> = {};
      if (roleName) {
        updatePayload.name = roleName;
      }
      updatePayload.description = roleDescription;

      const { error: updateRoleError } = await supabase
        .from("custom_roles")
        .update(updatePayload)
        .eq("organization_id", orgId)
        .eq("id", roleId);

      if (updateRoleError) {
        if (isMissingRbacSchema(updateRoleError)) {
          return missingSchemaResponse();
        }
        return NextResponse.json(
          { error: `Failed to update custom role: ${updateRoleError.message}` },
          { status: 500 },
        );
      }
    } else {
      const { data: insertedRole, error: insertRoleError } = await supabase
        .from("custom_roles")
        .insert({
          organization_id: orgId,
          name: roleName,
          description: roleDescription,
          created_by: userId,
        })
        .select("id")
        .single<{ id: string }>();

      if (insertRoleError || !insertedRole) {
        if (isMissingRbacSchema(insertRoleError)) {
          return missingSchemaResponse();
        }
        return NextResponse.json(
          {
            error: `Failed to create custom role: ${insertRoleError?.message ?? "Unknown error"}`,
          },
          { status: 500 },
        );
      }
      effectiveRoleId = insertedRole.id;
    }

    if (!effectiveRoleId) {
      continue;
    }
    customRoleIdsInPayload.add(effectiveRoleId);
    touchedRoleIds.add(effectiveRoleId);

    const normalizedPermissions = permissions
      .map((permission) => ({
        key: normalizePermissionKey(permission.key),
        effect: permission.effect === "deny" ? "deny" : "allow",
      }))
      .filter((permission): permission is { key: string; effect: "allow" | "deny" } =>
        Boolean(permission.key),
      );

    const { error: clearPermissionsError } = await supabase
      .from("custom_role_permissions")
      .delete()
      .eq("organization_id", orgId)
      .eq("role_id", effectiveRoleId);

    if (clearPermissionsError) {
      if (isMissingRbacSchema(clearPermissionsError)) {
        return missingSchemaResponse();
      }
      return NextResponse.json(
        { error: `Failed to reset role permissions: ${clearPermissionsError.message}` },
        { status: 500 },
      );
    }

    if (normalizedPermissions.length > 0) {
      const { error: insertPermissionsError } = await supabase
        .from("custom_role_permissions")
        .insert(
          normalizedPermissions.map((permission) => ({
            organization_id: orgId,
            role_id: effectiveRoleId,
            permission_key: permission.key,
            effect: permission.effect,
          })),
        );

      if (insertPermissionsError) {
        if (isMissingRbacSchema(insertPermissionsError)) {
          return missingSchemaResponse();
        }
        return NextResponse.json(
          { error: `Failed to save role permissions: ${insertPermissionsError.message}` },
          { status: 500 },
        );
      }
    }
  }

  const normalizedDeleteRoleIds = Array.from(
    new Set(deleteRoleIds.map((value) => normalizeUuid(value)).filter(Boolean) as string[]),
  );
  if (normalizedDeleteRoleIds.length > 0) {
    const { data: deletableRoles, error: deletableRoleError } = await supabase
      .from("custom_roles")
      .select("id, is_system")
      .eq("organization_id", orgId)
      .in("id", normalizedDeleteRoleIds)
      .returns<Array<{ id: string; is_system: boolean }>>();

    if (deletableRoleError) {
      if (isMissingRbacSchema(deletableRoleError)) {
        return missingSchemaResponse();
      }
      return NextResponse.json(
        { error: `Failed to validate deleted roles: ${deletableRoleError.message}` },
        { status: 500 },
      );
    }

    const deletableIds = (deletableRoles ?? [])
      .filter((role) => !role.is_system)
      .map((role) => role.id);

    if (deletableIds.length > 0) {
      const { error: clearAssignmentsError } = await supabase
        .from("organization_memberships")
        .update({ custom_role_id: null })
        .eq("organization_id", orgId)
        .in("custom_role_id", deletableIds);

      if (clearAssignmentsError) {
        return NextResponse.json(
          {
            error: `Failed to clear role assignments before delete: ${clearAssignmentsError.message}`,
          },
          { status: 500 },
        );
      }

      const { error: deleteRoleError } = await supabase
        .from("custom_roles")
        .delete()
        .eq("organization_id", orgId)
        .in("id", deletableIds);

      if (deleteRoleError) {
        return NextResponse.json(
          { error: `Failed to delete custom roles: ${deleteRoleError.message}` },
          { status: 500 },
        );
      }
    }
  }

  if (memberAssignments.length > 0) {
    const assignableRoleIds = new Set<string>(customRoleIdsInPayload);
    if (assignableRoleIds.size === 0) {
      const { data: customRolesData, error: customRolesError } = await supabase
        .from("custom_roles")
        .select("id")
        .eq("organization_id", orgId)
        .returns<Array<{ id: string }>>();

      if (customRolesError) {
        if (isMissingRbacSchema(customRolesError)) {
          return missingSchemaResponse();
        }
        return NextResponse.json(
          { error: `Failed to validate role assignments: ${customRolesError.message}` },
          { status: 500 },
        );
      }
      for (const role of customRolesData ?? []) {
        assignableRoleIds.add(role.id);
      }
    }

    for (const assignment of memberAssignments) {
      const membershipId = normalizeUuid(assignment.membershipId);
      if (!membershipId) {
        continue;
      }
      const customRoleId = normalizeUuid(assignment.customRoleId);
      if (customRoleId && !assignableRoleIds.has(customRoleId)) {
        return NextResponse.json(
          { error: "Invalid custom role assignment" },
          { status: 400 },
        );
      }

      const { error: assignmentError } = await supabase
        .from("organization_memberships")
        .update({ custom_role_id: customRoleId })
        .eq("organization_id", orgId)
        .eq("id", membershipId);

      if (assignmentError) {
        if (isMissingRbacSchema(assignmentError)) {
          return missingSchemaResponse();
        }
        return NextResponse.json(
          { error: `Failed to assign custom role: ${assignmentError.message}` },
          { status: 500 },
        );
      }
    }
  }

  if (upsertPolicies.length > 0) {
    const catalogKeys = new Set(listPermissionCatalog().map((item) => item.key));
    const upsertRows: Array<{
      organization_id: string;
      permission_key: string;
      enabled: boolean;
      min_approvals: number;
      approver_roles: OrganizationRole[];
      approver_custom_role_ids: string[];
      created_by: string;
    }> = [];

    for (const policy of upsertPolicies) {
      const permissionKey = normalizePermissionKey(policy.permissionKey);
      if (!permissionKey || !catalogKeys.has(permissionKey)) {
        return NextResponse.json(
          { error: "Invalid approval policy permission key" },
          { status: 400 },
        );
      }

      const enabled = policy.enabled !== false;
      const minApprovals = Math.min(
        10,
        Math.max(1, Number.isFinite(policy.minApprovals) ? Number(policy.minApprovals) : 1),
      );
      const approverRoles = dedupeRoles(policy.approverRoles);
      const approverCustomRoleIds = dedupeUuids(policy.approverCustomRoleIds);

      upsertRows.push({
        organization_id: orgId,
        permission_key: permissionKey,
        enabled,
        min_approvals: minApprovals,
        approver_roles: approverRoles.length > 0 ? approverRoles : ["admin"],
        approver_custom_role_ids: approverCustomRoleIds,
        created_by: userId,
      });
    }

    const { error: upsertPoliciesError } = await supabase
      .from("approval_policies")
      .upsert(upsertRows, { onConflict: "organization_id,permission_key" });

    if (upsertPoliciesError) {
      if (isMissingRbacSchema(upsertPoliciesError)) {
        return missingSchemaResponse();
      }
      return NextResponse.json(
        { error: `Failed to save approval policies: ${upsertPoliciesError.message}` },
        { status: 500 },
      );
    }
  }

  await writeAuditLog({
    supabase,
    organizationId: orgId,
    actorUserId: userId,
    action: "rbac.settings.updated",
    entityType: "organization",
    entityId: orgId,
    details: {
      touchedRoleIds: Array.from(touchedRoleIds),
      deletedRoleCount: normalizedDeleteRoleIds.length,
      memberAssignments: memberAssignments.length,
      updatedPolicies: upsertPolicies.length,
    },
  });

  try {
    const payload = await loadRbacSettings({
      supabase,
      orgId,
      userId,
      actorRole,
      actorCustomRoleId: actorCustomRoleId ?? null,
      canManageRbac: true,
    });
    return NextResponse.json(payload, { status: 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to reload RBAC settings";
    if (message === "__RBAC_SCHEMA_MISSING__") {
      return missingSchemaResponse();
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
