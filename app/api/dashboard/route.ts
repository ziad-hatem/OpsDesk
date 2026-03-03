import { NextResponse } from "next/server";
import { getTicketRequestContext } from "@/lib/server/ticket-context";
import type {
  DashboardChartPoint,
  DashboardHighPriorityTicket,
  DashboardRecentOrder,
  DashboardResponse,
} from "@/lib/dashboard/types";
import type { OrderStatus } from "@/lib/orders/types";
import type { TicketPriority, TicketStatus } from "@/lib/tickets/types";
import { isMissingTableInSchemaCache, missingTableMessageWithMigration } from "@/lib/tickets/errors";

type CustomerRow = {
  id: string;
  name: string;
};

type OrderRow = {
  id: string;
  order_number: string;
  customer_id: string;
  status: OrderStatus;
  total_amount: number;
  currency: string;
  created_at: string;
  paid_at: string | null;
  fulfilled_at: string | null;
};

type TicketRow = {
  id: string;
  title: string;
  customer_id: string | null;
  priority: TicketPriority;
  status: TicketStatus;
  sla_due_at: string | null;
  created_at: string;
};

type OpenTicketRow = {
  id: string;
  sla_due_at: string | null;
};

function startOfDay(date: Date) {
  const cloned = new Date(date);
  cloned.setHours(0, 0, 0, 0);
  return cloned;
}

function endOfDay(date: Date) {
  const cloned = new Date(date);
  cloned.setHours(23, 59, 59, 999);
  return cloned;
}

function formatChartLabel(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
  }).format(date);
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
  const diff = to.getTime() - from.getTime();
  return Math.floor(diff / (24 * 60 * 60 * 1000)) + 1;
}

function revenueDelta(status: OrderStatus, totalAmount: number): number {
  if (status === "paid" || status === "fulfilled") {
    return totalAmount;
  }
  if (status === "refunded") {
    return -totalAmount;
  }
  return 0;
}

function inRange(dateIso: string, from: Date, to: Date): boolean {
  const time = new Date(dateIso).getTime();
  return time >= from.getTime() && time <= to.getTime();
}

