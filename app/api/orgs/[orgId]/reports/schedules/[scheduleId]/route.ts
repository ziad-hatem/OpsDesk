import { NextResponse } from "next/server";
import type {
  ReportsCompareWith,
  ReportsScheduleFrequency,
  ReportsScheduleItem,
} from "@/lib/reports/types";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getOrganizationActorContext } from "@/lib/server/organization-context";
import { writeAuditLog } from "@/lib/server/audit-logs";
import { authorizeRbacAction } from "@/lib/server/rbac";
import { computeNextRunAt } from "@/lib/server/executive-analytics";
import { missingTableMessageWithMigration } from "@/lib/tickets/errors";
import { normalizeEmail } from "@/lib/team/validation";

type RouteContext = {
  params: Promise<{ orgId: string; scheduleId: string }>;
};

type ScheduleRow = ReportsScheduleItem;
type SupabaseClient = ReturnType<typeof createSupabaseAdminClient>;

type UpdateScheduleBody = {
  name?: string;
  frequency?: ReportsScheduleFrequency;
  compareWith?: ReportsCompareWith;
  rangeDays?: number;
  timezone?: string;
  recipients?: string[] | string;
  isEnabled?: boolean;
  nextRunAt?: string;
};

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeCompareWith(value: unknown): ReportsCompareWith | null {
  if (value === "previous" || value === "year" || value === "none") {
    return value;
  }
  return null;
}

function normalizeFrequency(value: unknown): ReportsScheduleFrequency | null {
  if (value === "daily" || value === "weekly" || value === "monthly") {
    return value;
  }
  return null;
}

