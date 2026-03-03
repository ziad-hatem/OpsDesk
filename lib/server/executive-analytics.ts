import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type { CustomerStatus } from "@/lib/customers/types";
import type { OrderStatus } from "@/lib/orders/types";
import type {
  ReportsMetrics,
  ReportsResponse,
  ReportsScheduleFrequency,
} from "@/lib/reports/types";
import type { TicketTextType } from "@/lib/tickets/types";
import { isMissingTableInSchemaCache } from "@/lib/tickets/errors";

type SupabaseClient = ReturnType<typeof createSupabaseAdminClient>;

type OrderRow = {
  id: string;
  status: OrderStatus;
  total_amount: number;
  created_at: string;
  paid_at: string | null;
  fulfilled_at: string | null;
};

type TicketRow = {
  id: string;
  status: "open" | "pending" | "resolved" | "closed";
  created_by: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
};

type TicketTextRow = {
  ticket_id: string;
  author_id: string;
  type: TicketTextType;
  created_at: string;
};

type SlaEventRow = {
  ticket_id: string;
  event_type: "resolution_breached";
  created_at: string;
};

type CustomerRow = {
  id: string;
  status: CustomerStatus;
  created_at: string;
};

type IncidentRow = {
  id: string;
  status: "investigating" | "identified" | "monitoring" | "resolved";
  started_at: string;
  resolved_at: string | null;
  created_at: string;
};

type MetricScope = "current" | "previous" | "year";

type MetricSnapshotInsertRow = {
  organization_id: string;
  metric_key: string;
  metric_scope: MetricScope;
  metric_value: number;
  period_from: string;
  period_to: string;
  source: string;
  schedule_id?: string | null;
  report_run_id?: string | null;
};

export interface ExecutiveAnalyticsDateRange {
  from: Date;
  to: Date;
  previousFrom: Date;
  previousTo: Date;
  yearFrom: Date;
  yearTo: Date;
}

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const MINUTE_IN_MS = 60 * 1000;
export const MAX_REPORT_RANGE_DAYS = 365;
const DEFAULT_REPORT_RANGE_DAYS = 180;
const RESPONSE_TARGET_MINUTES = 4 * 60;
const RESOLUTION_SATISFACTION_TARGET_MINUTES = 48 * 60;
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const EXECUTIVE_METRIC_KEYS = {
  avgResponseTimeMinutes: "avg_response_time_minutes",
  avgResolutionTimeMinutes: "avg_resolution_time_minutes",
  incidentMttrMinutes: "incident_mttr_minutes",
  customerSatisfactionScore: "customer_satisfaction_score",
  firstContactResolutionRate: "first_contact_resolution_rate",
  ticketBacklogCount: "ticket_backlog_count",
  slaComplianceRate: "sla_compliance_rate",
} as const;

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

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function addDays(date: Date, days: number): Date {
  const cloned = new Date(date);
  cloned.setDate(cloned.getDate() + days);
  return cloned;
}

function addYears(date: Date, years: number): Date {
  const cloned = new Date(date);
  cloned.setFullYear(cloned.getFullYear() + years);
  return cloned;
}

function addFrequency(date: Date, frequency: ReportsScheduleFrequency): Date {
  const cloned = new Date(date);
  if (frequency === "daily") {
    cloned.setUTCDate(cloned.getUTCDate() + 1);
    return cloned;
  }
  if (frequency === "weekly") {
    cloned.setUTCDate(cloned.getUTCDate() + 7);
    return cloned;
  }
  cloned.setUTCMonth(cloned.getUTCMonth() + 1);
  return cloned;
}

function daysBetweenInclusive(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_IN_MS) + 1;
}

