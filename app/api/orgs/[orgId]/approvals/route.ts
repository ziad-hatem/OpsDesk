import { NextResponse } from "next/server";
import type { ApprovalQueueResponse, ApprovalRequestItem } from "@/lib/rbac/types";
import { authorizeRbacAction, isMissingRbacSchema } from "@/lib/server/rbac";
import { getOrganizationActorContext } from "@/lib/server/organization-context";

type RouteContext = {
  params: Promise<{ orgId: string }>;
};

type ApprovalRequestRow = {
  id: string;
  permission_key: string;
  action_label: string;
  entity_type: string | null;
  entity_id: string | null;
  payload: Record<string, unknown> | null;
  status: "pending" | "approved" | "rejected" | "cancelled" | "expired";
  requested_by: string;
  required_approvals: number;
  approved_count: number;
  approver_roles: Array<"admin" | "manager" | "support" | "read_only"> | null;
  approver_custom_role_ids: string[] | null;
  used_at: string | null;
  created_at: string;
  updated_at: string;
};

type ApprovalDecisionRow = {
  id: string;
  request_id: string;
  decided_by: string;
  decision: "approved" | "rejected";
  comment: string | null;
  created_at: string;
};

type UserRow = {
  id: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
};

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeStatus(value: string | null): ApprovalRequestRow["status"] | "all" {
  if (value === "pending" || value === "approved" || value === "rejected" || value === "cancelled" || value === "expired") {
    return value;
  }
  return "all";
}

function toRoles(value: unknown): Array<"admin" | "manager" | "support" | "read_only"> {
  const values = Array.isArray(value) ? value : [];
  const roles = new Set<"admin" | "manager" | "support" | "read_only">();
  for (const item of values) {
    if (item === "admin" || item === "manager" || item === "support" || item === "read_only") {
      roles.add(item);
    }
  }
  return Array.from(roles);
}

