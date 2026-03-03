import { NextResponse } from "next/server";
import { getTicketRequestContext } from "@/lib/server/ticket-context";
import type { CustomerStatus } from "@/lib/customers/types";
import type { OrderStatus } from "@/lib/orders/types";
import type { ReportsMetrics, ReportsResponse } from "@/lib/reports/types";
import type { TicketTextType } from "@/lib/tickets/types";
import {
  isMissingTableInSchemaCache,
  missingTableMessageWithMigration,
} from "@/lib/tickets/errors";

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

type CustomerRow = {
  id: string;
  status: CustomerStatus;
  created_at: string;
};

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const MINUTE_IN_MS = 60 * 1000;
const MAX_RANGE_DAYS = 365;
const RESPONSE_TARGET_MINUTES = 4 * 60;
const RESOLUTION_SATISFACTION_TARGET_MINUTES = 48 * 60;
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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

function daysBetweenInclusive(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_IN_MS) + 1;
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
    const resolutionDurations: number[] = [];

    for (const ticket of resolvedCreatedTickets) {
      const createdAt = safeTime(ticket.created_at);
      const resolvedAt = safeTime(resolveTicketResolvedAt(ticket));
      if (createdAt === null || resolvedAt === null || resolvedAt <= createdAt) {
        continue;
      }
      resolutionDurations.push((resolvedAt - createdAt) / MINUTE_IN_MS);
    }

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
    customerSatisfactionScore: roundOne(customerSatisfactionScore),
    firstContactResolutionRate: roundOne(firstContactResolutionRate),
    ticketBacklogCount,
  };
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
    const tempFrom = from;
    from = startOfDay(to);
    to = endOfDay(tempFrom);
  }

  const rangeDays = daysBetweenInclusive(from, to);
  if (rangeDays > MAX_RANGE_DAYS) {
    from = startOfDay(addDays(to, -(MAX_RANGE_DAYS - 1)));
  }

  const currentRangeDays = daysBetweenInclusive(from, to);
  const previousTo = endOfDay(addDays(from, -1));
  const previousFrom = startOfDay(addDays(previousTo, -(currentRangeDays - 1)));
  const yearFrom = startOfDay(addYears(from, -1));
  const yearTo = endOfDay(addYears(to, -1));

  const queryStartTime = Math.min(
    previousFrom.getTime(),
    yearFrom.getTime(),
    from.getTime(),
  );
  const queryStart = new Date(queryStartTime).toISOString();

  const [ordersResult, ticketsResult, ticketTextsResult, customersResult] =
    await Promise.all([
      supabase
        .from("orders")
        .select("id, status, total_amount, created_at, paid_at, fulfilled_at")
        .eq("organization_id", activeOrgId)
        .or(
          `created_at.gte.${queryStart},paid_at.gte.${queryStart},fulfilled_at.gte.${queryStart}`,
        )
        .limit(20000)
        .returns<OrderRow[]>(),
      supabase
        .from("tickets")
        .select("id, status, created_by, created_at, updated_at, closed_at")
        .eq("organization_id", activeOrgId)
        .or(`created_at.gte.${queryStart},updated_at.gte.${queryStart},closed_at.gte.${queryStart}`)
        .limit(20000)
        .returns<TicketRow[]>(),
      supabase
        .from("ticket_texts")
        .select("ticket_id, author_id, type, created_at")
        .eq("organization_id", activeOrgId)
        .gte("created_at", queryStart)
        .order("created_at", { ascending: true })
        .limit(50000)
        .returns<TicketTextRow[]>(),
      supabase
        .from("customers")
        .select("id, status, created_at")
        .eq("organization_id", activeOrgId)
        .lte("created_at", to.toISOString())
        .returns<CustomerRow[]>(),
    ]);

  if (ordersResult.error) {
    if (isMissingTableInSchemaCache(ordersResult.error, "orders")) {
      return NextResponse.json(
        { error: missingTableMessageWithMigration("orders", "db/orders-schema.sql") },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to load orders for reports: ${ordersResult.error.message}` },
      { status: 500 },
    );
  }

  if (ticketsResult.error) {
    if (isMissingTableInSchemaCache(ticketsResult.error, "tickets")) {
      return NextResponse.json(
        { error: missingTableMessageWithMigration("tickets", "db/tickets-schema.sql") },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to load tickets for reports: ${ticketsResult.error.message}` },
      { status: 500 },
    );
  }

  if (ticketTextsResult.error) {
    if (isMissingTableInSchemaCache(ticketTextsResult.error, "ticket_texts")) {
      return NextResponse.json(
        { error: missingTableMessageWithMigration("ticket_texts", "db/tickets-schema.sql") },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to load ticket messages for reports: ${ticketTextsResult.error.message}` },
      { status: 500 },
    );
  }

  if (customersResult.error) {
    if (isMissingTableInSchemaCache(customersResult.error, "customers")) {
      return NextResponse.json(
        { error: missingTableMessageWithMigration("customers", "db/customers-schema.sql") },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to load customers for reports: ${customersResult.error.message}` },
      { status: 500 },
    );
  }

  const orders = ordersResult.data ?? [];
  const tickets = ticketsResult.data ?? [];
  const ticketTexts = ticketTextsResult.data ?? [];
  const customers = customersResult.data ?? [];

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

  const metrics: ReportsMetrics = {
    avgResponseTimeMinutes: {
      current: currentMetrics.avgResponseTimeMinutes,
      previous: previousMetrics.avgResponseTimeMinutes,
      year: yearMetrics.avgResponseTimeMinutes,
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
  };

  const response: ReportsResponse = {
    revenueTrend,
    ticketVolume,
    customerGrowth,
    metrics,
    activeOrgId,
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

  return NextResponse.json(response, { status: 200 });
}
