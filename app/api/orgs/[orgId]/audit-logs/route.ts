import { NextResponse } from "next/server";
import { toAuditActionLabel } from "@/lib/audit/format";
import type { AuditLogItem, AuditLogsResponse, AuditLogUser } from "@/lib/audit/types";
import { getOrganizationActorContext } from "@/lib/server/organization-context";
import { authorizeRbacAction } from "@/lib/server/rbac";
import { isMissingTableInSchemaCache } from "@/lib/tickets/errors";

type RouteContext = {
  params: Promise<{ orgId: string }>;
};

type AuditLogRow = {
  id: string;
  organization_id: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  target_user_id?: string | null;
  source?: string | null;
  details?: Record<string, unknown> | null;
  created_at: string;
};

type UserRow = {
  id: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
};

function isMissingAuditLogSchema(errorMessage: string): boolean {
  const message = errorMessage.toLowerCase();
  return (
    message.includes("audit_logs") &&
    (message.includes("schema cache") || message.includes("does not exist"))
  );
}

function isMissingExtendedAuditLogColumns(errorMessage: string): boolean {
  const message = errorMessage.toLowerCase();
  return (
    message.includes("audit_logs") &&
    message.includes("column") &&
    (message.includes("target_user_id") ||
      message.includes("source") ||
      message.includes("details"))
  );
}

