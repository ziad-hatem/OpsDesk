import { NextResponse } from "next/server";
import type {
  ReportsCompareWith,
  ReportsScheduleFrequency,
  ReportsSchedulesResponse,
  ReportsScheduleItem,
  ReportsScheduleRunItem,
} from "@/lib/reports/types";
import { getOrganizationActorContext } from "@/lib/server/organization-context";
import { writeAuditLog } from "@/lib/server/audit-logs";
import { authorizeRbacAction } from "@/lib/server/rbac";
import { computeNextRunAt } from "@/lib/server/executive-analytics";
import { missingTableMessageWithMigration } from "@/lib/tickets/errors";
import { normalizeEmail } from "@/lib/team/validation";

type RouteContext = {
  params: Promise<{ orgId: string }>;
};

type ScheduleRow = ReportsScheduleItem;

type RunRow = ReportsScheduleRunItem;

type CreateScheduleBody = {
  name?: string;
  frequency?: ReportsScheduleFrequency;
  compareWith?: ReportsCompareWith;
  rangeDays?: number;
  timezone?: string;
  recipients?: string[] | string;
  nextRunAt?: string;
  isEnabled?: boolean;
};

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeCompareWith(value: unknown): ReportsCompareWith {
  if (value === "year" || value === "none") {
    return value;
  }
  return "previous";
}

function normalizeFrequency(value: unknown): ReportsScheduleFrequency | null {
  if (value === "daily" || value === "weekly" || value === "monthly") {
    return value;
  }
  return null;
}

function normalizeRangeDays(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return 30;
  }
  return Math.min(365, Math.max(1, parsed));
}

function normalizeRecipients(value: unknown): string[] {
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];

  const normalized = new Set<string>();
  for (const item of rawItems) {
    const email = normalizeEmail(item);
    if (email) {
      normalized.add(email);
    }
  }
  return Array.from(normalized);
}