function toTicketCode(ticketId: string) {
  return `TKT-${ticketId.slice(0, 8).toUpperCase()}`;
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
  const defaultFrom = startOfDay(new Date(defaultTo));
  defaultFrom.setDate(defaultFrom.getDate() - 29);

  let from = fromParam ? startOfDay(fromParam) : defaultFrom;
  let to = toParam ? endOfDay(toParam) : defaultTo;
  if (from.getTime() > to.getTime()) {
    const tmp = from;
    from = startOfDay(to);
    to = endOfDay(tmp);
  }

  const maxRangeDays = 180;
  const daySpan = daysBetweenInclusive(from, to);
  if (daySpan > maxRangeDays) {
    from = startOfDay(new Date(to));
    from.setDate(from.getDate() - (maxRangeDays - 1));
  }

  const currentRangeDays = daysBetweenInclusive(from, to);
  const previousTo = endOfDay(new Date(from.getTime() - 24 * 60 * 60 * 1000));
  const previousFrom = startOfDay(new Date(previousTo));
  previousFrom.setDate(previousFrom.getDate() - (currentRangeDays - 1));

  const queryStart = previousFrom.toISOString();

  const [ordersWindowResult, recentOrdersResult, openTicketsResult, highPriorityTicketsResult, customersResult] =
    await Promise.all([
    supabase
      .from("orders")
      .select(
        "id, order_number, customer_id, status, total_amount, currency, created_at, paid_at, fulfilled_at",
      )
      .eq("organization_id", activeOrgId)
      .or(
        `created_at.gte.${queryStart},paid_at.gte.${queryStart},fulfilled_at.gte.${queryStart}`,
      )
      .order("created_at", { ascending: false })
      .limit(5000)
      .returns<OrderRow[]>(),
    supabase
      .from("orders")
      .select(
        "id, order_number, customer_id, status, total_amount, currency, created_at, paid_at, fulfilled_at",
      )
      .eq("organization_id", activeOrgId)
      .order("created_at", { ascending: false })
      .limit(5)
      .returns<OrderRow[]>(),
    supabase
      .from("tickets")
      .select("id, sla_due_at")
      .eq("organization_id", activeOrgId)
      .in("status", ["open", "pending"])
      .returns<OpenTicketRow[]>(),
    supabase
      .from("tickets")
      .select("id, title, customer_id, priority, status, sla_due_at, created_at")
      .eq("organization_id", activeOrgId)
      .in("status", ["open", "pending"])
      .in("priority", ["urgent", "high"])
      .order("created_at", { ascending: false })
      .limit(5)
      .returns<TicketRow[]>(),
    supabase
      .from("customers")
      .select("id, name")
      .eq("organization_id", activeOrgId)
      .returns<CustomerRow[]>(),
    ]);

  if (ordersWindowResult.error) {
    if (isMissingTableInSchemaCache(ordersWindowResult.error, "orders")) {
      return NextResponse.json(
        { error: missingTableMessageWithMigration("orders", "db/orders-schema.sql") },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to load orders for dashboard: ${ordersWindowResult.error.message}` },
      { status: 500 },
    );
  }

  if (recentOrdersResult.error) {
    if (isMissingTableInSchemaCache(recentOrdersResult.error, "orders")) {
      return NextResponse.json(
        { error: missingTableMessageWithMigration("orders", "db/orders-schema.sql") },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to load recent orders for dashboard: ${recentOrdersResult.error.message}` },
      { status: 500 },
    );
  }

  if (openTicketsResult.error) {
    if (isMissingTableInSchemaCache(openTicketsResult.error, "tickets")) {
      return NextResponse.json(
        { error: missingTableMessageWithMigration("tickets", "db/tickets-schema.sql") },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to load open tickets for dashboard: ${openTicketsResult.error.message}` },
      { status: 500 },
    );
  }

  if (highPriorityTicketsResult.error) {
    if (isMissingTableInSchemaCache(highPriorityTicketsResult.error, "tickets")) {
      return NextResponse.json(
        { error: missingTableMessageWithMigration("tickets", "db/tickets-schema.sql") },
        { status: 500 },
      );
    }
    return NextResponse.json(
      {
        error: `Failed to load high priority tickets for dashboard: ${highPriorityTicketsResult.error.message}`,
      },
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
      { error: `Failed to load customers for dashboard: ${customersResult.error.message}` },
      { status: 500 },
    );
  }

  const orders = ordersWindowResult.data ?? [];
  const recentOrdersRows = recentOrdersResult.data ?? [];
  const openTicketsRows = openTicketsResult.data ?? [];
  const highPriorityTicketsRows = highPriorityTicketsResult.data ?? [];
  const customers = customersResult.data ?? [];

  const customersById = new Map(customers.map((customer) => [customer.id, customer.name]));

  const chartBucketsCurrent = new Map<string, number>();
  const chartBucketsPrevious = new Map<string, number>();
  const chartPoints: DashboardChartPoint[] = [];

  for (let index = 0; index < currentRangeDays; index += 1) {
    const currentDay = new Date(from);
    currentDay.setDate(currentDay.getDate() + index);
    const previousDay = new Date(previousFrom);
    previousDay.setDate(previousDay.getDate() + index);

    chartBucketsCurrent.set(currentDay.toISOString().slice(0, 10), 0);
    chartBucketsPrevious.set(previousDay.toISOString().slice(0, 10), 0);

    chartPoints.push({
      date: formatChartLabel(currentDay),
      current: 0,
      previous: 0,
    });
  }

  let totalRevenueAmount = 0;
  for (const order of orders) {
    const delta = revenueDelta(order.status, order.total_amount);
    const referenceDateIso = order.paid_at ?? order.fulfilled_at ?? order.created_at;
    const dayKey = referenceDateIso.slice(0, 10);

    if (inRange(referenceDateIso, from, to) && chartBucketsCurrent.has(dayKey)) {
      chartBucketsCurrent.set(dayKey, (chartBucketsCurrent.get(dayKey) ?? 0) + delta);
      totalRevenueAmount += delta;
    }

    if (
      inRange(referenceDateIso, previousFrom, previousTo) &&
      chartBucketsPrevious.has(dayKey)
    ) {
      chartBucketsPrevious.set(dayKey, (chartBucketsPrevious.get(dayKey) ?? 0) + delta);
    }
  }

  for (let index = 0; index < currentRangeDays; index += 1) {
    const currentDay = new Date(from);
    currentDay.setDate(currentDay.getDate() + index);
    const previousDay = new Date(previousFrom);
    previousDay.setDate(previousDay.getDate() + index);

    const currentKey = currentDay.toISOString().slice(0, 10);
    const previousKey = previousDay.toISOString().slice(0, 10);

    chartPoints[index] = {
      ...chartPoints[index],
      current: chartBucketsCurrent.get(currentKey) ?? 0,
      previous: chartBucketsPrevious.get(previousKey) ?? 0,
    };
  }

  const openTicketsCount = openTicketsRows.length;

  const now = Date.now();
  const slaBreachesCount = openTicketsRows.filter((ticket) => {
    if (!ticket.sla_due_at) {
      return false;
    }
    const dueTime = new Date(ticket.sla_due_at).getTime();
    return Number.isFinite(dueTime) && dueTime < now;
  }).length;

  const recentOrders: DashboardRecentOrder[] = recentOrdersRows
    .map((order) => ({
      id: order.id,
      order_number: order.order_number,
      customer_name: customersById.get(order.customer_id) ?? null,
      total_amount: order.total_amount,
      currency: order.currency.trim().toUpperCase(),
      status: order.status,
      created_at: order.created_at,
    }));

  const highPriorityTickets: DashboardHighPriorityTicket[] = highPriorityTicketsRows
    .map((ticket) => ({
      id: ticket.id,
      title: ticket.title || toTicketCode(ticket.id),
      customer_name: ticket.customer_id ? customersById.get(ticket.customer_id) ?? null : null,
      priority: ticket.priority,
      status: ticket.status,
      created_at: ticket.created_at,
    }));

  const response: DashboardResponse = {
    kpis: {
      totalRevenueAmount,
      openTicketsCount,
      slaBreachesCount,
    },
    chart: chartPoints,
    recentOrders,
    highPriorityTickets,
    activeOrgId,
    currentUserId: userId,
    range: {
      from: from.toISOString(),
      to: to.toISOString(),
      previousFrom: previousFrom.toISOString(),
      previousTo: previousTo.toISOString(),
    },
  };

  return NextResponse.json(response, { status: 200 });
}