function normalizeRangeDays(value: unknown): number | null {
  if (typeof value === "undefined") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return null;
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

function normalizeNextRunAt(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) {
    return null;
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function isMissingExecutiveAnalyticsSchema(error: { message?: string } | null | undefined): boolean {
  const message = (error?.message ?? "").toLowerCase();
  if (!message) {
    return false;
  }

  return (
    message.includes("analytics_report_schedules") &&
    (message.includes("schema cache") || message.includes("does not exist"))
  );
}

function toFallbackCanManage(role: "admin" | "manager" | "support" | "read_only") {
  return role === "admin" || role === "manager";
}

async function resolveParams(context: RouteContext): Promise<{ orgId: string; scheduleId: string }> {
  const params = await context.params;
  return {
    orgId: params.orgId?.trim() ?? "",
    scheduleId: params.scheduleId?.trim() ?? "",
  };
}

async function loadSchedule(
  orgId: string,
  scheduleId: string,
  supabase: SupabaseClient,
): Promise<{ schedule: ScheduleRow | null; error: { message?: string } | null }> {
  const result = await supabase
    .from("analytics_report_schedules")
    .select(
      "id, organization_id, name, frequency, compare_with, range_days, timezone, recipients, is_enabled, next_run_at, last_run_at, last_status, created_by, created_at, updated_at",
    )
    .eq("organization_id", orgId)
    .eq("id", scheduleId)
    .maybeSingle<ScheduleRow>();

  return {
    schedule: result.data ?? null,
    error: result.error,
  };
}

export async function PATCH(req: Request, context: RouteContext) {
  const { orgId, scheduleId } = await resolveParams(context);
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
    actionLabel: "Update executive report schedule",
    fallbackAllowed: toFallbackCanManage(actorMembership.role),
    useApprovalFlow: true,
    entityType: "executive_report_schedule",
    entityId: scheduleId,
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

  const existingResult = await loadSchedule(orgId, scheduleId, supabase);
  if (existingResult.error) {
    if (isMissingExecutiveAnalyticsSchema(existingResult.error)) {
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
      { error: `Failed to load schedule: ${existingResult.error.message}` },
      { status: 500 },
    );
  }

  if (!existingResult.schedule) {
    return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  }

  let body: UpdateScheduleBody = {};
  try {
    body = (await req.json()) as UpdateScheduleBody;
  } catch {
    body = {};
  }

  const updatePayload: Partial<ScheduleRow> & Record<string, unknown> = {};

  if (Object.prototype.hasOwnProperty.call(body, "name")) {
    const name = normalizeText(body.name);
    if (!name) {
      return NextResponse.json({ error: "name must be a non-empty string" }, { status: 400 });
    }
    updatePayload.name = name;
  }

  if (Object.prototype.hasOwnProperty.call(body, "frequency")) {
    const frequency = normalizeFrequency(body.frequency);
    if (!frequency) {
      return NextResponse.json(
        { error: "frequency must be one of daily, weekly, monthly" },
        { status: 400 },
      );
    }
    updatePayload.frequency = frequency;

    if (!Object.prototype.hasOwnProperty.call(body, "nextRunAt")) {
      updatePayload.next_run_at = computeNextRunAt({
        frequency,
        from: new Date(existingResult.schedule.next_run_at),
      });
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "compareWith")) {
    const compareWith = normalizeCompareWith(body.compareWith);
    if (!compareWith) {
      return NextResponse.json(
        { error: "compareWith must be previous, year, or none" },
        { status: 400 },
      );
    }
    updatePayload.compare_with = compareWith;
  }

  if (Object.prototype.hasOwnProperty.call(body, "rangeDays")) {
    const rangeDays = normalizeRangeDays(body.rangeDays);
    if (!rangeDays) {
      return NextResponse.json(
        { error: "rangeDays must be an integer between 1 and 365" },
        { status: 400 },
      );
    }
    updatePayload.range_days = rangeDays;
  }

  if (Object.prototype.hasOwnProperty.call(body, "timezone")) {
    const timezone = normalizeText(body.timezone);
    if (!timezone) {
      return NextResponse.json({ error: "timezone must be a non-empty string" }, { status: 400 });
    }
    updatePayload.timezone = timezone;
  }

  if (Object.prototype.hasOwnProperty.call(body, "recipients")) {
    const recipients = normalizeRecipients(body.recipients);
    if (recipients.length === 0) {
      return NextResponse.json(
        { error: "At least one valid recipient email is required" },
        { status: 400 },
      );
    }
    updatePayload.recipients = recipients;
  }

  if (Object.prototype.hasOwnProperty.call(body, "isEnabled")) {
    updatePayload.is_enabled = body.isEnabled === true;
  }

  if (Object.prototype.hasOwnProperty.call(body, "nextRunAt")) {
    const nextRunAt = normalizeNextRunAt(body.nextRunAt);
    if (!nextRunAt) {
      return NextResponse.json(
        { error: "nextRunAt must be a valid ISO date-time" },
        { status: 400 },
      );
    }
    updatePayload.next_run_at = nextRunAt;
  }

  if (Object.keys(updatePayload).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const { data: updated, error: updateError } = await supabase
    .from("analytics_report_schedules")
    .update(updatePayload)
    .eq("organization_id", orgId)
    .eq("id", scheduleId)
    .select(
      "id, organization_id, name, frequency, compare_with, range_days, timezone, recipients, is_enabled, next_run_at, last_run_at, last_status, created_by, created_at, updated_at",
    )
    .maybeSingle<ScheduleRow>();

  if (updateError || !updated) {
    if (isMissingExecutiveAnalyticsSchema(updateError)) {
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
      { error: `Failed to update schedule: ${updateError?.message ?? "Unknown error"}` },
      { status: 500 },
    );
  }

  await writeAuditLog({
    supabase,
    organizationId: orgId,
    actorUserId: userId,
    action: "reports.schedule.updated",
    entityType: "executive_report_schedule",
    entityId: scheduleId,
    details: {
      changedFields: Object.keys(updatePayload),
    },
  });

  return NextResponse.json({ schedule: updated }, { status: 200 });
}

export async function DELETE(_req: Request, context: RouteContext) {
  const { orgId, scheduleId } = await resolveParams(context);
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
    actionLabel: "Delete executive report schedule",
    fallbackAllowed: toFallbackCanManage(actorMembership.role),
    useApprovalFlow: true,
    entityType: "executive_report_schedule",
    entityId: scheduleId,
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

  const existingResult = await loadSchedule(orgId, scheduleId, supabase);
  if (existingResult.error) {
    if (isMissingExecutiveAnalyticsSchema(existingResult.error)) {
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
      { error: `Failed to load schedule: ${existingResult.error.message}` },
      { status: 500 },
    );
  }

  if (!existingResult.schedule) {
    return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  }

  const { error: deleteError } = await supabase
    .from("analytics_report_schedules")
    .delete()
    .eq("organization_id", orgId)
    .eq("id", scheduleId);

  if (deleteError) {
    if (isMissingExecutiveAnalyticsSchema(deleteError)) {
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
      { error: `Failed to delete schedule: ${deleteError.message}` },
      { status: 500 },
    );
  }

  await writeAuditLog({
    supabase,
    organizationId: orgId,
    actorUserId: userId,
    action: "reports.schedule.deleted",
    entityType: "executive_report_schedule",
    entityId: scheduleId,
    details: {
      name: existingResult.schedule.name,
    },
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
