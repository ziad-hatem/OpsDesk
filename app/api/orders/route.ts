import { NextResponse } from "next/server";
import { getTicketRequestContext } from "@/lib/server/ticket-context";
import type {
  OrderCustomer,
  OrderItem,
  OrderListItem,
  OrdersListResponse,
  OrderUser,
} from "@/lib/orders/types";
import {
  derivePaymentStatusFromOrderStatus,
  isOrderPaymentStatus,
  isOrderStatus,
  normalizeCurrencyCode,
  normalizeOrderStatus,
} from "@/lib/orders/validation";
import { isMissingTableInSchemaCache, missingTableMessageWithMigration } from "@/lib/tickets/errors";

type OrderRow = Omit<OrderListItem, "customer" | "creator">;
type CustomerRow = OrderCustomer;
type UserRow = OrderUser;

type CreateOrderItemInput = {
  sku?: string | null;
  name?: string;
  quantity?: number;
  unitPriceAmount?: number;
  totalAmount?: number;
};

type CreateOrderBody = {
  customerId?: string;
  orderNumber?: string;
  status?: string;
  currency?: string;
  subtotalAmount?: number;
  taxAmount?: number;
  discountAmount?: number;
  totalAmount?: number;
  placedAt?: string | null;
  paidAt?: string | null;
  fulfilledAt?: string | null;
  cancelledAt?: string | null;
  notes?: string | null;
  items?: CreateOrderItemInput[];
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

function normalizeNonNegativeInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    return null;
  }
  return value >= 0 ? value : null;
}

function normalizePositiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    return null;
  }
  return value > 0 ? value : null;
}

function normalizeOrderNumber(value: unknown): string | null {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, 50).toUpperCase();
}

function generateOrderNumber(): string {
  const year = new Date().getUTCFullYear();
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
  return `ORD-${year}-${suffix}`;
}

function normalizeCurrencyForResponse(currency: string): string {
  return currency.trim().toUpperCase();
}