function toUuids(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [];
  const ids = new Set<string>();
  for (const item of values) {
    const normalized = normalizeText(item);
    if (normalized) {
      ids.add(normalized);
    }
  }
  return Array.from(ids);
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

export async function GET(req: Request, context: RouteContext) {
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

  const { searchParams } = new URL(req.url);
  const scope = searchParams.get("scope") === "requested" ? "requested" : "inbox";
  const statusFilter = normalizeStatus(searchParams.get("status"));
  const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? "100")));

  if (scope === "inbox") {
    const canReviewResult = await authorizeRbacAction({
      supabase,
      organizationId: orgId,
      userId,
      permissionKey: "action.approvals.review",
      actionLabel: "View approval inbox",
      fallbackAllowed: actorMembership.role === "admin" || actorMembership.role === "manager",
      useApprovalFlow: false,
      actorMembership: {
        id: actorMembership.id,
        userId,
        role: actorMembership.role,
        status: actorMembership.status,
        customRoleId: actorMembership.custom_role_id ?? null,
      },
    });

    if (!canReviewResult.ok) {
      return NextResponse.json(
        { error: canReviewResult.error },
        { status: canReviewResult.status },
      );
    }
  }

  let query = supabase
    .from("approval_requests")
    .select(
      "id, permission_key, action_label, entity_type, entity_id, payload, status, requested_by, required_approvals, approved_count, approver_roles, approver_custom_role_ids, used_at, created_at, updated_at",
    )
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (statusFilter !== "all") {
    query = query.eq("status", statusFilter);
  }
  if (scope === "requested") {
    query = query.eq("requested_by", userId);
  }

  const { data: requestRows, error: requestsError } = await query.returns<ApprovalRequestRow[]>();
  if (requestsError) {
    if (isMissingRbacSchema(requestsError)) {
      return missingSchemaResponse();
    }
    return NextResponse.json(
      { error: `Failed to load approval requests: ${requestsError.message}` },
      { status: 500 },
    );
  }

  const actorCustomRoleId = actorMembership.custom_role_id ?? null;
  const filteredRequests = (requestRows ?? []).filter((requestRow) => {
    if (scope === "requested") {
      return true;
    }
    if (requestRow.requested_by === userId) {
      return false;
    }
    const approverRoles = toRoles(requestRow.approver_roles);
    const approverCustomRoleIds = toUuids(requestRow.approver_custom_role_ids);
    const byRole = approverRoles.includes(actorMembership.role);
    const byCustomRole = actorCustomRoleId ? approverCustomRoleIds.includes(actorCustomRoleId) : false;
    return byRole || byCustomRole;
  });

  const requestIds = filteredRequests.map((requestRow) => requestRow.id);
  let decisionRows: ApprovalDecisionRow[] = [];
  if (requestIds.length > 0) {
    const { data, error } = await supabase
      .from("approval_request_decisions")
      .select("id, request_id, decided_by, decision, comment, created_at")
      .eq("organization_id", orgId)
      .in("request_id", requestIds)
      .order("created_at", { ascending: true })
      .returns<ApprovalDecisionRow[]>();
    if (error) {
      if (isMissingRbacSchema(error)) {
        return missingSchemaResponse();
      }
      return NextResponse.json(
        { error: `Failed to load approval decisions: ${error.message}` },
        { status: 500 },
      );
    }
    decisionRows = data ?? [];
  }

  const userIds = Array.from(
    new Set(
      [
        ...filteredRequests.map((requestRow) => requestRow.requested_by),
        ...decisionRows.map((decisionRow) => decisionRow.decided_by),
      ].filter(Boolean),
    ),
  );
  let usersById = new Map<string, UserRow>();
  if (userIds.length > 0) {
    const { data, error } = await supabase
      .from("users")
      .select("id, name, email, avatar_url")
      .in("id", userIds)
      .returns<UserRow[]>();
    if (error) {
      return NextResponse.json(
        { error: `Failed to load approval actors: ${error.message}` },
        { status: 500 },
      );
    }
    usersById = new Map((data ?? []).map((user) => [user.id, user]));
  }

  const decisionsByRequestId = new Map<string, ApprovalDecisionRow[]>();
  for (const decision of decisionRows) {
    const existing = decisionsByRequestId.get(decision.request_id);
    if (existing) {
      existing.push(decision);
    } else {
      decisionsByRequestId.set(decision.request_id, [decision]);
    }
  }

  const requests: ApprovalRequestItem[] = filteredRequests.map((requestRow) => ({
    id: requestRow.id,
    permission_key: requestRow.permission_key,
    action_label: requestRow.action_label,
    entity_type: requestRow.entity_type,
    entity_id: requestRow.entity_id,
    payload: requestRow.payload,
    status: requestRow.status,
    requested_by: requestRow.requested_by,
    required_approvals: requestRow.required_approvals,
    approved_count: requestRow.approved_count,
    approver_roles: toRoles(requestRow.approver_roles),
    approver_custom_role_ids: toUuids(requestRow.approver_custom_role_ids),
    used_at: requestRow.used_at,
    created_at: requestRow.created_at,
    updated_at: requestRow.updated_at,
    requester: usersById.get(requestRow.requested_by) ?? null,
    decisions: (decisionsByRequestId.get(requestRow.id) ?? []).map((decisionRow) => ({
      id: decisionRow.id,
      request_id: decisionRow.request_id,
      decided_by: decisionRow.decided_by,
      decision: decisionRow.decision,
      comment: decisionRow.comment,
      created_at: decisionRow.created_at,
      decider: usersById.get(decisionRow.decided_by) ?? null,
    })),
  }));

  const payload: ApprovalQueueResponse = {
    activeOrgId: orgId,
    currentUserId: userId,
    scope,
    statusFilter,
    requests,
  };
  return NextResponse.json(payload, { status: 200 });
}