function normalizePositiveInt(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function normalizeIsoStart(value: string | null): string | null {
  if (!value) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value}T00:00:00.000Z`;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function normalizeIsoEndExclusive(value: string | null): string | null {
  if (!value) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const start = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime())) {
      return null;
    }
    start.setUTCDate(start.getUTCDate() + 1);
    return start.toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function toAuditLogUser(
  userId: string | null,
  usersById: Map<string, AuditLogUser>,
): AuditLogUser | null {
  if (!userId) {
    return null;
  }
  return usersById.get(userId) ?? { id: userId, name: null, email: null, avatar_url: null };
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

  const authorizeAudit = await authorizeRbacAction({
    supabase,
    organizationId: orgId,
    userId,
    permissionKey: "action.audit.logs.view",
    actionLabel: "View activity logs",
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
  if (!authorizeAudit.ok) {
    return NextResponse.json(
      { error: authorizeAudit.error },
      { status: authorizeAudit.status },
    );
  }

  const { searchParams } = new URL(req.url);
  const actionFilter = searchParams.get("action")?.trim() ?? "";
  const actorUserIdFilter = searchParams.get("actorUserId")?.trim() ?? "";
  const fromIso = normalizeIsoStart(searchParams.get("from"));
  const toIsoExclusive = normalizeIsoEndExclusive(searchParams.get("to"));
  const page = normalizePositiveInt(searchParams.get("page"), 1);
  const limit = Math.min(100, normalizePositiveInt(searchParams.get("limit"), 25));
  const offset = (page - 1) * limit;

  const queryAuditLogs = async (selectClause: string) => {
    let query = supabase
      .from("audit_logs")
      .select(selectClause, { count: "exact" })
      .eq("organization_id", orgId);

    if (actionFilter) {
      query = query.eq("action", actionFilter);
    }
    if (actorUserIdFilter) {
      query = query.eq("actor_user_id", actorUserIdFilter);
    }
    if (fromIso) {
      query = query.gte("created_at", fromIso);
    }
    if (toIsoExclusive) {
      query = query.lt("created_at", toIsoExclusive);
    }

    return await query
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1)
      .returns<AuditLogRow[]>();
  };

  let auditLogsResult = await queryAuditLogs(
    "id, organization_id, actor_user_id, action, entity_type, entity_id, target_user_id, source, details, created_at",
  );

  if (
    auditLogsResult.error &&
    isMissingExtendedAuditLogColumns(auditLogsResult.error.message)
  ) {
    auditLogsResult = await queryAuditLogs(
      "id, organization_id, actor_user_id, action, entity_type, entity_id, created_at",
    );
  }

  if (auditLogsResult.error) {
    if (
      isMissingAuditLogSchema(auditLogsResult.error.message) ||
      isMissingTableInSchemaCache(auditLogsResult.error, "audit_logs")
    ) {
      return NextResponse.json(
        {
          error:
            "Audit log table is missing or out of date. Run db/audit-logs-schema.sql in Supabase SQL Editor, then run: NOTIFY pgrst, 'reload schema';",
        },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { error: `Failed to load audit logs: ${auditLogsResult.error.message}` },
      { status: 500 },
    );
  }

  const rows = auditLogsResult.data ?? [];

  let actionOptions: string[] = [];
  {
    const { data: actionRows, error: actionsError } = await supabase
      .from("audit_logs")
      .select("action")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(400)
      .returns<Array<{ action: string }>>();

    if (actionsError) {
      if (!isMissingAuditLogSchema(actionsError.message)) {
        console.error(`Failed to load audit action options: ${actionsError.message}`);
      }
    } else {
      actionOptions = Array.from(
        new Set((actionRows ?? []).map((row) => row.action).filter(Boolean)),
      ).sort((a, b) => a.localeCompare(b));
    }
  }

  const actorIdsForFilterResult = await supabase
    .from("audit_logs")
    .select("actor_user_id")
    .eq("organization_id", orgId)
    .not("actor_user_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(400)
    .returns<Array<{ actor_user_id: string | null }>>();

  const actorIds = new Set<string>();
  for (const row of rows) {
    if (row.actor_user_id) {
      actorIds.add(row.actor_user_id);
    }
    if (typeof row.target_user_id === "string" && row.target_user_id) {
      actorIds.add(row.target_user_id);
    }
  }
  for (const row of actorIdsForFilterResult.data ?? []) {
    if (row.actor_user_id) {
      actorIds.add(row.actor_user_id);
    }
  }

  const usersById = new Map<string, AuditLogUser>();
  if (actorIds.size > 0) {
    const { data: usersData, error: usersError } = await supabase
      .from("users")
      .select("id, name, email, avatar_url")
      .in("id", Array.from(actorIds))
      .returns<UserRow[]>();

    if (usersError) {
      return NextResponse.json(
        { error: `Failed to load audit log users: ${usersError.message}` },
        { status: 500 },
      );
    }

    for (const user of usersData ?? []) {
      usersById.set(user.id, {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar_url: user.avatar_url,
      });
    }
  }

  const items: AuditLogItem[] = rows.map((row) => ({
    id: row.id,
    organization_id: row.organization_id,
    actor_user_id: row.actor_user_id,
    action: row.action,
    action_label: toAuditActionLabel(row.action),
    entity_type: row.entity_type ?? null,
    entity_id: row.entity_id ?? null,
    target_user_id:
      typeof row.target_user_id === "string" ? row.target_user_id : null,
    source: typeof row.source === "string" ? row.source : null,
    details:
      row.details && typeof row.details === "object" && !Array.isArray(row.details)
        ? row.details
        : null,
    created_at: row.created_at,
    actor: toAuditLogUser(row.actor_user_id, usersById),
    target: toAuditLogUser(
      typeof row.target_user_id === "string" ? row.target_user_id : null,
      usersById,
    ),
  }));

  const availableActors = Array.from(actorIds)
    .map((userId) => usersById.get(userId))
    .filter((user): user is AuditLogUser => Boolean(user))
    .sort((a, b) => {
      const left = (a.name ?? a.email ?? a.id).toLowerCase();
      const right = (b.name ?? b.email ?? b.id).toLowerCase();
      return left.localeCompare(right);
    });

  const payload: AuditLogsResponse = {
    activeOrgId: orgId,
    items,
    availableActions: actionOptions,
    availableActors,
    total: auditLogsResult.count ?? items.length,
    page,
    limit,
  };

  return NextResponse.json(payload, { status: 200 });
}
