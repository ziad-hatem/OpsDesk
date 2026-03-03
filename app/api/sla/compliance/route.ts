import { NextResponse } from "next/server";
import { getTicketRequestContext } from "@/lib/server/ticket-context";
import type { SlaCompliancePoint, SlaComplianceResponse } from "@/lib/sla/types";
import { isMissingTableInSchemaCache, missingTableMessageWithMigration } from "@/lib/tickets/errors";

type TicketResolvedRow = {
  id: string;
  status: "resolved" | "closed";
  updated_at: string;
  closed_at: string | null;
};

type SlaEventRow = {
  ticket_id: string;
  event_type: "resolution_breached";
  created_at: string;
};

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 365;

function startOfDay(date: Date): Date {
  const cloned = new Date(date);
  cloned.setHours(0, 0, 0, 0);
  return cloned;
}

function endOfDay(date: Date): Date {
  const cloned = new Date(date);
  cloned.setHours(23, 59, 59, 999);
  return cloned;
}

function addDays(date: Date, days: number): Date {
  const cloned = new Date(date);
  cloned.setDate(cloned.getDate() + days);
  return cloned;
}

function parseDateParam(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function daysBetweenInclusive(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_IN_MS) + 1;
}

function monthStartsBetween(from: Date, to: Date): Date[] {
  const starts: Date[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), 1, 0, 0, 0, 0);
  const limit = new Date(to.getFullYear(), to.getMonth(), 1, 0, 0, 0, 0);

  while (cursor.getTime() <= limit.getTime()) {
    starts.push(new Date(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return starts;
}

function toMonthKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}`;
}

function toMonthLabel(date: Date, includeYear: boolean): string {
  return new Intl.DateTimeFormat(undefined, includeYear
    ? { month: "short", year: "2-digit" }
    : { month: "short" }).format(date);
}

function safeDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
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

  const defaultTo = endOfDay(new Date());
  const defaultFrom = startOfDay(addDays(defaultTo, -179));

  let from = fromParam ? startOfDay(fromParam) : defaultFrom;
  let to = toParam ? endOfDay(toParam) : defaultTo;

  if (from.getTime() > to.getTime()) {
    const temp = from;
    from = startOfDay(to);
    to = endOfDay(temp);
  }

  const rangeDays = daysBetweenInclusive(from, to);
  if (rangeDays > MAX_RANGE_DAYS) {
    from = startOfDay(addDays(to, -(MAX_RANGE_DAYS - 1)));
  }

  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  const [resolvedTicketsResult, breachEventsResult] = await Promise.all([
    supabase
      .from("tickets")
      .select("id, status, updated_at, closed_at")
      .eq("organization_id", activeOrgId)
      .in("status", ["resolved", "closed"])
      .or(`updated_at.gte.${fromIso},closed_at.gte.${fromIso}`)
      .lte("updated_at", toIso)
      .returns<TicketResolvedRow[]>(),
    supabase
      .from("ticket_sla_events")
      .select("ticket_id, event_type, created_at")
      .eq("organization_id", activeOrgId)
      .eq("event_type", "resolution_breached")
      .gte("created_at", fromIso)
      .lte("created_at", toIso)
      .returns<SlaEventRow[]>(),
  ]);

  if (resolvedTicketsResult.error) {
    if (isMissingTableInSchemaCache(resolvedTicketsResult.error, "tickets")) {
      return NextResponse.json(
        { error: missingTableMessageWithMigration("tickets", "db/tickets-schema.sql") },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to load resolved tickets: ${resolvedTicketsResult.error.message}` },
      { status: 500 },
    );
  }

  if (
    breachEventsResult.error &&
    !isMissingTableInSchemaCache(breachEventsResult.error, "ticket_sla_events")
  ) {
    return NextResponse.json(
      { error: `Failed to load SLA breach events: ${breachEventsResult.error.message}` },
      { status: 500 },
    );
  }

  const resolvedRows = resolvedTicketsResult.data ?? [];
  const breachRows = breachEventsResult.data ?? [];

  const resolvedTicketIds = new Set<string>();
  const resolvedRowsInRange: Array<{ ticketId: string; resolvedAt: Date }> = [];
  for (const row of resolvedRows) {
    const resolvedAt = safeDate(row.closed_at ?? row.updated_at);
    if (!resolvedAt) {
      continue;
    }
    if (resolvedAt.getTime() < from.getTime() || resolvedAt.getTime() > to.getTime()) {
      continue;
    }
    resolvedTicketIds.add(row.id);
    resolvedRowsInRange.push({ ticketId: row.id, resolvedAt });
  }

  const breachedTicketIds = new Set(
    breachRows
      .map((event) => event.ticket_id)
      .filter((ticketId) => resolvedTicketIds.has(ticketId)),
  );

  const resolved = resolvedRowsInRange.length;
  const breaches = breachedTicketIds.size;
  const compliance =
    resolved > 0
      ? roundOne(Math.max(0, ((resolved - breaches) / resolved) * 100))
      : 100;

  const monthStarts = monthStartsBetween(from, to);
  const includeYear = from.getFullYear() !== to.getFullYear();
  const resolvedByMonth = new Map<string, number>();
  const breachesByMonth = new Map<string, number>();

  for (const row of resolvedRowsInRange) {
    const key = toMonthKey(row.resolvedAt);
    resolvedByMonth.set(key, (resolvedByMonth.get(key) ?? 0) + 1);
  }

  for (const event of breachRows) {
    const eventDate = safeDate(event.created_at);
    if (!eventDate) {
      continue;
    }
    const key = toMonthKey(eventDate);
    breachesByMonth.set(key, (breachesByMonth.get(key) ?? 0) + 1);
  }

  const trend: SlaCompliancePoint[] = monthStarts.map((monthStart) => {
    const key = toMonthKey(monthStart);
    const monthResolved = resolvedByMonth.get(key) ?? 0;
    const monthBreaches = Math.min(breachesByMonth.get(key) ?? 0, monthResolved);
    const monthCompliance =
      monthResolved > 0
        ? roundOne(Math.max(0, ((monthResolved - monthBreaches) / monthResolved) * 100))
        : 100;

    return {
      label: toMonthLabel(monthStart, includeYear),
      resolved: monthResolved,
      breaches: monthBreaches,
      compliance: monthCompliance,
    };
  });

  const payload: SlaComplianceResponse = {
    activeOrgId,
    currentUserId: userId,
    range: {
      from: fromIso,
      to: toIso,
    },
    summary: {
      resolved,
      breaches,
      compliance,
    },
    trend,
  };

  return NextResponse.json(payload, { status: 200 });
}