function normalizeNextRunAt(value: unknown): Date | null {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function isMissingExecutiveAnalyticsSchema(error: { message?: string } | null | undefined): boolean {
  const message = (error?.message ?? "").toLowerCase();
  if (!message) {
    return false;
  }

  return (
    (message.includes("analytics_report_schedules") ||
      message.includes("analytics_report_runs")) &&
    (message.includes("schema cache") || message.includes("does not exist"))
  );
}

function isUniqueConstraintViolation(error: { message?: string } | null | undefined): boolean {
  const message = (error?.message ?? "").toLowerCase();
  return message.includes("unique") || message.includes("duplicate");
}

async function resolveOrgId(context: RouteContext): Promise<string> {
  const params = await context.params;
  return params.orgId?.trim() ?? "";
}

function toFallbackCanManage(role: "admin" | "manager" | "support" | "read_only") {
  return role === "admin" || role === "manager";
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

  const { supabase, userId, actorMembership } = actorContextResult.context;

  const authorization = await authorizeRbacAction({
    supabase,
    organizationId: orgId,
    userId,
    permissionKey: "action.analytics.reports.schedule.manage",
    actionLabel: "Manage executive report schedules",
    fallbackAllowed: toFallbackCanManage(actorMembership.role),
    useApprovalFlow: false,
    actorMembership: {
      id: actorMembership.id,
      userId,
      role: actorMembership.role,
      status: actorMembership.status,
      customRoleId: actorMembership.custom_role_id ?? null,
    },
  });

  if (!authorization.ok) {
    return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  }

  const [schedulesResult, runsResult] = await Promise.all([
    supabase
      .from("analytics_report_schedules")
      .select(
        "id, organization_id, name, frequency, compare_with, range_days, timezone, recipients, is_enabled, next_run_at, last_run_at, last_status, created_by, created_at, updated_at",
      )
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .returns<ScheduleRow[]>(),
    supabase
      .from("analytics_report_runs")
      .select(
        "id, organization_id, schedule_id, status, recipients, report_from, report_to, error_message, delivered_at, created_at",
      )
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(30)
      .returns<RunRow[]>(),
  ]);

  if (schedulesResult.error || runsResult.error) {
    const schemaMissing =
      isMissingExecutiveAnalyticsSchema(schedulesResult.error) ||
      isMissingExecutiveAnalyticsSchema(runsResult.error);
    if (schemaMissing) {
      return NextResponse.json(
        {
          error: missingTableMessageWithMigration(
            "analytics_report_schedules",
            "db/executive-analytics-schema.sql",
          ),
        },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        error:
          schedulesResult.error?.message ??
          runsResult.error?.message ??
          "Failed to load schedules",
      },
      { status: 500 },
    );
  }

  const payload: ReportsSchedulesResponse = {
    activeOrgId: orgId,
    schedules: schedulesResult.data ?? [],
    recentRuns: runsResult.data ?? [],
  };

  return NextResponse.json(payload, { status: 200 });
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

  const { supabase, userId, actorMembership } = actorContextResult.context;

  const authorization = await authorizeRbacAction({
    supabase,
    organizationId: orgId,
    userId,
    permissionKey: "action.analytics.reports.schedule.manage",
    actionLabel: "Create executive report schedule",
    fallbackAllowed: toFallbackCanManage(actorMembership.role),
    useApprovalFlow: true,
    entityType: "executive_report_schedule",
    actorMembership: {
      id: actorMembership.id,
      userId,
      role: actorMembership.role,
      status: actorMembership.status,
      customRoleId: actorMembership.custom_role_id ?? null,
    },
  });

  if (!authorization.ok) {
    return NextResponse.json(
      {
        error: authorization.error,
        code: authorization.code,
        approvalRequestId: authorization.approvalRequestId ?? null,
      },
      { status: authorization.status },
    );
  }

  let body: CreateScheduleBody = {};
  try {
    body = (await req.json()) as CreateScheduleBody;
  } catch {
    body = {};
  }

  const name = normalizeText(body.name);
  if (!name) {
    return NextResponse.json({ error: "Schedule name is required" }, { status: 400 });
  }

  const frequency = normalizeFrequency(body.frequency);
  if (!frequency) {
    return NextResponse.json(
      { error: "frequency must be one of daily, weekly, monthly" },
      { status: 400 },
    );
  }

  const recipients = normalizeRecipients(body.recipients);
  if (recipients.length === 0) {
    return NextResponse.json(
      { error: "At least one valid recipient email is required" },
      { status: 400 },
    );
  }

  const compareWith = normalizeCompareWith(body.compareWith);
  const rangeDays = normalizeRangeDays(body.rangeDays);
  const timezone = normalizeText(body.timezone) ?? "UTC";
  const requestedNextRunAt = normalizeNextRunAt(body.nextRunAt);
  const nextRunAt = requestedNextRunAt
    ? requestedNextRunAt.toISOString()
    : computeNextRunAt({
        frequency,
        from: new Date(),
      });

  const { data: inserted, error: insertError } = await supabase
    .from("analytics_report_schedules")
    .insert({
      organization_id: orgId,
      name,
      frequency,
      compare_with: compareWith,
      range_days: rangeDays,
      timezone,
      recipients,
      is_enabled: body.isEnabled !== false,
      next_run_at: nextRunAt,
      created_by: userId,
    })
    .select(
      "id, organization_id, name, frequency, compare_with, range_days, timezone, recipients, is_enabled, next_run_at, last_run_at, last_status, created_by, created_at, updated_at",
    )
    .maybeSingle<ScheduleRow>();

  if (insertError || !inserted) {
    if (isMissingExecutiveAnalyticsSchema(insertError)) {
      return NextResponse.json(
        {
          error: missingTableMessageWithMigration(
            "analytics_report_schedules",
            "db/executive-analytics-schema.sql",
          ),
        },
        { status: 500 },
      );
    }

    if (isUniqueConstraintViolation(insertError)) {
      return NextResponse.json(
        { error: "A schedule with this name already exists" },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: `Failed to create schedule: ${insertError?.message ?? "Unknown error"}` },
      { status: 500 },
    );
  }

  await writeAuditLog({
    supabase,
    organizationId: orgId,
    actorUserId: userId,
    action: "reports.schedule.created",
    entityType: "executive_report_schedule",
    entityId: inserted.id,
    details: {
      name,
      frequency,
      recipientsCount: recipients.length,
      rangeDays,
      compareWith,
    },
  });

  return NextResponse.json({ schedule: inserted }, { status: 201 });
}
