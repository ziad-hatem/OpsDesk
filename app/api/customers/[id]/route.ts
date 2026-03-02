import { NextResponse } from "next/server";
import { getTicketRequestContext } from "@/lib/server/ticket-context";
import type {
  CustomerActivityItem,
  CustomerOrderListItem,
  CustomerDetailResponse,
  CustomerListItem,
  CustomerStatus,
} from "@/lib/customers/types";
import { isCustomerStatus } from "@/lib/customers/validation";
import type { TicketListItem, TicketUser } from "@/lib/tickets/types";
import type { OrderStatus } from "@/lib/orders/types";
import { isMissingTableInSchemaCache, missingTableMessageWithMigration } from "@/lib/tickets/errors";

type CustomerRow = Omit<
  CustomerListItem,
  "open_tickets_count" | "total_tickets_count" | "total_orders_count" | "total_revenue_amount"
>;

type TicketRow = Omit<TicketListItem, "assignee" | "creator" | "customer">;
type UserRow = TicketUser;
type CustomerOrderRow = CustomerOrderListItem;
type OrderStatusEventRow = {
  id: string;
  order_id: string;
  from_status: OrderStatus;
  to_status: OrderStatus;
  actor_user_id: string | null;
  reason: string | null;
  created_at: string;
};
type AuditLogRow = {
  id: string;
  action: string;
  actor_user_id: string | null;
  created_at: string;
};

type RouteContext = {
  params: Promise<{ id: string }>;
};

type UpdateCustomerBody = {
  name?: string;
  email?: string | null;
  phone?: string | null;
  status?: CustomerStatus;
  externalId?: string | null;
};

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

function normalizeEmail(value: unknown): string | null {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  return normalized.toLowerCase();
}

function normalizeStatus(value: unknown): CustomerStatus | null {
  if (typeof value !== "string") {
    return null;
  }
  return isCustomerStatus(value) ? value : null;
}

function getRevenueDelta(status: OrderStatus, totalAmount: number): number {
  if (status === "paid" || status === "fulfilled") {
    return totalAmount;
  }
  if (status === "refunded") {
    return -totalAmount;
  }
  return 0;
}

