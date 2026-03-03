import { NextResponse } from "next/server";
import { getTicketRequestContext } from "@/lib/server/ticket-context";
import {
  MAX_REPORT_RANGE_DAYS,
  computeExecutiveAnalytics,
  normalizeExecutiveDateRange,
  parseDateParam,
  persistExecutiveMetricSnapshots,
} from "@/lib/server/executive-analytics";
import { missingTableMessageWithMigration } from "@/lib/tickets/errors";

function inferMissingTableMigration(message: string): { table: string; migration: string } | null {
  const lowered = message.toLowerCase();
  const isMissing = lowered.includes("schema cache") || lowered.includes("does not exist");
  if (!isMissing) {
    return null;
  }

  if (lowered.includes("orders")) {
    return { table: "orders", migration: "db/orders-schema.sql" };
  }
  if (lowered.includes("ticket_texts")) {
    return { table: "ticket_texts", migration: "db/tickets-schema.sql" };
  }
  if (lowered.includes("tickets")) {
    return { table: "tickets", migration: "db/tickets-schema.sql" };
  }
  if (lowered.includes("ticket_sla_events")) {
    return { table: "ticket_sla_events", migration: "db/sla-schema.sql" };
  }
  if (lowered.includes("customers")) {
    return { table: "customers", migration: "db/customers-schema.sql" };
  }
  if (lowered.includes("incidents")) {
    return { table: "incidents", migration: "db/incidents-schema.sql" };
  }

  return null;
}

export async function GET(req: Request) {
  const ctxResult = await getTicketRequestContext();
  if (!ctxResult.ok) {
    return NextResponse.json({ error: ctxResult.error }, { status: ctxResult.status });
  }

  const { supabase, activeOrgId, userId } = ctxResult.context;
  if (!activeOrgId) {
    return NextResponse.json(
      { error: "No active organization selected. Create or join an organization first." },
      { status: 400 },
    );
  }

  const url = new URL(req.url);
  const fromParam = parseDateParam(url.searchParams.get("from"));
  const toParam = parseDateParam(url.searchParams.get("to"));
  const range = normalizeExecutiveDateRange({
    from: fromParam,
    to: toParam,
    maxRangeDays: MAX_REPORT_RANGE_DAYS,
  });

  try {
    const response = await computeExecutiveAnalytics({
      supabase,
      organizationId: activeOrgId,
      userId,
      range,
    });

    await persistExecutiveMetricSnapshots({
      supabase,
      organizationId: activeOrgId,
      metrics: response.metrics,
      range,
      source: "reports_api",
    });

    return NextResponse.json(response, { status: 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to load reports";
    const migrationHint = inferMissingTableMigration(message);
    if (migrationHint) {
      return NextResponse.json(
        {
          error: missingTableMessageWithMigration(
            migrationHint.table,
            migrationHint.migration,
          ),
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
