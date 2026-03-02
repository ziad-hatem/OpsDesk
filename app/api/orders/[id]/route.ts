import { NextResponse } from "next/server";
import { getTicketRequestContext } from "@/lib/server/ticket-context";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type {
  OrderAttachment,
  OrderCustomer,
  OrderDetailResponse,
  OrderItem,
  OrderListItem,
  OrderStatus,
  OrderStatusEvent,
  OrderUser,
} from "@/lib/orders/types";
import { isOrderStatus } from "@/lib/orders/validation";
import { isMissingTableInSchemaCache, missingTableMessageWithMigration } from "@/lib/tickets/errors";

type OrderRow = Omit<OrderListItem, "customer" | "creator">;
type CustomerRow = OrderCustomer;
type UserRow = OrderUser;
type OrderStatusEventRow = Omit<OrderStatusEvent, "actor">;
type OrderAttachmentRow = Omit<OrderAttachment, "uploader">;

type RouteContext = {
  params: Promise<{ id: string }>;
};

type UpdateOrderBody = {
  status?: string;
  statusReason?: string | null;
  notes?: string | null;
  customerId?: string;
  placedAt?: string | null;
  paidAt?: string | null;
  fulfilledAt?: string | null;
  cancelledAt?: string | null;
};

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

function normalizeIsoDate(value: unknown): string | null {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function normalizeCurrencyForResponse(currency: string): string {
  return currency.trim().toUpperCase();
}

async function resolveOrderId(context: RouteContext) {
  const params = await context.params;
  return params.id?.trim() ?? "";
}

async function buildOrderDetailResponse(params: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  activeOrgId: string;
  orderId: string;
  userId: string;
}): Promise<
  { ok: true; data: OrderDetailResponse } | { ok: false; status: number; error: string }
> {
  const { supabase, activeOrgId, orderId, userId } = params;

  const { data: orderRow, error: orderError } = await supabase
    .from("orders")
    .select(
      "id, organization_id, customer_id, order_number, status, currency, subtotal_amount, tax_amount, discount_amount, total_amount, placed_at, paid_at, fulfilled_at, cancelled_at, notes, created_by, created_at, updated_at",
    )
    .eq("organization_id", activeOrgId)
    .eq("id", orderId)
    .maybeSingle<OrderRow>();

  if (orderError) {
    if (isMissingTableInSchemaCache(orderError, "orders")) {
      return {
        ok: false,
        status: 500,
        error: missingTableMessageWithMigration("orders", "db/orders-schema.sql"),
      };
    }
    return {
      ok: false,
      status: 500,
      error: `Failed to load order: ${orderError.message}`,
    };
  }

  if (!orderRow) {
    return { ok: false, status: 404, error: "Order not found" };
  }

  const [
    { data: itemsData, error: itemsError },
    { data: attachmentsData, error: attachmentsError },
    { data: eventsData, error: eventsError },
    { data: customerData, error: customerError },
  ] = await Promise.all([
    supabase
      .from("order_items")
      .select(
        "id, organization_id, order_id, sku, name, quantity, unit_price_amount, total_amount, created_at",
      )
      .eq("organization_id", activeOrgId)
      .eq("order_id", orderId)
      .order("created_at", { ascending: true })
      .returns<OrderItem[]>(),
    supabase
      .from("order_attachments")
      .select(
        "id, organization_id, order_id, file_name, file_size, mime_type, storage_key, uploaded_by, created_at",
      )
      .eq("organization_id", activeOrgId)
      .eq("order_id", orderId)
      .order("created_at", { ascending: false })
      .returns<OrderAttachmentRow[]>(),
    supabase
      .from("order_status_events")
      .select(
        "id, organization_id, order_id, from_status, to_status, actor_user_id, reason, created_at",
      )
      .eq("organization_id", activeOrgId)
      .eq("order_id", orderId)
      .order("created_at", { ascending: false })
      .returns<OrderStatusEventRow[]>(),
    supabase
      .from("customers")
      .select("id, name, email")
      .eq("organization_id", activeOrgId)
      .eq("id", orderRow.customer_id)
      .maybeSingle<CustomerRow>(),
  ]);

  if (itemsError) {
    if (isMissingTableInSchemaCache(itemsError, "order_items")) {
      return {
        ok: false,
        status: 500,
        error: missingTableMessageWithMigration("order_items", "db/orders-schema.sql"),
      };
    }
    return {
      ok: false,
      status: 500,
      error: `Failed to load order items: ${itemsError.message}`,
    };
  }

  if (eventsError) {
    if (isMissingTableInSchemaCache(eventsError, "order_status_events")) {
      return {
        ok: false,
        status: 500,
        error: missingTableMessageWithMigration("order_status_events", "db/orders-schema.sql"),
      };
    }
    return {
      ok: false,
      status: 500,
      error: `Failed to load order status events: ${eventsError.message}`,
    };
  }

  if (attachmentsError) {
    if (isMissingTableInSchemaCache(attachmentsError, "order_attachments")) {
      return {
        ok: false,
        status: 500,
        error: missingTableMessageWithMigration("order_attachments", "db/orders-schema.sql"),
      };
    }
    return {
      ok: false,
      status: 500,
      error: `Failed to load order attachments: ${attachmentsError.message}`,
    };
  }

  if (customerError) {
    if (isMissingTableInSchemaCache(customerError, "customers")) {
      return {
        ok: false,
        status: 500,
        error: missingTableMessageWithMigration("customers", "db/customers-schema.sql"),
      };
    }
    return {
      ok: false,
      status: 500,
      error: `Failed to load order customer: ${customerError.message}`,
    };
  }

  const actorIds = Array.from(
    new Set(
      [
        orderRow.created_by,
        ...(eventsData ?? []).map((event) => event.actor_user_id),
        ...(attachmentsData ?? []).map((attachment) => attachment.uploaded_by),
      ]
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    ),
  );

  let usersById = new Map<string, UserRow>();
  if (actorIds.length > 0) {
    const { data: usersData, error: usersError } = await supabase
      .from("users")
      .select("id, name, email, avatar_url")
      .in("id", actorIds)
      .returns<UserRow[]>();

    if (usersError) {
      return {
        ok: false,
        status: 500,
        error: `Failed to load order users: ${usersError.message}`,
      };
    }

    usersById = new Map((usersData ?? []).map((user) => [user.id, user]));
  }

  const order: OrderListItem = {
    ...orderRow,
    currency: normalizeCurrencyForResponse(orderRow.currency),
    customer: customerData ?? null,
    creator: usersById.get(orderRow.created_by) ?? null,
  };

  const statusEvents: OrderStatusEvent[] = (eventsData ?? []).map((event) => ({
    ...event,
    actor: event.actor_user_id ? usersById.get(event.actor_user_id) ?? null : null,
  }));
  const attachments: OrderAttachment[] = (attachmentsData ?? []).map((attachment) => ({
    ...attachment,
    uploader: usersById.get(attachment.uploaded_by) ?? null,
  }));

  return {
    ok: true,
    data: {
      order,
      items: itemsData ?? [],
      attachments,
      statusEvents,
      activeOrgId,
      currentUserId: userId,
    },
  };
}

