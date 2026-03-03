import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { insertAppNotifications } from "@/lib/server/notifications";
import { writeAuditLog } from "@/lib/server/audit-logs";
import type { OrganizationRole } from "@/lib/topbar/types";
import type {
  ApprovalDecision,
  ApprovalPolicyItem,
  ApprovalRequestStatus,
  RbacPermissionCatalogItem,
} from "@/lib/rbac/types";

type SupabaseClient = ReturnType<typeof createSupabaseAdminClient>;

type PermissionEffect = "allow" | "deny";

type MembershipRow = {
  id: string;
  user_id: string;
  role: OrganizationRole;
  status: "active" | "suspended";
  custom_role_id?: string | null;
};

type MembershipFallbackRow = Omit<MembershipRow, "custom_role_id">;

type CustomRolePermissionRow = {
  permission_key: string;
  effect: PermissionEffect;
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

type ApprovalRequestRow = {
  id: string;
  organization_id: string;
  permission_key: string;
  action_label: string;
  entity_type: string | null;
  entity_id: string | null;
  payload: Record<string, unknown> | null;
  status: ApprovalRequestStatus;
  requested_by: string;
  required_approvals: number;
  approved_count: number;
  approver_roles: OrganizationRole[] | null;
  approver_custom_role_ids: string[] | null;
  used_at: string | null;
  created_at: string;
  updated_at: string;
};

export type RbacActorMembership = {
  id: string;
  userId: string;
  role: OrganizationRole;
  status: "active" | "suspended";
  customRoleId: string | null;
};

export type PermissionCheckResult = {
  allowed: boolean;
  usedFallback: boolean;
  source: "system" | "custom" | "fallback";
};

export type AuthorizeActionSuccess = {
  ok: true;
  membership: RbacActorMembership;
  approvalRequestId: string | null;
  approvalAutoApproved: boolean;
  usedFallback: boolean;
};

export type AuthorizeActionFailure = {
  ok: false;
  status: number;
  error: string;
  code?: "approval_required";
  approvalRequestId?: string;
  usedFallback: boolean;
};

export type AuthorizeActionResult = AuthorizeActionSuccess | AuthorizeActionFailure;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const RBAC_PERMISSION_CATALOG: RbacPermissionCatalogItem[] = [
  {
    key: "action.rbac.manage",
    label: "Manage RBAC",
    description: "Create custom roles, permission rules, and assign role mappings.",
    domain: "security",
    risk: "high",
  },
  {
    key: "action.approvals.review",
    label: "Review Approvals",
    description: "Approve or reject pending approval requests.",
    domain: "security",
    risk: "high",
  },
  {
    key: "action.audit.logs.view",
    label: "View Activity Logs",
    description: "Access the organization audit timeline.",
    domain: "security",
    risk: "medium",
  },
  {
    key: "action.analytics.reports.view",
    label: "View Executive Analytics",
    description: "View cross-service KPI dashboards and reports.",
    domain: "analytics",
    risk: "medium",
  },
  {
    key: "action.analytics.reports.schedule.manage",
    label: "Manage Report Schedules",
    description: "Create, update, and delete scheduled executive report deliveries.",
    domain: "analytics",
    risk: "high",
  },
  {
    key: "action.team.invite.create",
    label: "Create Invites",
    description: "Invite members into the organization.",
    domain: "team",
    risk: "medium",
  },
  {
    key: "action.team.invite.revoke",
    label: "Revoke Invites",
    description: "Revoke active membership invites.",
    domain: "team",
    risk: "medium",
  },
  {
    key: "action.team.invite.resend",
    label: "Resend Invites",
    description: "Resend active membership invites.",
    domain: "team",
    risk: "low",
  },
  {
    key: "field.team.invite.role.admin.assign",
    label: "Invite Admin Role",
    description: "Assign admin role in team invitations.",
    domain: "team",
    risk: "high",
  },
  {
    key: "field.team.invite.role.manager.assign",
    label: "Invite Manager Role",
    description: "Assign manager role in team invitations.",
    domain: "team",
    risk: "high",
  },
  {
    key: "field.team.invite.role.support.assign",
    label: "Invite Support Role",
    description: "Assign support role in team invitations.",
    domain: "team",
    risk: "low",
  },
  {
    key: "field.team.invite.role.read_only.assign",
    label: "Invite Read-only Role",
    description: "Assign read-only role in team invitations.",
    domain: "team",
    risk: "low",
  },
  {
    key: "action.team.member.role.change",
    label: "Change Member Role",
    description: "Change role for existing team members.",
    domain: "team",
    risk: "high",
  },
  {
    key: "field.team.member.role.admin.assign",
    label: "Promote to Admin",
    description: "Assign admin role to existing members.",
    domain: "team",
    risk: "high",
  },
  {
    key: "field.team.member.role.manager.assign",
    label: "Assign Manager Role",
    description: "Assign manager role to existing members.",
    domain: "team",
    risk: "high",
  },
  {
    key: "field.team.member.role.support.assign",
    label: "Assign Support Role",
    description: "Assign support role to existing members.",
    domain: "team",
    risk: "medium",
  },
  {
    key: "field.team.member.role.read_only.assign",
    label: "Assign Read-only Role",
    description: "Assign read-only role to existing members.",
    domain: "team",
    risk: "low",
  },
  {
    key: "action.team.member.status.change",
    label: "Suspend/Reactivate Member",
    description: "Suspend or reactivate members.",
    domain: "team",
    risk: "high",
  },
  {
    key: "action.team.member.remove",
    label: "Remove Member",
    description: "Remove members from the organization.",
    domain: "team",
    risk: "high",
  },
  {
    key: "action.billing.order.payment_link.send",
    label: "Send Payment Links",
    description: "Generate and email Stripe payment links for orders.",
    domain: "billing",
    risk: "high",
  },
  {
    key: "action.incidents.create",
    label: "Create Incident",
    description: "Create incidents and declare customer-facing disruption.",
    domain: "incidents",
    risk: "medium",
  },
  {
    key: "action.incidents.update",
    label: "Update Incident",
    description: "Update incident status, severity, and impact mapping.",
    domain: "incidents",
    risk: "high",
  },
  {
    key: "action.incidents.timeline.update",
    label: "Post Incident Timeline Update",
    description: "Post incident timeline entries and status transitions.",
    domain: "incidents",
    risk: "medium",
  },
  {
    key: "action.automation.rules.manage",
    label: "Manage Automation Rules",
    description: "Create or update workflow automation rules.",
    domain: "automation",
    risk: "high",
  },
  {
    key: "action.automation.rules.delete",
    label: "Delete Automation Rules",
    description: "Delete automation rules permanently.",
    domain: "automation",
    risk: "high",
  },
];

const SYSTEM_ALLOW_PATTERNS: Record<OrganizationRole, string[]> = {
  admin: ["*"],
  manager: [
    "action.approvals.review",
    "action.audit.logs.view",
    "action.analytics.reports.view",
    "action.analytics.reports.schedule.manage",
    "action.team.invite.*",
    "field.team.invite.role.support.assign",
    "field.team.invite.role.read_only.assign",
    "action.incidents.*",
    "action.automation.rules.*",
    "action.billing.order.payment_link.send",
  ],
  support: [
    "action.analytics.reports.view",
    "action.incidents.create",
    "action.incidents.update",
    "action.incidents.timeline.update",
  ],
  read_only: [],
};

const SYSTEM_DENY_PATTERNS: Record<OrganizationRole, string[]> = {
  admin: [],
  manager: [
    "action.rbac.manage",
    "field.team.invite.role.admin.assign",
    "field.team.invite.role.manager.assign",
    "action.team.member.role.change",
    "action.team.member.status.change",
    "action.team.member.remove",
    "field.team.member.role.admin.assign",
    "field.team.member.role.manager.assign",
    "field.team.member.role.support.assign",
    "field.team.member.role.read_only.assign",
  ],
  support: [
    "action.rbac.manage",
    "action.approvals.review",
    "action.audit.logs.view",
    "action.team.*",
    "field.team.*",
    "action.billing.*",
    "action.automation.*",
  ],
  read_only: ["*"],
};

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

export function isMissingRbacSchema(
  error: { message?: string } | null | undefined,
): boolean {
  const message = (error?.message ?? "").toLowerCase();
  if (!message) {
    return false;
  }
  return (
    (message.includes("custom_roles") ||
      message.includes("custom_role_permissions") ||
      message.includes("custom_role_id") ||
      message.includes("approval_policies") ||
      message.includes("approval_requests") ||
      message.includes("approval_request_decisions")) &&
    (message.includes("schema cache") ||
      message.includes("does not exist") ||
      message.includes("column"))
  );
}

function permissionPatternMatches(pattern: string, permissionKey: string): boolean {
  const normalizedPattern = pattern.trim().toLowerCase();
  const normalizedKey = permissionKey.trim().toLowerCase();
  if (!normalizedPattern || !normalizedKey) {
    return false;
  }
  if (normalizedPattern === "*") {
    return true;
  }
  const escaped = normalizedPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regexPattern = `^${escaped.replace(/\\\*/g, ".*")}$`;
  return new RegExp(regexPattern, "i").test(normalizedKey);
}

function anyPatternMatches(patterns: string[], permissionKey: string): boolean {
  return patterns.some((pattern) => permissionPatternMatches(pattern, permissionKey));
}

export function listPermissionCatalog(): RbacPermissionCatalogItem[] {
  return [...RBAC_PERMISSION_CATALOG];
}

export async function loadActorMembership(params: {
  supabase: SupabaseClient;
  organizationId: string;
  userId: string;
}): Promise<{ membership: RbacActorMembership | null; error: string | null }> {
  const { supabase, organizationId, userId } = params;

  const withCustomRole = await supabase
    .from("organization_memberships")
    .select("id, user_id, role, status, custom_role_id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle<MembershipRow>();

  if (!withCustomRole.error) {
    const membership = withCustomRole.data;
    if (!membership) {
      return { membership: null, error: null };
    }
    return {
      membership: {
        id: membership.id,
        userId: membership.user_id,
        role: membership.role,
        status: membership.status,
        customRoleId: normalizeUuid(membership.custom_role_id),
      },
      error: null,
    };
  }

  const isMissingCustomRoleColumn = withCustomRole.error.message
    .toLowerCase()
    .includes("custom_role_id");
  if (!isMissingCustomRoleColumn) {
    return { membership: null, error: withCustomRole.error.message };
  }

  const fallback = await supabase
    .from("organization_memberships")
    .select("id, user_id, role, status")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle<MembershipFallbackRow>();

  if (fallback.error) {
    return { membership: null, error: fallback.error.message };
  }
  if (!fallback.data) {
    return { membership: null, error: null };
  }
  return {
    membership: {
      id: fallback.data.id,
      userId: fallback.data.user_id,
      role: fallback.data.role,
      status: fallback.data.status,
      customRoleId: null,
    },
    error: null,
  };
}

async function loadCustomRolePermissionRows(params: {
  supabase: SupabaseClient;
  organizationId: string;
  customRoleId: string | null;
}): Promise<
  | { rows: CustomRolePermissionRow[]; schemaMissing: false }
  | { rows: []; schemaMissing: true }
> {
  if (!params.customRoleId) {
    return { rows: [], schemaMissing: false };
  }

  const { supabase, organizationId, customRoleId } = params;
  const { data, error } = await supabase
    .from("custom_role_permissions")
    .select("permission_key, effect")
    .eq("organization_id", organizationId)
    .eq("role_id", customRoleId)
    .returns<CustomRolePermissionRow[]>();

  if (error) {
    if (isMissingRbacSchema(error)) {
      return { rows: [], schemaMissing: true };
    }
    throw new Error(`Failed to load custom role permissions: ${error.message}`);
  }

  return { rows: data ?? [], schemaMissing: false };
}

export async function evaluatePermissionForActor(params: {
  supabase: SupabaseClient;
  organizationId: string;
  membership: RbacActorMembership;
  permissionKey: string;
  fallbackAllowed: boolean;
}): Promise<PermissionCheckResult> {
  const permissionKey = normalizePermissionKey(params.permissionKey);
  if (!permissionKey) {
    return { allowed: false, usedFallback: false, source: "system" };
  }

  const { rows, schemaMissing } = await loadCustomRolePermissionRows({
    supabase: params.supabase,
    organizationId: params.organizationId,
    customRoleId: params.membership.customRoleId,
  });

  if (schemaMissing) {
    return {
      allowed: params.fallbackAllowed,
      usedFallback: true,
      source: "fallback",
    };
  }

  const customAllowPatterns = rows
    .filter((row) => row.effect === "allow")
    .map((row) => row.permission_key);
  const customDenyPatterns = rows
    .filter((row) => row.effect === "deny")
    .map((row) => row.permission_key);

  if (anyPatternMatches(customDenyPatterns, permissionKey)) {
    return { allowed: false, usedFallback: false, source: "custom" };
  }
  if (anyPatternMatches(customAllowPatterns, permissionKey)) {
    return { allowed: true, usedFallback: false, source: "custom" };
  }

  const systemAllowPatterns = SYSTEM_ALLOW_PATTERNS[params.membership.role] ?? [];
  const systemDenyPatterns = SYSTEM_DENY_PATTERNS[params.membership.role] ?? [];

  if (anyPatternMatches(systemDenyPatterns, permissionKey)) {
    return { allowed: false, usedFallback: false, source: "system" };
  }

  return {
    allowed: anyPatternMatches(systemAllowPatterns, permissionKey),
    usedFallback: false,
    source: "system",
  };
}

async function loadApprovalPolicy(params: {
  supabase: SupabaseClient;
  organizationId: string;
  permissionKey: string;
}): Promise<
  | { policy: ApprovalPolicyRow | null; schemaMissing: false }
  | { policy: null; schemaMissing: true }
> {
  const { supabase, organizationId, permissionKey } = params;
  const { data, error } = await supabase
    .from("approval_policies")
    .select(
      "id, permission_key, enabled, min_approvals, approver_roles, approver_custom_role_ids, created_at, updated_at",
    )
    .eq("organization_id", organizationId)
    .eq("permission_key", permissionKey)
    .maybeSingle<ApprovalPolicyRow>();

  if (error) {
    if (isMissingRbacSchema(error)) {
      return { policy: null, schemaMissing: true };
    }
    throw new Error(`Failed to load approval policy: ${error.message}`);
  }
  return { policy: data ?? null, schemaMissing: false };
}

function applyEntityFiltersToApprovalQuery<TQuery extends {
  eq: (column: string, value: unknown) => TQuery;
  is: (column: string, value: null) => TQuery;
}>(query: TQuery, entityType: string | null, entityId: string | null): TQuery {
  const withEntityType = entityType
    ? query.eq("entity_type", entityType)
    : query.is("entity_type", null);
  return entityId
    ? withEntityType.eq("entity_id", entityId)
    : withEntityType.is("entity_id", null);
}

async function findLatestApprovalRequestByStatus(params: {
  supabase: SupabaseClient;
  organizationId: string;
  requestedBy: string;
  permissionKey: string;
  entityType: string | null;
  entityId: string | null;
  status: ApprovalRequestStatus;
}): Promise<ApprovalRequestRow | null> {
  const {
    supabase,
    organizationId,
    requestedBy,
    permissionKey,
    status,
    entityType,
    entityId,
  } = params;
  let query = supabase
    .from("approval_requests")
    .select(
      "id, organization_id, permission_key, action_label, entity_type, entity_id, payload, status, requested_by, required_approvals, approved_count, approver_roles, approver_custom_role_ids, used_at, created_at, updated_at",
    )
    .eq("organization_id", organizationId)
    .eq("requested_by", requestedBy)
    .eq("permission_key", permissionKey)
    .eq("status", status);

  query = applyEntityFiltersToApprovalQuery(query, entityType, entityId);

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<ApprovalRequestRow>();

  if (error) {
    if (isMissingRbacSchema(error)) {
      return null;
    }
    throw new Error(`Failed to load approval request: ${error.message}`);
  }
  return data ?? null;
}

async function consumeApprovedRequest(params: {
  supabase: SupabaseClient;
  organizationId: string;
  requestId: string;
  userId: string;
}): Promise<boolean> {
  const { supabase, organizationId, requestId, userId } = params;
  const { data, error } = await supabase
    .from("approval_requests")
    .update({
      used_at: new Date().toISOString(),
      used_by: userId,
    })
    .eq("organization_id", organizationId)
    .eq("id", requestId)
    .is("used_at", null)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    if (isMissingRbacSchema(error)) {
      return true;
    }
    throw new Error(`Failed to consume approval request: ${error.message}`);
  }

  return Boolean(data?.id);
}

async function loadEligibleApproverIds(params: {
  supabase: SupabaseClient;
  organizationId: string;
  approverRoles: OrganizationRole[];
  approverCustomRoleIds: string[];
  excludeUserIds: string[];
}): Promise<string[]> {
  const {
    supabase,
    organizationId,
    approverRoles,
    approverCustomRoleIds,
    excludeUserIds,
  } = params;

  const withCustomRole = await supabase
    .from("organization_memberships")
    .select("user_id, role, status, custom_role_id")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .returns<MembershipRow[]>();

  let memberships: MembershipRow[] = [];
  if (!withCustomRole.error) {
    memberships = withCustomRole.data ?? [];
  } else {
    const isMissingCustomRoleColumn = withCustomRole.error.message
      .toLowerCase()
      .includes("custom_role_id");
    if (!isMissingCustomRoleColumn) {
      throw new Error(`Failed to load approval approvers: ${withCustomRole.error.message}`);
    }

    const fallback = await supabase
      .from("organization_memberships")
      .select("user_id, role, status")
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .returns<MembershipFallbackRow[]>();

    if (fallback.error) {
      throw new Error(`Failed to load approval approvers: ${fallback.error.message}`);
    }

    memberships = (fallback.data ?? []).map((row) => ({
      ...row,
      custom_role_id: null,
    }));
  }

  const excluded = new Set(excludeUserIds);
  const approverRoleSet = new Set(approverRoles);
  const approverCustomRoleSet = new Set(approverCustomRoleIds);
  const eligible = new Set<string>();

  for (const membership of memberships) {
    if (excluded.has(membership.user_id)) {
      continue;
    }
    const byRole = approverRoleSet.has(membership.role);
    const membershipCustomRoleId = normalizeUuid(membership.custom_role_id);
    const byCustomRole = membershipCustomRoleId
      ? approverCustomRoleSet.has(membershipCustomRoleId)
      : false;
    if (!byRole && !byCustomRole) {
      continue;
    }
    eligible.add(membership.user_id);
  }

  return Array.from(eligible);
}

async function createApprovalRequest(params: {
  supabase: SupabaseClient;
  organizationId: string;
  permissionKey: string;
  actionLabel: string;
  entityType: string | null;
  entityId: string | null;
  payload: Record<string, unknown> | null;
  requestedBy: string;
  policy: ApprovalPolicyRow;
  approverRoles: OrganizationRole[];
  approverCustomRoleIds: string[];
  autoApprove: boolean;
}): Promise<ApprovalRequestRow> {
  const {
    supabase,
    organizationId,
    permissionKey,
    actionLabel,
    entityType,
    entityId,
    payload,
    requestedBy,
    policy,
    approverRoles,
    approverCustomRoleIds,
    autoApprove,
  } = params;

  const { data, error } = await supabase
    .from("approval_requests")
    .insert({
      organization_id: organizationId,
      permission_key: permissionKey,
      action_label: actionLabel,
      entity_type: entityType,
      entity_id: entityId,
      payload,
      status: autoApprove ? "approved" : "pending",
      requested_by: requestedBy,
      policy_id: policy.id,
      required_approvals: policy.min_approvals,
      approved_count: autoApprove ? policy.min_approvals : 0,
      approver_roles: approverRoles,
      approver_custom_role_ids: approverCustomRoleIds,
    })
    .select(
      "id, organization_id, permission_key, action_label, entity_type, entity_id, payload, status, requested_by, required_approvals, approved_count, approver_roles, approver_custom_role_ids, used_at, created_at, updated_at",
    )
    .single<ApprovalRequestRow>();

  if (error || !data) {
    if (isMissingRbacSchema(error)) {
      throw new Error(
        "RBAC schema is missing. Run db/rbac-approvals-schema.sql and reload PostgREST schema.",
      );
    }
    throw new Error(`Failed to create approval request: ${error?.message ?? "Unknown error"}`);
  }

  return data;
}

async function notifyApprovers(params: {
  supabase: SupabaseClient;
  organizationId: string;
  requestId: string;
  actionLabel: string;
  approverUserIds: string[];
}): Promise<void> {
  const { supabase, organizationId, requestId, actionLabel, approverUserIds } = params;
  if (!approverUserIds.length) {
    return;
  }
  await insertAppNotifications(
    supabase,
    approverUserIds.map((userId) => ({
      userId,
      organizationId,
      type: "alert",
      title: "Approval required",
      body: actionLabel,
      entityType: "approval_request",
      entityId: requestId,
    })),
  );
}

export async function authorizeRbacAction(params: {
  supabase: SupabaseClient;
  organizationId: string;
  userId: string;
  permissionKey: string;
  actionLabel: string;
  fallbackAllowed: boolean;
  entityType?: string | null;
  entityId?: string | null;
  payload?: Record<string, unknown> | null;
  actorMembership?: RbacActorMembership | null;
  useApprovalFlow?: boolean;
}): Promise<AuthorizeActionResult> {
  const {
    supabase,
    organizationId,
    userId,
    actionLabel,
    fallbackAllowed,
    payload = null,
    useApprovalFlow = true,
  } = params;
  const permissionKey = normalizePermissionKey(params.permissionKey);
  const entityType = normalizeText(params.entityType);
  const entityId = normalizeText(params.entityId);

  if (!permissionKey) {
    return {
      ok: false,
      status: 400,
      error: "Invalid permission key",
      usedFallback: false,
    };
  }

  const actorMembership =
    params.actorMembership && params.actorMembership.status === "active"
      ? params.actorMembership
      : null;

  let membership = actorMembership;
  if (!membership) {
    const membershipResult = await loadActorMembership({
      supabase,
      organizationId,
      userId,
    });
    if (membershipResult.error) {
      return {
        ok: false,
        status: 500,
        error: `Failed to verify organization membership: ${membershipResult.error}`,
        usedFallback: false,
      };
    }
    membership = membershipResult.membership;
  }

  if (!membership) {
    return {
      ok: false,
      status: 403,
      error: "You do not have access to this organization",
      usedFallback: false,
    };
  }

  if (membership.status !== "active") {
    return {
      ok: false,
      status: 403,
      error: "Your organization membership is suspended",
      usedFallback: false,
    };
  }

  const permissionCheck = await evaluatePermissionForActor({
    supabase,
    organizationId,
    membership,
    permissionKey,
    fallbackAllowed,
  });

  if (!permissionCheck.allowed) {
    return {
      ok: false,
      status: 403,
      error: `Missing permission: ${permissionKey}`,
      usedFallback: permissionCheck.usedFallback,
    };
  }

  if (!useApprovalFlow) {
    return {
      ok: true,
      membership,
      approvalRequestId: null,
      approvalAutoApproved: false,
      usedFallback: permissionCheck.usedFallback,
    };
  }

  const policyResult = await loadApprovalPolicy({
    supabase,
    organizationId,
    permissionKey,
  });

  if (policyResult.schemaMissing || !policyResult.policy || !policyResult.policy.enabled) {
    return {
      ok: true,
      membership,
      approvalRequestId: null,
      approvalAutoApproved: false,
      usedFallback: permissionCheck.usedFallback,
    };
  }

  const approvedReusable = await findLatestApprovalRequestByStatus({
    supabase,
    organizationId,
    requestedBy: userId,
    permissionKey,
    entityType,
    entityId,
    status: "approved",
  });

  if (approvedReusable?.used_at === null) {
    const consumed = await consumeApprovedRequest({
      supabase,
      organizationId,
      requestId: approvedReusable.id,
      userId,
    });
    if (consumed) {
      return {
        ok: true,
        membership,
        approvalRequestId: approvedReusable.id,
        approvalAutoApproved: false,
        usedFallback: permissionCheck.usedFallback,
      };
    }
  }

  const pendingRequest = await findLatestApprovalRequestByStatus({
    supabase,
    organizationId,
    requestedBy: userId,
    permissionKey,
    entityType,
    entityId,
    status: "pending",
  });

  if (pendingRequest) {
    return {
      ok: false,
      status: 409,
      error: "Approval required before executing this action",
      code: "approval_required",
      approvalRequestId: pendingRequest.id,
      usedFallback: permissionCheck.usedFallback,
    };
  }

  const approverRoles = dedupeRoles(policyResult.policy.approver_roles);
  const approverCustomRoleIds = dedupeUuids(policyResult.policy.approver_custom_role_ids);
  const effectiveApproverRoles: OrganizationRole[] =
    approverRoles.length > 0 ? approverRoles : ["admin"];

  const eligibleApproverIds = await loadEligibleApproverIds({
    supabase,
    organizationId,
    approverRoles: effectiveApproverRoles,
    approverCustomRoleIds,
    excludeUserIds: [userId],
  });

  const autoApprove = eligibleApproverIds.length === 0;
  const createdRequest = await createApprovalRequest({
    supabase,
    organizationId,
    permissionKey,
    actionLabel,
    entityType,
    entityId,
    payload,
    requestedBy: userId,
    policy: policyResult.policy,
    approverRoles: effectiveApproverRoles,
    approverCustomRoleIds,
    autoApprove,
  });

  await writeAuditLog({
    supabase,
    organizationId,
    actorUserId: userId,
    action: autoApprove ? "approval.request.auto_approved" : "approval.request.created",
    entityType: "approval_request",
    entityId: createdRequest.id,
    details: {
      permissionKey,
      actionLabel,
      entityType,
      entityId,
      autoApprove,
      requiredApprovals: createdRequest.required_approvals,
    },
  });

  if (autoApprove) {
    await consumeApprovedRequest({
      supabase,
      organizationId,
      requestId: createdRequest.id,
      userId,
    });
    return {
      ok: true,
      membership,
      approvalRequestId: createdRequest.id,
      approvalAutoApproved: true,
      usedFallback: permissionCheck.usedFallback,
    };
  }

  await notifyApprovers({
    supabase,
    organizationId,
    requestId: createdRequest.id,
    actionLabel,
    approverUserIds: eligibleApproverIds,
  });

  return {
    ok: false,
    status: 409,
    error: "Approval required before executing this action",
    code: "approval_required",
    approvalRequestId: createdRequest.id,
    usedFallback: permissionCheck.usedFallback,
  };
}

function actorMatchesApproverPolicy(params: {
  membership: RbacActorMembership;
  approverRoles: OrganizationRole[];
  approverCustomRoleIds: string[];
}): boolean {
  const { membership } = params;
  const approverRoleSet = new Set(params.approverRoles);
  const approverCustomRoleSet = new Set(params.approverCustomRoleIds);
  const byRole = approverRoleSet.has(membership.role);
  const byCustomRole =
    membership.customRoleId !== null &&
    approverCustomRoleSet.has(membership.customRoleId);
  return byRole || byCustomRole;
}

export async function decideApprovalRequest(params: {
  supabase: SupabaseClient;
  organizationId: string;
  requestId: string;
  actorMembership: RbacActorMembership;
  decision: ApprovalDecision;
  comment?: string | null;
}): Promise<
  | { ok: true; requestId: string; status: ApprovalRequestStatus }
  | { ok: false; status: number; error: string }
> {
  const { supabase, organizationId, requestId, actorMembership, decision } = params;
  const comment = normalizeText(params.comment);

  const { data: request, error: requestError } = await supabase
    .from("approval_requests")
    .select(
      "id, organization_id, permission_key, action_label, entity_type, entity_id, payload, status, requested_by, required_approvals, approved_count, approver_roles, approver_custom_role_ids, used_at, created_at, updated_at",
    )
    .eq("organization_id", organizationId)
    .eq("id", requestId)
    .maybeSingle<ApprovalRequestRow>();

  if (requestError) {
    if (isMissingRbacSchema(requestError)) {
      return {
        ok: false,
        status: 500,
        error:
          "RBAC schema is missing. Run db/rbac-approvals-schema.sql and reload PostgREST schema.",
      };
    }
    return {
      ok: false,
      status: 500,
      error: `Failed to load approval request: ${requestError.message}`,
    };
  }

  if (!request) {
    return { ok: false, status: 404, error: "Approval request not found" };
  }

  if (request.status !== "pending") {
    return {
      ok: false,
      status: 409,
      error: `Approval request is already ${request.status}`,
    };
  }

  if (request.requested_by === actorMembership.userId) {
    return {
      ok: false,
      status: 403,
      error: "Requester cannot review their own approval request",
    };
  }

  const approverRoles = dedupeRoles(request.approver_roles);
  const approverCustomRoleIds = dedupeUuids(request.approver_custom_role_ids);
  if (
    !actorMatchesApproverPolicy({
      membership: actorMembership,
      approverRoles,
      approverCustomRoleIds,
    })
  ) {
    return {
      ok: false,
      status: 403,
      error: "You are not an approver for this request",
    };
  }

  const { error: insertDecisionError } = await supabase
    .from("approval_request_decisions")
    .insert({
      organization_id: organizationId,
      request_id: request.id,
      decided_by: actorMembership.userId,
      decision,
      comment,
    });

  if (insertDecisionError) {
    const message = insertDecisionError.message.toLowerCase();
    if (message.includes("unique")) {
      return {
        ok: false,
        status: 409,
        error: "You already reviewed this request",
      };
    }
    return {
      ok: false,
      status: 500,
      error: `Failed to store approval decision: ${insertDecisionError.message}`,
    };
  }

  let nextStatus: ApprovalRequestStatus = "pending";
  if (decision === "rejected") {
    nextStatus = "rejected";
  } else {
    const { count: approvedCount, error: approvedCountError } = await supabase
      .from("approval_request_decisions")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("request_id", request.id)
      .eq("decision", "approved");

    if (approvedCountError) {
      return {
        ok: false,
        status: 500,
        error: `Failed to aggregate approval decisions: ${approvedCountError.message}`,
      };
    }

    if ((approvedCount ?? 0) >= request.required_approvals) {
      nextStatus = "approved";
    }
  }

  const { error: updateRequestError } = await supabase
    .from("approval_requests")
    .update({
      status: nextStatus,
      approved_count:
        nextStatus === "approved" ? request.required_approvals : request.approved_count,
    })
    .eq("organization_id", organizationId)
    .eq("id", request.id);

  if (updateRequestError) {
    return {
      ok: false,
      status: 500,
      error: `Decision saved but request update failed: ${updateRequestError.message}`,
    };
  }

  await writeAuditLog({
    supabase,
    organizationId,
    actorUserId: actorMembership.userId,
    action: decision === "approved" ? "approval.request.approved" : "approval.request.rejected",
    entityType: "approval_request",
    entityId: request.id,
    details: {
      permissionKey: request.permission_key,
      actionLabel: request.action_label,
      decision,
      comment: comment ?? null,
      resultingStatus: nextStatus,
    },
  });

  return { ok: true, requestId: request.id, status: nextStatus };
}

export function fallbackAssignableInviteRoles(actorRole: OrganizationRole): OrganizationRole[] {
  if (actorRole === "admin") {
    return ["admin", "manager", "support", "read_only"];
  }
  if (actorRole === "manager") {
    return ["support", "read_only"];
  }
  return [];
}

export function fallbackAssignableMemberRoles(actorRole: OrganizationRole): OrganizationRole[] {
  if (actorRole === "admin") {
    return ["admin", "manager", "support", "read_only"];
  }
  return [];
}

export function toApprovalPolicyItem(row: ApprovalPolicyRow): ApprovalPolicyItem {
  return {
    id: row.id,
    permission_key: row.permission_key,
    enabled: row.enabled,
    min_approvals: row.min_approvals,
    approver_roles: dedupeRoles(row.approver_roles),
    approver_custom_role_ids: dedupeUuids(row.approver_custom_role_ids),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