export function parseDateParam(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function safeTime(dateIso: string | null): number | null {
  if (!dateIso) {
    return null;
  }
  const parsed = new Date(dateIso).getTime();
  if (Number.isNaN(parsed)) {
    return null;
  }
  return parsed;
}

function inRange(dateIso: string | null, from: Date, to: Date): boolean {
  const value = safeTime(dateIso);
  if (value === null) {
    return false;
  }
  return value >= from.getTime() && value <= to.getTime();
}

function roundOne(value: number | null): number | null {
  if (value === null || Number.isNaN(value)) {
    return null;
  }
  return Math.round(value * 10) / 10;
}

function formatMonthLabel(date: Date, includeYear: boolean): string {
  return new Intl.DateTimeFormat(undefined, includeYear
    ? { month: "short", year: "2-digit" }
    : { month: "short" }).format(date);
}

function monthStartsBetween(from: Date, to: Date): Date[] {
  const starts: Date[] = [];
  const cursor = startOfMonth(from);
  const limit = startOfMonth(to);
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

function toWeekdayIndex(dateIso: string): number | null {
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return (date.getDay() + 6) % 7;
}

function revenueDelta(status: OrderStatus, amount: number): number {
  if (status === "paid" || status === "fulfilled") {
    return amount;
  }
  if (status === "refunded") {
    return -amount;
  }
  return 0;
}

function resolveRevenueDate(order: OrderRow): string {
  return order.paid_at ?? order.fulfilled_at ?? order.created_at;
}

function resolveTicketResolvedAt(ticket: TicketRow): string | null {
  if (ticket.closed_at) {
    return ticket.closed_at;
  }
  if (ticket.status === "resolved" || ticket.status === "closed") {
    return ticket.updated_at;
  }
  return null;
}

function computeSlaComplianceForRange(params: {
  tickets: TicketRow[];
  slaEvents: SlaEventRow[];
  from: Date;
  to: Date;
}): {
  resolved: number;
  breaches: number;
  compliance: number | null;
} {
  const { tickets, slaEvents, from, to } = params;
  const resolvedTicketIds = new Set<string>();

  for (const ticket of tickets) {
    const resolvedAt = resolveTicketResolvedAt(ticket);
    if (!resolvedAt) {
      continue;
    }
    if (!inRange(resolvedAt, from, to)) {
      continue;
    }
    resolvedTicketIds.add(ticket.id);
  }

  const breachedTicketIds = new Set<string>();
  for (const event of slaEvents) {
    if (!inRange(event.created_at, from, to)) {
      continue;
    }
    if (!resolvedTicketIds.has(event.ticket_id)) {
      continue;
    }
    breachedTicketIds.add(event.ticket_id);
  }

  const resolved = resolvedTicketIds.size;
  const breaches = breachedTicketIds.size;
  const compliance =
    resolved > 0
      ? roundOne(Math.max(0, ((resolved - breaches) / resolved) * 100))
      : null;

  return {
    resolved,
    breaches,
    compliance,
  };
}

function buildRevenueSeries(params: {
  orders: OrderRow[];
  from: Date;
  to: Date;
}): { labels: string[]; values: number[] } {
  const { orders, from, to } = params;
  const monthStarts = monthStartsBetween(from, to);
  const includeYear = from.getFullYear() !== to.getFullYear();
  const values = new Array<number>(monthStarts.length).fill(0);
  const monthIndexByKey = new Map<string, number>(
    monthStarts.map((monthStart, index) => [toMonthKey(monthStart), index]),
  );

  for (const order of orders) {
    const revenueDate = resolveRevenueDate(order);
    if (!inRange(revenueDate, from, to)) {
      continue;
    }
    const date = new Date(revenueDate);
    if (Number.isNaN(date.getTime())) {
      continue;
    }
    const bucketIndex = monthIndexByKey.get(toMonthKey(date));
    if (bucketIndex === undefined) {
      continue;
    }
    values[bucketIndex] += revenueDelta(order.status, order.total_amount);
  }

  return {
    labels: monthStarts.map((monthStart) => formatMonthLabel(monthStart, includeYear)),
    values,
  };
}

function buildTicketTextsIndex(rows: TicketTextRow[]): Map<string, TicketTextRow[]> {
  const byTicket = new Map<string, TicketTextRow[]>();
  for (const row of rows) {
    const existing = byTicket.get(row.ticket_id);
    if (existing) {
      existing.push(row);
    } else {
      byTicket.set(row.ticket_id, [row]);
    }
  }
  return byTicket;
}

function firstResponseMinutes(
  ticket: TicketRow,
  ticketTextsByTicketId: Map<string, TicketTextRow[]>,
): number | null {
  const createdAt = safeTime(ticket.created_at);
  if (createdAt === null) {
    return null;
  }

  const rows = ticketTextsByTicketId.get(ticket.id) ?? [];
  for (const row of rows) {
    if (row.type === "system") {
      continue;
    }
    if (row.author_id === ticket.created_by) {
      continue;
    }
    const messageAt = safeTime(row.created_at);
    if (messageAt === null || messageAt < createdAt) {
      continue;
    }
    return (messageAt - createdAt) / MINUTE_IN_MS;
  }

  return null;
}

function firstTicketActivityMinutes(
  ticket: TicketRow,
  ticketTextsByTicketId: Map<string, TicketTextRow[]>,
): number | null {
  const createdAt = safeTime(ticket.created_at);
  if (createdAt === null) {
    return null;
  }

  const rows = ticketTextsByTicketId.get(ticket.id) ?? [];
  for (const row of rows) {
    if (row.type === "system") {
      continue;
    }
    const messageAt = safeTime(row.created_at);
    if (messageAt === null || messageAt < createdAt) {
      continue;
    }
    return (messageAt - createdAt) / MINUTE_IN_MS;
  }

  return null;
}

function fallbackResponseMinutes(
  ticket: TicketRow,
  ticketTextsByTicketId: Map<string, TicketTextRow[]>,
): number | null {
  const activityMinutes = firstTicketActivityMinutes(ticket, ticketTextsByTicketId);
  if (activityMinutes !== null) {
    return activityMinutes;
  }

  const createdAt = safeTime(ticket.created_at);
  if (createdAt === null) {
    return null;
  }

  const resolvedAt = resolveTicketResolvedAt(ticket);
  if (resolvedAt) {
    const resolvedTime = safeTime(resolvedAt);
    if (resolvedTime !== null && resolvedTime > createdAt) {
      return (resolvedTime - createdAt) / MINUTE_IN_MS;
    }
  }

  const updatedAt = safeTime(ticket.updated_at);
  if (updatedAt !== null && updatedAt > createdAt) {
    return (updatedAt - createdAt) / MINUTE_IN_MS;
  }

  return null;
}

function externalResponseCountBeforeResolved(params: {
  ticket: TicketRow;
  resolvedAt: string;
  ticketTextsByTicketId: Map<string, TicketTextRow[]>;
}): number {
  const { ticket, resolvedAt, ticketTextsByTicketId } = params;
  const resolvedTime = safeTime(resolvedAt);
  const createdTime = safeTime(ticket.created_at);
  if (resolvedTime === null || createdTime === null) {
    return 0;
  }

  let count = 0;
  const rows = ticketTextsByTicketId.get(ticket.id) ?? [];
  for (const row of rows) {
    if (row.type === "system") {
      continue;
    }
    if (row.author_id === ticket.created_by) {
      continue;
    }
    const messageAt = safeTime(row.created_at);
    if (messageAt === null || messageAt < createdTime || messageAt > resolvedTime) {
      continue;
    }
    count += 1;
  }
  return count;
}

function computeRangeMetrics(params: {
  tickets: TicketRow[];
  ticketTextsByTicketId: Map<string, TicketTextRow[]>;
  from: Date;
  to: Date;
}): {
  avgResponseTimeMinutes: number | null;
  avgResolutionTimeMinutes: number | null;
  customerSatisfactionScore: number | null;
  firstContactResolutionRate: number | null;
  ticketBacklogCount: number;
} {
  const { tickets, ticketTextsByTicketId, from, to } = params;

  const createdTickets = tickets.filter((ticket) => inRange(ticket.created_at, from, to));
  const responseTimes: number[] = [];
  let responsesWithinTarget = 0;

  for (const ticket of createdTickets) {
    let responseMinutes = firstResponseMinutes(ticket, ticketTextsByTicketId);
    if (responseMinutes === null) {
      responseMinutes = fallbackResponseMinutes(ticket, ticketTextsByTicketId);
    }
    if (responseMinutes === null) {
      continue;
    }
    responseTimes.push(responseMinutes);
    if (responseMinutes <= RESPONSE_TARGET_MINUTES) {
      responsesWithinTarget += 1;
    }
  }

  let avgResponseTimeMinutes =
    responseTimes.length > 0
      ? responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length
      : null;

  let customerSatisfactionScore =
    responseTimes.length > 0
      ? (responsesWithinTarget / responseTimes.length) * 100
      : null;

  const resolvedTicketsInRange = tickets.filter((ticket) => {
    const resolvedAt = resolveTicketResolvedAt(ticket);
    if (!resolvedAt) {
      return false;
    }
    const createdAt = safeTime(ticket.created_at);
    const resolvedAtTime = safeTime(resolvedAt);
    if (createdAt === null || resolvedAtTime === null || resolvedAtTime <= createdAt) {
      return false;
    }
    return inRange(resolvedAt, from, to);
  });

  const resolutionDurations = resolvedTicketsInRange
    .map((ticket) => {
      const createdAt = safeTime(ticket.created_at);
      const resolvedAt = safeTime(resolveTicketResolvedAt(ticket));
      if (createdAt === null || resolvedAt === null || resolvedAt <= createdAt) {
        return null;
      }
      return (resolvedAt - createdAt) / MINUTE_IN_MS;
    })
    .filter((duration): duration is number => duration !== null);

  const avgResolutionTimeMinutes =
    resolutionDurations.length > 0
      ? resolutionDurations.reduce((sum, value) => sum + value, 0) /
        resolutionDurations.length
      : null;

  const resolvedCreatedTickets = createdTickets.filter((ticket) => {
    const resolvedAt = resolveTicketResolvedAt(ticket);
    return resolvedAt ? inRange(resolvedAt, from, to) : false;
  });

  let firstContactResolved = 0;
  for (const ticket of resolvedCreatedTickets) {
    const resolvedAt = resolveTicketResolvedAt(ticket);
    if (!resolvedAt) {
      continue;
    }
    const responsesCount = externalResponseCountBeforeResolved({
      ticket,
      resolvedAt,
      ticketTextsByTicketId,
    });
    if (responsesCount <= 1) {
      firstContactResolved += 1;
    }
  }

  const firstContactResolutionRate =
    resolvedCreatedTickets.length > 0
      ? (firstContactResolved / resolvedCreatedTickets.length) * 100
      : null;

  if (avgResponseTimeMinutes === null || customerSatisfactionScore === null) {
    if (resolutionDurations.length > 0) {
      if (avgResponseTimeMinutes === null) {
        avgResponseTimeMinutes =
          resolutionDurations.reduce((sum, value) => sum + value, 0) /
          resolutionDurations.length;
      }

      if (customerSatisfactionScore === null) {
        const resolvedWithinTarget = resolutionDurations.filter(
          (value) => value <= RESOLUTION_SATISFACTION_TARGET_MINUTES,
        ).length;
        customerSatisfactionScore =
          (resolvedWithinTarget / resolutionDurations.length) * 100;
      }
    }
  }

  let ticketBacklogCount = 0;
  for (const ticket of createdTickets) {
    const resolvedAt = resolveTicketResolvedAt(ticket);
    if (!resolvedAt) {
      ticketBacklogCount += 1;
      continue;
    }
    const resolvedTime = safeTime(resolvedAt);
    if (resolvedTime === null || resolvedTime > to.getTime()) {
      ticketBacklogCount += 1;
    }
  }

  return {
    avgResponseTimeMinutes: roundOne(avgResponseTimeMinutes),
    avgResolutionTimeMinutes: roundOne(avgResolutionTimeMinutes),
    customerSatisfactionScore: roundOne(customerSatisfactionScore),
    firstContactResolutionRate: roundOne(firstContactResolutionRate),
    ticketBacklogCount,
  };
}

function computeIncidentMttrForRange(params: {
  incidents: IncidentRow[];
  from: Date;
  to: Date;
}): number | null {
  const durationsMinutes: number[] = [];
  for (const incident of params.incidents) {
    if (!incident.resolved_at) {
      continue;
    }
    if (!inRange(incident.resolved_at, params.from, params.to)) {
      continue;
    }
    const startedAt = safeTime(incident.started_at);
    const resolvedAt = safeTime(incident.resolved_at);
    if (startedAt === null || resolvedAt === null || resolvedAt <= startedAt) {
      continue;
    }
    durationsMinutes.push((resolvedAt - startedAt) / MINUTE_IN_MS);
  }
  if (durationsMinutes.length === 0) {
    return null;
  }
  return roundOne(
    durationsMinutes.reduce((sum, value) => sum + value, 0) / durationsMinutes.length,
  );
}

function isMissingIncidentsTable(error: { message?: string } | null | undefined): boolean {
  const message = (error?.message ?? "").toLowerCase();
  if (!message) {
    return false;
  }
  return (
    message.includes("incidents") &&
    (message.includes("schema cache") || message.includes("does not exist"))
  );
}

export function normalizeExecutiveDateRange(params: {
  from?: Date | null;
  to?: Date | null;
  defaultRangeDays?: number;
  maxRangeDays?: number;
}): ExecutiveAnalyticsDateRange {
  const defaultTo = endOfDay(new Date());
  const desiredDefaultRangeDays = params.defaultRangeDays ?? DEFAULT_REPORT_RANGE_DAYS;
  const defaultRangeDays = Math.min(
    MAX_REPORT_RANGE_DAYS,
    Math.max(1, desiredDefaultRangeDays),
  );
  const defaultFrom = startOfDay(addDays(defaultTo, -(defaultRangeDays - 1)));

  let from = params.from ? startOfDay(params.from) : defaultFrom;
  let to = params.to ? endOfDay(params.to) : defaultTo;

  if (from.getTime() > to.getTime()) {
    const temp = from;
    from = startOfDay(to);
    to = endOfDay(temp);
  }

  const maxRangeDays = Math.max(1, params.maxRangeDays ?? MAX_REPORT_RANGE_DAYS);
  const rangeDays = daysBetweenInclusive(from, to);
  if (rangeDays > maxRangeDays) {
    from = startOfDay(addDays(to, -(maxRangeDays - 1)));
  }

  const currentRangeDays = daysBetweenInclusive(from, to);
  const previousTo = endOfDay(addDays(from, -1));
  const previousFrom = startOfDay(addDays(previousTo, -(currentRangeDays - 1)));
  const yearFrom = startOfDay(addYears(from, -1));
  const yearTo = endOfDay(addYears(to, -1));

  return { from, to, previousFrom, previousTo, yearFrom, yearTo };
}

export function computeNextRunAt(params: {
  frequency: ReportsScheduleFrequency;
  from: Date;
  now?: Date;
}): string {
  const now = params.now ?? new Date();
  let cursor = new Date(params.from);
  if (Number.isNaN(cursor.getTime())) {
    cursor = now;
  }
  while (cursor.getTime() <= now.getTime()) {
    cursor = addFrequency(cursor, params.frequency);
  }
  return cursor.toISOString();
}

export async function computeExecutiveAnalytics(params: {
  supabase: SupabaseClient;
  organizationId: string;
  userId: string;
  range: ExecutiveAnalyticsDateRange;
}): Promise<ReportsResponse> {
  const { supabase, organizationId, userId, range } = params;
  const { from, to, previousFrom, previousTo, yearFrom, yearTo } = range;

  const queryStartTime = Math.min(
    previousFrom.getTime(),
    yearFrom.getTime(),
    from.getTime(),
  );
  const queryStart = new Date(queryStartTime).toISOString();

  const [
    ordersResult,
    ticketsResult,
    ticketTextsResult,
    customersResult,
    ticketSlaEventsResult,
    incidentsResult,
  ] = await Promise.all([
    supabase
      .from("orders")
      .select("id, status, total_amount, created_at, paid_at, fulfilled_at")
      .eq("organization_id", organizationId)
      .or(
        `created_at.gte.${queryStart},paid_at.gte.${queryStart},fulfilled_at.gte.${queryStart}`,
      )
      .limit(20000)
      .returns<OrderRow[]>(),
    supabase
      .from("tickets")
      .select("id, status, created_by, created_at, updated_at, closed_at")
      .eq("organization_id", organizationId)
      .or(`created_at.gte.${queryStart},updated_at.gte.${queryStart},closed_at.gte.${queryStart}`)
      .limit(20000)
      .returns<TicketRow[]>(),
    supabase
      .from("ticket_texts")
      .select("ticket_id, author_id, type, created_at")
      .eq("organization_id", organizationId)
      .gte("created_at", queryStart)
      .order("created_at", { ascending: true })
      .limit(50000)
      .returns<TicketTextRow[]>(),
    supabase
      .from("customers")
      .select("id, status, created_at")
      .eq("organization_id", organizationId)
      .lte("created_at", to.toISOString())
      .returns<CustomerRow[]>(),
    supabase
      .from("ticket_sla_events")
      .select("ticket_id, event_type, created_at")
      .eq("organization_id", organizationId)
      .eq("event_type", "resolution_breached")
      .gte("created_at", queryStart)
      .limit(50000)
      .returns<SlaEventRow[]>(),
    supabase
      .from("incidents")
      .select("id, status, started_at, resolved_at, created_at")
      .eq("organization_id", organizationId)
      .or(`created_at.gte.${queryStart},started_at.gte.${queryStart},resolved_at.gte.${queryStart}`)
      .limit(20000)
      .returns<IncidentRow[]>(),
  ]);

  if (ordersResult.error) {
    throw new Error(`Failed to load orders for reports: ${ordersResult.error.message}`);
  }

  if (ticketsResult.error) {
    throw new Error(`Failed to load tickets for reports: ${ticketsResult.error.message}`);
  }

  if (ticketTextsResult.error) {
    throw new Error(
      `Failed to load ticket messages for reports: ${ticketTextsResult.error.message}`,
    );
  }

  if (customersResult.error) {
    throw new Error(`Failed to load customers for reports: ${customersResult.error.message}`);
  }

  if (
    ticketSlaEventsResult.error &&
    !isMissingTableInSchemaCache(ticketSlaEventsResult.error, "ticket_sla_events")
  ) {
    throw new Error(
      `Failed to load ticket SLA events for reports: ${ticketSlaEventsResult.error.message}`,
    );
  }

  if (
    incidentsResult.error &&
    !isMissingIncidentsTable(incidentsResult.error) &&
    !isMissingTableInSchemaCache(incidentsResult.error, "incidents")
  ) {
    throw new Error(`Failed to load incidents for reports: ${incidentsResult.error.message}`);
  }

  const orders = ordersResult.data ?? [];
  const tickets = ticketsResult.data ?? [];
  const ticketTexts = ticketTextsResult.data ?? [];
  const customers = customersResult.data ?? [];
  const ticketSlaEvents = ticketSlaEventsResult.data ?? [];
  const incidents = incidentsResult.data ?? [];

  const currentRevenue = buildRevenueSeries({ orders, from, to });
  const previousRevenue = buildRevenueSeries({
    orders,
    from: previousFrom,
    to: previousTo,
  });
  const yearRevenue = buildRevenueSeries({
    orders,
    from: yearFrom,
    to: yearTo,
  });

  const revenueTrend = currentRevenue.labels.map((label, index) => ({
    label,
    current: currentRevenue.values[index] ?? 0,
    previous: previousRevenue.values[index] ?? 0,
    year: yearRevenue.values[index] ?? 0,
  }));

  const weekdayCreated = new Array<number>(WEEKDAY_LABELS.length).fill(0);
  const weekdayResolved = new Array<number>(WEEKDAY_LABELS.length).fill(0);
  for (const ticket of tickets) {
    if (inRange(ticket.created_at, from, to)) {
      const index = toWeekdayIndex(ticket.created_at);
      if (index !== null) {
        weekdayCreated[index] += 1;
      }
    }

    const resolvedAt = resolveTicketResolvedAt(ticket);
    if (resolvedAt && inRange(resolvedAt, from, to)) {
      const index = toWeekdayIndex(resolvedAt);
      if (index !== null) {
        weekdayResolved[index] += 1;
      }
    }
  }

  const ticketVolume = WEEKDAY_LABELS.map((day, index) => ({
    day,
    tickets: weekdayCreated[index] ?? 0,
    resolved: weekdayResolved[index] ?? 0,
  }));

  const monthStarts = monthStartsBetween(from, to);
  const monthLabelsIncludeYear = from.getFullYear() !== to.getFullYear();
  const activeCustomerCreatedTimes = customers
    .filter((customer) => customer.status === "active")
    .map((customer) => safeTime(customer.created_at))
    .filter((createdAt): createdAt is number => createdAt !== null)
    .sort((a, b) => a - b);

  const customerGrowth: ReportsResponse["customerGrowth"] = [];
  let activeCursor = 0;
  for (const monthStart of monthStarts) {
    const monthEndTime = endOfMonth(monthStart).getTime();
    while (
      activeCursor < activeCustomerCreatedTimes.length &&
      activeCustomerCreatedTimes[activeCursor] <= monthEndTime
    ) {
      activeCursor += 1;
    }

    customerGrowth.push({
      month: formatMonthLabel(monthStart, monthLabelsIncludeYear),
      customers: activeCursor,
    });
  }

  const ticketTextsByTicketId = buildTicketTextsIndex(ticketTexts);
  const currentMetrics = computeRangeMetrics({
    tickets,
    ticketTextsByTicketId,
    from,
    to,
  });
  const previousMetrics = computeRangeMetrics({
    tickets,
    ticketTextsByTicketId,
    from: previousFrom,
    to: previousTo,
  });
  const yearMetrics = computeRangeMetrics({
    tickets,
    ticketTextsByTicketId,
    from: yearFrom,
    to: yearTo,
  });

  const currentSlaCompliance = computeSlaComplianceForRange({
    tickets,
    slaEvents: ticketSlaEvents,
    from,
    to,
  });
  const previousSlaCompliance = computeSlaComplianceForRange({
    tickets,
    slaEvents: ticketSlaEvents,
    from: previousFrom,
    to: previousTo,
  });
  const yearSlaCompliance = computeSlaComplianceForRange({
    tickets,
    slaEvents: ticketSlaEvents,
    from: yearFrom,
    to: yearTo,
  });

  const currentIncidentMttr = computeIncidentMttrForRange({
    incidents,
    from,
    to,
  });
  const previousIncidentMttr = computeIncidentMttrForRange({
    incidents,
    from: previousFrom,
    to: previousTo,
  });
  const yearIncidentMttr = computeIncidentMttrForRange({
    incidents,
    from: yearFrom,
    to: yearTo,
  });

  const slaComplianceTrend = monthStartsBetween(from, to).map((monthStart) => {
    const monthStartTime = startOfMonth(monthStart);
    const monthEndTime = endOfMonth(monthStart);
    const monthCompliance = computeSlaComplianceForRange({
      tickets,
      slaEvents: ticketSlaEvents,
      from: monthStartTime,
      to: monthEndTime,
    });

    return {
      label: formatMonthLabel(monthStart, from.getFullYear() !== to.getFullYear()),
      resolved: monthCompliance.resolved,
      breaches: monthCompliance.breaches,
      compliance: monthCompliance.compliance ?? 100,
    };
  });

  const metrics: ReportsMetrics = {
    avgResponseTimeMinutes: {
      current: currentMetrics.avgResponseTimeMinutes,
      previous: previousMetrics.avgResponseTimeMinutes,
      year: yearMetrics.avgResponseTimeMinutes,
    },
    avgResolutionTimeMinutes: {
      current: currentMetrics.avgResolutionTimeMinutes,
      previous: previousMetrics.avgResolutionTimeMinutes,
      year: yearMetrics.avgResolutionTimeMinutes,
    },
    incidentMttrMinutes: {
      current: currentIncidentMttr,
      previous: previousIncidentMttr,
      year: yearIncidentMttr,
    },
    customerSatisfactionScore: {
      current: currentMetrics.customerSatisfactionScore,
      previous: previousMetrics.customerSatisfactionScore,
      year: yearMetrics.customerSatisfactionScore,
    },
    firstContactResolutionRate: {
      current: currentMetrics.firstContactResolutionRate,
      previous: previousMetrics.firstContactResolutionRate,
      year: yearMetrics.firstContactResolutionRate,
    },
    ticketBacklogCount: {
      current: currentMetrics.ticketBacklogCount,
      previous: previousMetrics.ticketBacklogCount,
      year: yearMetrics.ticketBacklogCount,
    },
    slaComplianceRate: {
      current: currentSlaCompliance.compliance,
      previous: previousSlaCompliance.compliance,
      year: yearSlaCompliance.compliance,
    },
  };

  return {
    revenueTrend,
    ticketVolume,
    customerGrowth,
    slaComplianceTrend,
    metrics,
    activeOrgId: organizationId,
    currentUserId: userId,
    range: {
      from: from.toISOString(),
      to: to.toISOString(),
      previousFrom: previousFrom.toISOString(),
      previousTo: previousTo.toISOString(),
      yearFrom: yearFrom.toISOString(),
      yearTo: yearTo.toISOString(),
    },
  };
}

function buildMetricSnapshotRows(params: {
  organizationId: string;
  metrics: ReportsMetrics;
  range: ExecutiveAnalyticsDateRange;
  source: string;
  scheduleId?: string | null;
  reportRunId?: string | null;
}): MetricSnapshotInsertRow[] {
  const rows: MetricSnapshotInsertRow[] = [];
  const periodByScope: Record<MetricScope, { from: Date; to: Date }> = {
    current: { from: params.range.from, to: params.range.to },
    previous: { from: params.range.previousFrom, to: params.range.previousTo },
    year: { from: params.range.yearFrom, to: params.range.yearTo },
  };

  const metricsToPersist: Array<{
    key: string;
    values: ReportsMetrics[keyof ReportsMetrics];
  }> = [
    {
      key: EXECUTIVE_METRIC_KEYS.avgResponseTimeMinutes,
      values: params.metrics.avgResponseTimeMinutes,
    },
    {
      key: EXECUTIVE_METRIC_KEYS.avgResolutionTimeMinutes,
      values: params.metrics.avgResolutionTimeMinutes,
    },
    {
      key: EXECUTIVE_METRIC_KEYS.incidentMttrMinutes,
      values: params.metrics.incidentMttrMinutes,
    },
    {
      key: EXECUTIVE_METRIC_KEYS.customerSatisfactionScore,
      values: params.metrics.customerSatisfactionScore,
    },
    {
      key: EXECUTIVE_METRIC_KEYS.firstContactResolutionRate,
      values: params.metrics.firstContactResolutionRate,
    },
    {
      key: EXECUTIVE_METRIC_KEYS.ticketBacklogCount,
      values: params.metrics.ticketBacklogCount,
    },
    {
      key: EXECUTIVE_METRIC_KEYS.slaComplianceRate,
      values: params.metrics.slaComplianceRate,
    },
  ];

  for (const metric of metricsToPersist) {
    const scopes: MetricScope[] = ["current", "previous", "year"];
    for (const scope of scopes) {
      const value = metric.values[scope];
      if (typeof value !== "number" || Number.isNaN(value)) {
        continue;
      }
      const period = periodByScope[scope];
      rows.push({
        organization_id: params.organizationId,
        metric_key: metric.key,
        metric_scope: scope,
        metric_value: value,
        period_from: period.from.toISOString(),
        period_to: period.to.toISOString(),
        source: params.source,
        schedule_id: params.scheduleId ?? null,
        report_run_id: params.reportRunId ?? null,
      });
    }
  }

  return rows;
}

function isMissingAnalyticsSnapshotsTable(error: { message?: string } | null | undefined): boolean {
  const message = (error?.message ?? "").toLowerCase();
  if (!message) {
    return false;
  }
  return (
    message.includes("analytics_metric_snapshots") &&
    (message.includes("schema cache") || message.includes("does not exist"))
  );
}

export async function persistExecutiveMetricSnapshots(params: {
  supabase: SupabaseClient;
  organizationId: string;
  metrics: ReportsMetrics;
  range: ExecutiveAnalyticsDateRange;
  source: string;
  scheduleId?: string | null;
  reportRunId?: string | null;
}): Promise<void> {
  const rows = buildMetricSnapshotRows({
    organizationId: params.organizationId,
    metrics: params.metrics,
    range: params.range,
    source: params.source,
    scheduleId: params.scheduleId,
    reportRunId: params.reportRunId,
  });
  if (rows.length === 0) {
    return;
  }

  const { error } = await params.supabase.from("analytics_metric_snapshots").insert(rows);
  if (error && !isMissingAnalyticsSnapshotsTable(error)) {
    console.error(`Failed to persist analytics metric snapshots: ${error.message}`);
  }
}