function hasProperty<T extends object>(obj: T, key: keyof T): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
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

  const orderId = await resolveOrderId(context);
  if (!orderId) {
    return NextResponse.json({ error: "Order id is required" }, { status: 400 });
  }

  const detailResult = await buildOrderDetailResponse({
    supabase,
    activeOrgId,
    orderId,
    userId,
  });

  if (!detailResult.ok) {
    return NextResponse.json({ error: detailResult.error }, { status: detailResult.status });
  }

  return NextResponse.json(detailResult.data, { status: 200 });
}

export async function PATCH(req: Request, context: RouteContext) {
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

  const orderId = await resolveOrderId(context);
  if (!orderId) {
    return NextResponse.json({ error: "Order id is required" }, { status: 400 });
  }

  let body: UpdateOrderBody;
  try {
    body = (await req.json()) as UpdateOrderBody;
  } catch {
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }

  const { data: existingOrder, error: existingOrderError } = await supabase
    .from("orders")
    .select(
      "id, organization_id, customer_id, order_number, status, currency, subtotal_amount, tax_amount, discount_amount, total_amount, placed_at, paid_at, fulfilled_at, cancelled_at, notes, created_by, created_at, updated_at",
    )
    .eq("organization_id", activeOrgId)
    .eq("id", orderId)
    .maybeSingle<OrderRow>();

  if (existingOrderError) {
    if (isMissingTableInSchemaCache(existingOrderError, "orders")) {
      return NextResponse.json(
        { error: missingTableMessageWithMigration("orders", "db/orders-schema.sql") },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to load order: ${existingOrderError.message}` },
      { status: 500 },
    );
  }

  if (!existingOrder) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const updatePayload: Partial<OrderRow> = {};
  let fromStatus: OrderStatus | null = null;
  let toStatus: OrderStatus | null = null;
  const statusReason = normalizeText(body.statusReason);

  if (hasProperty(body, "status")) {
    if (!body.status || !isOrderStatus(body.status)) {
      return NextResponse.json({ error: "Invalid order status" }, { status: 400 });
    }

    if (body.status !== existingOrder.status) {
      updatePayload.status = body.status;
      fromStatus = existingOrder.status;
      toStatus = body.status;

      const nowIso = new Date().toISOString();
      if (body.status === "pending" && !existingOrder.placed_at) {
        updatePayload.placed_at = nowIso;
      }
      if (body.status === "paid" && !existingOrder.paid_at) {
        updatePayload.paid_at = nowIso;
      }
      if (body.status === "fulfilled" && !existingOrder.fulfilled_at) {
        updatePayload.fulfilled_at = nowIso;
      }
      if (body.status === "cancelled" && !existingOrder.cancelled_at) {
        updatePayload.cancelled_at = nowIso;
      }
    }
  }

  if (hasProperty(body, "notes")) {
    const notes = normalizeText(body.notes);
    if (notes !== existingOrder.notes) {
      updatePayload.notes = notes;
    }
  }

  if (hasProperty(body, "customerId")) {
    const customerId = normalizeText(body.customerId);
    if (!customerId) {
      return NextResponse.json(
        { error: "customerId cannot be empty when provided" },
        { status: 400 },
      );
    }

    const { count, error: customerError } = await supabase
      .from("customers")
      .select("id", { head: true, count: "exact" })
      .eq("organization_id", activeOrgId)
      .eq("id", customerId);

    if (customerError) {
      if (isMissingTableInSchemaCache(customerError, "customers")) {
        return NextResponse.json(
          { error: missingTableMessageWithMigration("customers", "db/customers-schema.sql") },
          { status: 500 },
        );
      }
      return NextResponse.json(
        { error: `Failed to verify customer access: ${customerError.message}` },
        { status: 500 },
      );
    }

    if (!count) {
      return NextResponse.json(
        { error: "Selected customer is not part of this organization" },
        { status: 400 },
      );
    }

    if (customerId !== existingOrder.customer_id) {
      updatePayload.customer_id = customerId;
    }
  }

  if (hasProperty(body, "placedAt")) {
    const placedAt = body.placedAt ? normalizeIsoDate(body.placedAt) : null;
    if (body.placedAt && !placedAt) {
      return NextResponse.json({ error: "placedAt must be a valid ISO date-time" }, { status: 400 });
    }
    if (placedAt !== existingOrder.placed_at) {
      updatePayload.placed_at = placedAt;
    }
  }

  if (hasProperty(body, "paidAt")) {
    const paidAt = body.paidAt ? normalizeIsoDate(body.paidAt) : null;
    if (body.paidAt && !paidAt) {
      return NextResponse.json({ error: "paidAt must be a valid ISO date-time" }, { status: 400 });
    }
    if (paidAt !== existingOrder.paid_at) {
      updatePayload.paid_at = paidAt;
    }
  }

  if (hasProperty(body, "fulfilledAt")) {
    const fulfilledAt = body.fulfilledAt ? normalizeIsoDate(body.fulfilledAt) : null;
    if (body.fulfilledAt && !fulfilledAt) {
      return NextResponse.json({ error: "fulfilledAt must be a valid ISO date-time" }, { status: 400 });
    }
    if (fulfilledAt !== existingOrder.fulfilled_at) {
      updatePayload.fulfilled_at = fulfilledAt;
    }
  }

  if (hasProperty(body, "cancelledAt")) {
    const cancelledAt = body.cancelledAt ? normalizeIsoDate(body.cancelledAt) : null;
    if (body.cancelledAt && !cancelledAt) {
      return NextResponse.json({ error: "cancelledAt must be a valid ISO date-time" }, { status: 400 });
    }
    if (cancelledAt !== existingOrder.cancelled_at) {
      updatePayload.cancelled_at = cancelledAt;
    }
  }

  if (Object.keys(updatePayload).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { error: updateError } = await supabase
    .from("orders")
    .update(updatePayload)
    .eq("organization_id", activeOrgId)
    .eq("id", orderId);

  if (updateError) {
    if (isMissingTableInSchemaCache(updateError, "orders")) {
      return NextResponse.json(
        { error: missingTableMessageWithMigration("orders", "db/orders-schema.sql") },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to update order: ${updateError.message}` },
      { status: 500 },
    );
  }

  if (fromStatus && toStatus) {
    const { error: eventError } = await supabase.from("order_status_events").insert({
      organization_id: activeOrgId,
      order_id: orderId,
      from_status: fromStatus,
      to_status: toStatus,
      actor_user_id: userId,
      reason: statusReason,
    });

    if (eventError) {
      if (isMissingTableInSchemaCache(eventError, "order_status_events")) {
        return NextResponse.json(
          { error: missingTableMessageWithMigration("order_status_events", "db/orders-schema.sql") },
          { status: 500 },
        );
      }
      return NextResponse.json(
        { error: `Order updated but failed to write status event: ${eventError.message}` },
        { status: 500 },
      );
    }
  }

  const detailResult = await buildOrderDetailResponse({
    supabase,
    activeOrgId,
    orderId,
    userId,
  });

  if (!detailResult.ok) {
    return NextResponse.json({ error: detailResult.error }, { status: detailResult.status });
  }

  return NextResponse.json(detailResult.data, { status: 200 });
}