function formatMoney(cents: number, currency: string): string {
  const normalizedCurrency = (currency || "USD").trim().toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: normalizedCurrency,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${normalizedCurrency}`;
  }
}

function toTicketCode(ticketId: string): string {
  return `TKT-${ticketId.slice(0, 8).toUpperCase()}`;
}

function toStatusLabel(status: OrderStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function toAuditTitle(action: string): string {
  const normalized = action.toLowerCase();
  if (normalized.includes("update")) {
    return "Profile updated";
  }
  if (normalized.includes("create")) {
    return "Profile created";
  }
  if (normalized.includes("delete")) {
    return "Profile deleted";
  }

  return action
    .replace(/[._-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function resolveCustomerId(context: RouteContext) {
  const params = await context.params;
  return params.id?.trim() ?? "";
}

export async function GET(_req: Request, context: RouteContext) {
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

  const customerId = await resolveCustomerId(context);
  if (!customerId) {
    return NextResponse.json({ error: "Customer id is required" }, { status: 400 });
  }

  const { data: customerRow, error: customerError } = await supabase
    .from("customers")
    .select("id, organization_id, name, email, phone, status, external_id, created_at, updated_at")
    .eq("organization_id", activeOrgId)
    .eq("id", customerId)
    .maybeSingle<CustomerRow>();

  if (customerError) {
    if (isMissingTableInSchemaCache(customerError, "customers")) {
      return NextResponse.json(
        { error: missingTableMessageWithMigration("customers", "db/customers-schema.sql") },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to load customer: ${customerError.message}` },
      { status: 500 },
    );
  }

  if (!customerRow) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  const { data: ticketsData, error: ticketsError } = await supabase
    .from("tickets")
    .select(
      "id, organization_id, customer_id, order_id, title, description, status, priority, assignee_id, created_by, sla_due_at, created_at, updated_at, closed_at",
    )
    .eq("organization_id", activeOrgId)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(200)
    .returns<TicketRow[]>();

  if (ticketsError) {
    if (isMissingTableInSchemaCache(ticketsError, "tickets")) {
      return NextResponse.json(
        { error: missingTableMessageWithMigration("tickets", "db/tickets-schema.sql") },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to load customer tickets: ${ticketsError.message}` },
      { status: 500 },
    );
  }

  const { data: ordersData, error: ordersError } = await supabase
    .from("orders")
    .select("id, order_number, status, currency, total_amount, created_at, placed_at")
    .eq("organization_id", activeOrgId)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(200)
    .returns<CustomerOrderRow[]>();

  if (ordersError) {
    if (isMissingTableInSchemaCache(ordersError, "orders")) {
      return NextResponse.json(
        { error: missingTableMessageWithMigration("orders", "db/orders-schema.sql") },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to load customer orders: ${ordersError.message}` },
      { status: 500 },
    );
  }

  const tickets = ticketsData ?? [];
  const orders: CustomerOrderListItem[] = (ordersData ?? []).map((order) => ({
    ...order,
    currency: order.currency.trim().toUpperCase(),
  }));
  const orderIds = orders.map((order) => order.id);

  let orderEvents: OrderStatusEventRow[] = [];
  if (orderIds.length > 0) {
    const { data: orderEventsData, error: orderEventsError } = await supabase
      .from("order_status_events")
      .select("id, order_id, from_status, to_status, actor_user_id, reason, created_at")
      .eq("organization_id", activeOrgId)
      .in("order_id", orderIds)
      .order("created_at", { ascending: false })
      .limit(250)
      .returns<OrderStatusEventRow[]>();

    if (orderEventsError) {
      if (isMissingTableInSchemaCache(orderEventsError, "order_status_events")) {
        return NextResponse.json(
          { error: missingTableMessageWithMigration("order_status_events", "db/orders-schema.sql") },
          { status: 500 },
        );
      }
      return NextResponse.json(
        { error: `Failed to load customer order activity: ${orderEventsError.message}` },
        { status: 500 },
      );
    }

    orderEvents = orderEventsData ?? [];
  }

  let auditLogs: AuditLogRow[] = [];
  {
    const { data: auditLogsData, error: auditLogsError } = await supabase
      .from("audit_logs")
      .select("id, action, actor_user_id, created_at")
      .eq("organization_id", activeOrgId)
      .eq("entity_id", customerId)
      .or("entity_type.eq.customer,entity_type.eq.customers")
      .order("created_at", { ascending: false })
      .limit(100)
      .returns<AuditLogRow[]>();

    if (auditLogsError && !isMissingTableInSchemaCache(auditLogsError, "audit_logs")) {
      return NextResponse.json(
        { error: `Failed to load customer audit logs: ${auditLogsError.message}` },
        { status: 500 },
      );
    }

    auditLogs = auditLogsData ?? [];
  }

  const userIds = Array.from(
    new Set(
      [
        ...tickets.flatMap((ticket) => [ticket.created_by, ticket.assignee_id]),
        ...orderEvents.map((event) => event.actor_user_id),
        ...auditLogs.map((log) => log.actor_user_id),
      ]
        .filter(Boolean)
        .map((id) => id as string),
    ),
  );

  let usersById = new Map<string, UserRow>();
  if (userIds.length > 0) {
    const { data: usersData, error: usersError } = await supabase
      .from("users")
      .select("id, name, email, avatar_url")
      .in("id", userIds)
      .returns<UserRow[]>();

    if (usersError) {
      return NextResponse.json(
        { error: `Failed to load ticket users: ${usersError.message}` },
        { status: 500 },
      );
    }

    usersById = new Map((usersData ?? []).map((user) => [user.id, user]));
  }

  const responseTickets: TicketListItem[] = tickets.map((ticket) => ({
    ...ticket,
    assignee: ticket.assignee_id ? usersById.get(ticket.assignee_id) ?? null : null,
    creator: usersById.get(ticket.created_by) ?? null,
    customer: {
      id: customerRow.id,
      name: customerRow.name,
      email: customerRow.email,
    },
  }));

  const openTicketsCount = responseTickets.filter(
    (ticket) => ticket.status === "open" || ticket.status === "pending",
  ).length;
  const totalRevenueAmount = orders.reduce(
    (sum, order) => sum + getRevenueDelta(order.status, order.total_amount),
    0,
  );

  const ordersById = new Map(orders.map((order) => [order.id, order]));
  const activity: CustomerActivityItem[] = [];

  for (const event of orderEvents) {
    const order = ordersById.get(event.order_id);
    if (!order) {
      continue;
    }

    let title = `Order #${order.order_number} status changed to ${toStatusLabel(event.to_status)}`;
    if (event.to_status === "paid") {
      title = `Payment received ${formatMoney(order.total_amount, order.currency)}`;
    } else if (event.to_status === "fulfilled") {
      title = `Order #${order.order_number} completed`;
    } else if (event.from_status === event.to_status) {
      title = `Order #${order.order_number} created`;
    }

    activity.push({
      id: `order-event-${event.id}`,
      title,
      occurred_at: event.created_at,
      actor: event.actor_user_id ? usersById.get(event.actor_user_id) ?? null : null,
    });
  }

  for (const ticket of responseTickets) {
    activity.push({
      id: `ticket-created-${ticket.id}`,
      title: `Ticket #${toTicketCode(ticket.id)} created`,
      occurred_at: ticket.created_at,
      actor: ticket.creator,
    });
  }

  for (const log of auditLogs) {
    activity.push({
      id: `audit-${log.id}`,
      title: toAuditTitle(log.action),
      occurred_at: log.created_at,
      actor: log.actor_user_id ? usersById.get(log.actor_user_id) ?? null : null,
    });
  }

  if (auditLogs.length === 0 && customerRow.updated_at !== customerRow.created_at) {
    activity.push({
      id: `customer-updated-${customerRow.id}`,
      title: "Profile updated",
      occurred_at: customerRow.updated_at,
      actor: null,
    });
  }

  activity.sort(
    (a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime(),
  );

  const customer: CustomerListItem = {
    ...customerRow,
    open_tickets_count: openTicketsCount,
    total_tickets_count: responseTickets.length,
    total_orders_count: orders.length,
    total_revenue_amount: totalRevenueAmount,
  };

  const response: CustomerDetailResponse = {
    customer,
    tickets: responseTickets,
    orders,
    activity: activity.slice(0, 100),
    activeOrgId,
    currentUserId: userId,
  };

  return NextResponse.json(response, { status: 200 });
}