function hasProperty<T extends object>(
  obj: T,
  key: keyof T,
): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
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

  try {
    const { searchParams } = new URL(req.url);
    const statusFilter = searchParams.get("status");
    const paymentStatusFilter = searchParams.get("paymentStatus");
    const customerIdFilter = searchParams.get("customerId");
    const search = searchParams.get("search")?.trim() ?? "";
    const limitParam = Number(searchParams.get("limit") ?? "200");
    const limit = Number.isFinite(limitParam)
      ? Math.min(Math.max(limitParam, 1), 1000)
      : 200;

    let query = supabase
      .from("orders")
      .select(
        "id, organization_id, customer_id, order_number, status, payment_status, currency, subtotal_amount, tax_amount, discount_amount, total_amount, placed_at, paid_at, fulfilled_at, cancelled_at, stripe_checkout_session_id, stripe_payment_intent_id, payment_link_url, payment_link_sent_at, payment_completed_at, notes, created_by, created_at, updated_at",
      )
      .eq("organization_id", activeOrgId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (statusFilter && statusFilter !== "all" && isOrderStatus(statusFilter)) {
      query = query.eq("status", statusFilter);
    }

    if (
      paymentStatusFilter &&
      paymentStatusFilter !== "all" &&
      isOrderPaymentStatus(paymentStatusFilter)
    ) {
      query = query.eq("payment_status", paymentStatusFilter);
    }

    if (customerIdFilter && customerIdFilter !== "all") {
      query = query.eq("customer_id", customerIdFilter);
    }

    if (search.length > 0) {
      const safeSearch = search.replace(/[%_,]/g, "");
      if (safeSearch.length > 0) {
        query = query.or(
          `order_number.ilike.%${safeSearch}%,notes.ilike.%${safeSearch}%`,
        );
      }
    }

    const { data: ordersData, error: ordersError } = await query.returns<OrderRow[]>();
    if (ordersError) {
      if (isMissingTableInSchemaCache(ordersError, "orders")) {
        return NextResponse.json(
          { error: missingTableMessageWithMigration("orders", "db/orders-schema.sql") },
          { status: 500 },
        );
      }
      return NextResponse.json(
        { error: `Failed to load orders: ${ordersError.message}` },
        { status: 500 },
      );
    }

    const orders = ordersData ?? [];
    const customerIds = Array.from(new Set(orders.map((order) => order.customer_id)));
    const creatorIds = Array.from(new Set(orders.map((order) => order.created_by)));

    let customersById = new Map<string, CustomerRow>();
    if (customerIds.length > 0) {
      const { data: customersData, error: customersError } = await supabase
        .from("customers")
        .select("id, name, email")
        .eq("organization_id", activeOrgId)
        .in("id", customerIds)
        .returns<CustomerRow[]>();

      if (customersError) {
        if (isMissingTableInSchemaCache(customersError, "customers")) {
          return NextResponse.json(
            { error: missingTableMessageWithMigration("customers", "db/customers-schema.sql") },
            { status: 500 },
          );
        }
        return NextResponse.json(
          { error: `Failed to load order customers: ${customersError.message}` },
          { status: 500 },
        );
      }

      customersById = new Map(
        (customersData ?? []).map((customer) => [customer.id, customer]),
      );
    }

    let creatorsById = new Map<string, UserRow>();
    if (creatorIds.length > 0) {
      const { data: creatorsData, error: creatorsError } = await supabase
        .from("users")
        .select("id, name, email, avatar_url")
        .in("id", creatorIds)
        .returns<UserRow[]>();

      if (creatorsError) {
        return NextResponse.json(
          { error: `Failed to load order creators: ${creatorsError.message}` },
          { status: 500 },
        );
      }

      creatorsById = new Map((creatorsData ?? []).map((user) => [user.id, user]));
    }

    const responseOrders: OrderListItem[] = orders.map((order) => ({
      ...order,
      currency: normalizeCurrencyForResponse(order.currency),
      customer: customersById.get(order.customer_id) ?? null,
      creator: creatorsById.get(order.created_by) ?? null,
    }));

    const response: OrdersListResponse = {
      orders: responseOrders,
      activeOrgId,
      currentUserId: userId,
    };

    return NextResponse.json(response, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Failed to load orders" }, { status: 500 });
  }
}

export async function POST(req: Request) {
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

  try {
    const body = (await req.json()) as CreateOrderBody;

    const customerId = normalizeText(body.customerId);
    if (!customerId) {
      return NextResponse.json({ error: "customerId is required" }, { status: 400 });
    }

    const status = normalizeOrderStatus(body.status, "draft");
    const paymentStatus = derivePaymentStatusFromOrderStatus(status);
    const currency = normalizeCurrencyCode(body.currency, "");
    if (!currency) {
      return NextResponse.json(
        { error: "currency must be a valid 3-letter ISO code (e.g., USD)" },
        { status: 400 },
      );
    }

    const subtotalAmount = normalizeNonNegativeInteger(body.subtotalAmount);
    const taxAmount = normalizeNonNegativeInteger(body.taxAmount);
    const discountAmount = normalizeNonNegativeInteger(body.discountAmount);
    const totalAmount = normalizeNonNegativeInteger(body.totalAmount);
    if (
      subtotalAmount === null ||
      taxAmount === null ||
      discountAmount === null ||
      totalAmount === null
    ) {
      return NextResponse.json(
        {
          error:
            "subtotalAmount, taxAmount, discountAmount, and totalAmount must be non-negative integers (in cents)",
        },
        { status: 400 },
      );
    }

    if (totalAmount !== subtotalAmount + taxAmount - discountAmount) {
      return NextResponse.json(
        { error: "totalAmount must equal subtotalAmount + taxAmount - discountAmount" },
        { status: 400 },
      );
    }

    const orderNumber = normalizeOrderNumber(body.orderNumber) ?? generateOrderNumber();
    const notes = normalizeText(body.notes);

    const placedAtRaw = hasProperty(body, "placedAt") ? body.placedAt : undefined;
    const paidAtRaw = hasProperty(body, "paidAt") ? body.paidAt : undefined;
    const fulfilledAtRaw = hasProperty(body, "fulfilledAt") ? body.fulfilledAt : undefined;
    const cancelledAtRaw = hasProperty(body, "cancelledAt") ? body.cancelledAt : undefined;

    const placedAt = placedAtRaw ? normalizeIsoDate(placedAtRaw) : null;
    const paidAt = paidAtRaw ? normalizeIsoDate(paidAtRaw) : null;
    const fulfilledAt = fulfilledAtRaw ? normalizeIsoDate(fulfilledAtRaw) : null;
    const cancelledAt = cancelledAtRaw ? normalizeIsoDate(cancelledAtRaw) : null;

    if (placedAtRaw && !placedAt) {
      return NextResponse.json({ error: "placedAt must be a valid ISO date-time" }, { status: 400 });
    }
    if (paidAtRaw && !paidAt) {
      return NextResponse.json({ error: "paidAt must be a valid ISO date-time" }, { status: 400 });
    }
    if (fulfilledAtRaw && !fulfilledAt) {
      return NextResponse.json({ error: "fulfilledAt must be a valid ISO date-time" }, { status: 400 });
    }
    if (cancelledAtRaw && !cancelledAt) {
      return NextResponse.json({ error: "cancelledAt must be a valid ISO date-time" }, { status: 400 });
    }

    const { data: customerData, error: customerError } = await supabase
      .from("customers")
      .select("id, name, email")
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
        { error: `Failed to verify customer access: ${customerError.message}` },
        { status: 500 },
      );
    }

    if (!customerData) {
      return NextResponse.json(
        { error: "Selected customer is not part of this organization" },
        { status: 400 },
      );
    }

    const { data: insertedOrder, error: insertedOrderError } = await supabase
      .from("orders")
      .insert({
        organization_id: activeOrgId,
        customer_id: customerId,
        order_number: orderNumber,
        status,
        payment_status: paymentStatus,
        currency,
        subtotal_amount: subtotalAmount,
        tax_amount: taxAmount,
        discount_amount: discountAmount,
        total_amount: totalAmount,
        placed_at: placedAt,
        paid_at: paidAt,
        fulfilled_at: fulfilledAt,
        cancelled_at: cancelledAt,
        notes,
        created_by: userId,
      })
      .select(
        "id, organization_id, customer_id, order_number, status, payment_status, currency, subtotal_amount, tax_amount, discount_amount, total_amount, placed_at, paid_at, fulfilled_at, cancelled_at, stripe_checkout_session_id, stripe_payment_intent_id, payment_link_url, payment_link_sent_at, payment_completed_at, notes, created_by, created_at, updated_at",
      )
      .single<OrderRow>();

    if (insertedOrderError || !insertedOrder) {
      if (isMissingTableInSchemaCache(insertedOrderError, "orders")) {
        return NextResponse.json(
          { error: missingTableMessageWithMigration("orders", "db/orders-schema.sql") },
          { status: 500 },
        );
      }
      return NextResponse.json(
        { error: `Failed to create order: ${insertedOrderError?.message ?? "Unknown error"}` },
        { status: 500 },
      );
    }

    const providedItems = Array.isArray(body.items) ? body.items : [];
    const itemsToInsert: Array<{
      organization_id: string;
      order_id: string;
      sku: string | null;
      name: string;
      quantity: number;
      unit_price_amount: number;
      total_amount: number;
    }> = [];

    for (const item of providedItems) {
      const name = normalizeText(item.name);
      if (!name) {
        return NextResponse.json(
          { error: "Each order item requires a name" },
          { status: 400 },
        );
      }

      const quantity = normalizePositiveInteger(item.quantity);
      const unitPriceAmount = normalizeNonNegativeInteger(item.unitPriceAmount);
      const totalAmountValue = item.totalAmount ?? (quantity && unitPriceAmount !== null
        ? quantity * unitPriceAmount
        : null);
      const normalizedTotalAmount = normalizeNonNegativeInteger(totalAmountValue);

      if (
        quantity === null ||
        unitPriceAmount === null ||
        normalizedTotalAmount === null
      ) {
        return NextResponse.json(
          {
            error:
              "Each order item requires quantity > 0 and non-negative integer amounts (in cents)",
          },
          { status: 400 },
        );
      }

      itemsToInsert.push({
        organization_id: activeOrgId,
        order_id: insertedOrder.id,
        sku: normalizeText(item.sku),
        name,
        quantity,
        unit_price_amount: unitPriceAmount,
        total_amount: normalizedTotalAmount,
      });
    }

    let insertedItems: OrderItem[] = [];
    if (itemsToInsert.length > 0) {
      const { data: insertedItemsData, error: insertedItemsError } = await supabase
        .from("order_items")
        .insert(itemsToInsert)
        .select(
          "id, organization_id, order_id, sku, name, quantity, unit_price_amount, total_amount, created_at",
        )
        .returns<OrderItem[]>();

      if (insertedItemsError) {
        await supabase
          .from("orders")
          .delete()
          .eq("organization_id", activeOrgId)
          .eq("id", insertedOrder.id);

        if (isMissingTableInSchemaCache(insertedItemsError, "order_items")) {
          return NextResponse.json(
            { error: missingTableMessageWithMigration("order_items", "db/orders-schema.sql") },
            { status: 500 },
          );
        }
        return NextResponse.json(
          { error: `Failed to create order items: ${insertedItemsError.message}` },
          { status: 500 },
        );
      }

      insertedItems = insertedItemsData ?? [];
    }

    const { error: statusEventError } = await supabase.from("order_status_events").insert({
      organization_id: activeOrgId,
      order_id: insertedOrder.id,
      from_status: status,
      to_status: status,
      actor_user_id: userId,
      reason: "Order created",
    });

    if (statusEventError) {
      if (isMissingTableInSchemaCache(statusEventError, "order_status_events")) {
        return NextResponse.json(
          { error: missingTableMessageWithMigration("order_status_events", "db/orders-schema.sql") },
          { status: 500 },
        );
      }
      return NextResponse.json(
        { error: `Order created but failed to write status event: ${statusEventError.message}` },
        { status: 500 },
      );
    }

    const { data: creatorData, error: creatorError } = await supabase
      .from("users")
      .select("id, name, email, avatar_url")
      .eq("id", insertedOrder.created_by)
      .maybeSingle<OrderUser>();

    if (creatorError) {
      return NextResponse.json(
        { error: `Order created but failed to load creator: ${creatorError.message}` },
        { status: 500 },
      );
    }

    const order: OrderListItem = {
      ...insertedOrder,
      currency: normalizeCurrencyForResponse(insertedOrder.currency),
      customer: customerData,
      creator: creatorData ?? null,
    };

    return NextResponse.json({ order, items: insertedItems }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }
}
