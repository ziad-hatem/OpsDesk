import { NextResponse } from "next/server";
import type {
  ReportsCompareWith,
  ReportsScheduleFrequency,
  ReportsScheduleRunStatus,
} from "@/lib/reports/types";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  MAX_REPORT_RANGE_DAYS,
  computeExecutiveAnalytics,
  computeNextRunAt,
  normalizeExecutiveDateRange,
  persistExecutiveMetricSnapshots,
} from "@/lib/server/executive-analytics";
import { sendExecutiveReportEmail } from "@/lib/server/executive-report-email";
import { writeAuditLog } from "@/lib/server/audit-logs";
import { missingTableMessageWithMigration } from "@/lib/tickets/errors";

export const runtime = "nodejs";

type ScheduleRow = {
  id: string;
  organization_id: string;
  name: string;
  frequency: ReportsScheduleFrequency;
  compare_with: ReportsCompareWith;
  range_days: number;
  timezone: string;
  recipients: string[];
  is_enabled: boolean;
  next_run_at: string;
  last_run_at: string | null;
  last_status: ReportsScheduleRunStatus | null;
  created_by: string | null;
};

type RunInsert = {
  organization_id: string;
  schedule_id: string;
  status: ReportsScheduleRunStatus;
  recipients: string[];
  report_from: string;
  report_to: string;
  error_message: string | null;
  delivered_at: string | null;
};

function isMissingExecutiveAnalyticsSchema(error: { message?: string } | null | undefined): boolean {
  const message = (error?.message ?? "").toLowerCase();
  if (!message) {
    return false;
  }

  return (
    (message.includes("analytics_report_schedules") ||
      message.includes("analytics_report_runs") ||
      message.includes("analytics_metric_snapshots")) &&
    (message.includes("schema cache") || message.includes("does not exist"))
  );
}

function parseLimit(value: string | null): number {
  if (!value) {
    return 20;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 20;
  }
  return Math.min(100, parsed);
}

function readSchedulerSecret(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  const fallback = req.headers.get("x-scheduler-secret");
  return fallback?.trim() || null;
}

async function insertRun(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  payload: RunInsert,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("analytics_report_runs")
    .insert(payload)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    if (!isMissingExecutiveAnalyticsSchema(error)) {
      console.error(`Failed to insert analytics run: ${error.message}`);
    }
    return null;
  }

  return data?.id ?? null;
}

export async function POST(req: Request) {
  const expectedSecret = process.env.REPORTS_SCHEDULER_SECRET?.trim();
  if (!expectedSecret) {
    return NextResponse.json(
      { error: "REPORTS_SCHEDULER_SECRET is not configured" },
      { status: 500 },
    );
  }

  const providedSecret = readSchedulerSecret(req);
  if (!providedSecret || providedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized scheduler request" }, { status: 401 });
  }

  const limit = parseLimit(new URL(req.url).searchParams.get("limit"));
  const now = new Date();
  const supabase = createSupabaseAdminClient();

  const { data: dueSchedules, error: dueSchedulesError } = await supabase
    .from("analytics_report_schedules")
    .select(
      "id, organization_id, name, frequency, compare_with, range_days, timezone, recipients, is_enabled, next_run_at, last_run_at, last_status, created_by",
    )
    .eq("is_enabled", true)
    .lte("next_run_at", now.toISOString())
    .order("next_run_at", { ascending: true })
    .limit(limit)
    .returns<ScheduleRow[]>();

  if (dueSchedulesError) {
    if (isMissingExecutiveAnalyticsSchema(dueSchedulesError)) {
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
      { error: `Failed to load due report schedules: ${dueSchedulesError.message}` },
      { status: 500 },
    );
  }

  const schedules = dueSchedules ?? [];
  if (schedules.length === 0) {
    return NextResponse.json(
      {
        ok: true,
        processed: 0,
        delivered: 0,
        failed: 0,
      },
      { status: 200 },
    );
  }

  const organizationIds = Array.from(new Set(schedules.map((item) => item.organization_id)));
  const { data: organizationsRows } = await supabase
    .from("organizations")
    .select("id, name")
    .in("id", organizationIds)
    .returns<Array<{ id: string; name: string }>>();
  const orgNameById = new Map((organizationsRows ?? []).map((row) => [row.id, row.name]));

  let delivered = 0;
  let failed = 0;

  for (const schedule of schedules) {
    const range = normalizeExecutiveDateRange({
      defaultRangeDays: schedule.range_days,
      maxRangeDays: MAX_REPORT_RANGE_DAYS,
    });

    try {
      const report = await computeExecutiveAnalytics({
        supabase,
        organizationId: schedule.organization_id,
        userId: schedule.created_by ?? "system",
        range,
      });

      const orgName = orgNameById.get(schedule.organization_id) ?? "OpsDesk";
      for (const recipient of schedule.recipients) {
        await sendExecutiveReportEmail({
          toEmail: recipient,
          organizationName: orgName,
          scheduleName: schedule.name,
          reports: report,
        });
      }

      const deliveredAtIso = new Date().toISOString();
      const runId = await insertRun(supabase, {
        organization_id: schedule.organization_id,
        schedule_id: schedule.id,
        status: "success",
        recipients: schedule.recipients,
        report_from: report.range.from,
        report_to: report.range.to,
        error_message: null,
        delivered_at: deliveredAtIso,
      });

      await persistExecutiveMetricSnapshots({
        supabase,
        organizationId: schedule.organization_id,
        metrics: report.metrics,
        range,
        source: "scheduled_report",
        scheduleId: schedule.id,
        reportRunId: runId,
      });

      await supabase
        .from("analytics_report_schedules")
        .update({
          last_run_at: deliveredAtIso,
          last_status: "success",
          next_run_at: computeNextRunAt({
            frequency: schedule.frequency,
            from: new Date(schedule.next_run_at),
            now,
          }),
        })
        .eq("id", schedule.id)
        .eq("organization_id", schedule.organization_id);

      await writeAuditLog({
        supabase,
        organizationId: schedule.organization_id,
        actorUserId: schedule.created_by,
        action: "reports.schedule.run.success",
        entityType: "executive_report_schedule",
        entityId: schedule.id,
        source: "scheduler",
        details: {
          recipients: schedule.recipients.length,
          rangeDays: schedule.range_days,
        },
      });

      delivered += 1;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to deliver scheduled report";

      await insertRun(supabase, {
        organization_id: schedule.organization_id,
        schedule_id: schedule.id,
        status: "failed",
        recipients: schedule.recipients,
        report_from: range.from.toISOString(),
        report_to: range.to.toISOString(),
        error_message: message,
        delivered_at: null,
      });

      await supabase
        .from("analytics_report_schedules")
        .update({
          last_run_at: new Date().toISOString(),
          last_status: "failed",
          next_run_at: computeNextRunAt({
            frequency: schedule.frequency,
            from: new Date(schedule.next_run_at),
            now,
          }),
        })
        .eq("id", schedule.id)
        .eq("organization_id", schedule.organization_id);

      await writeAuditLog({
        supabase,
        organizationId: schedule.organization_id,
        actorUserId: schedule.created_by,
        action: "reports.schedule.run.failed",
        entityType: "executive_report_schedule",
        entityId: schedule.id,
        source: "scheduler",
        details: {
          message,
        },
      });

      failed += 1;
    }
  }

  return NextResponse.json(
    {
      ok: true,
      processed: schedules.length,
      delivered,
      failed,
    },
    { status: 200 },
  );
}