export async function PATCH(req: Request, context: RouteContext) {
  const ctxResult = await getTicketRequestContext();
  if (!ctxResult.ok) {
    return NextResponse.json({ error: ctxResult.error }, { status: ctxResult.status });
  }

  const { supabase, activeOrgId } = ctxResult.context;
  if (!activeOrgId) {
    return NextResponse.json(
      { error: "No active organization selected. Create or join an organization first." },
      { status: 400 },
    );
  }

  const customerId = await resolveCustomerId(context);
  if (!customerId) {
    return NextResponse.json({ error: "Customer id is required" }, { status: 400 });
  }

  let body: UpdateCustomerBody;
  try {
    body = (await req.json()) as UpdateCustomerBody;
  } catch {
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }

  const updatePayload: Partial<CustomerRow> = {};

  if (Object.prototype.hasOwnProperty.call(body, "name")) {
    const name = normalizeText(body.name);
    if (!name) {
      return NextResponse.json(
        { error: "Customer name cannot be empty" },
        { status: 400 },
      );
    }
    updatePayload.name = name;
  }

  if (Object.prototype.hasOwnProperty.call(body, "email")) {
    updatePayload.email = normalizeEmail(body.email);
  }

  if (Object.prototype.hasOwnProperty.call(body, "phone")) {
    updatePayload.phone = normalizeText(body.phone);
  }

  if (Object.prototype.hasOwnProperty.call(body, "externalId")) {
    updatePayload.external_id = normalizeText(body.externalId);
  }

  if (Object.prototype.hasOwnProperty.call(body, "status")) {
    const status = normalizeStatus(body.status);
    if (!status) {
      return NextResponse.json(
        { error: "Invalid customer status" },
        { status: 400 },
      );
    }
    updatePayload.status = status;
  }

  if (Object.keys(updatePayload).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data: updatedCustomer, error: updateError } = await supabase
    .from("customers")
    .update(updatePayload)
    .eq("organization_id", activeOrgId)
    .eq("id", customerId)
    .select("id, organization_id, name, email, phone, status, external_id, created_at, updated_at")
    .maybeSingle<CustomerRow>();

  if (updateError) {
    if (isMissingTableInSchemaCache(updateError, "customers")) {
      return NextResponse.json(
        { error: missingTableMessageWithMigration("customers", "db/customers-schema.sql") },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to update customer: ${updateError.message}` },
      { status: 500 },
    );
  }

  if (!updatedCustomer) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  const customer: CustomerListItem = {
    ...updatedCustomer,
    open_tickets_count: 0,
    total_tickets_count: 0,
    total_orders_count: 0,
    total_revenue_amount: 0,
  };

  return NextResponse.json({ customer }, { status: 200 });
}
