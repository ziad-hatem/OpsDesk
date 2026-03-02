import { NextResponse } from "next/server";
import { getTicketRequestContext } from "@/lib/server/ticket-context";
import type { OrderItem } from "@/lib/orders/types";
import { isMissingTableInSchemaCache, missingTableMessageWithMigration } from "@/lib/tickets/errors";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type CreateOrderItemBody = {
  sku?: string | null;
  name?: string;
  quantity?: number;
  unitPriceAmount?: number;
  totalAmount?: number;
};

type OrderTotalsRow = {
  subtotal_amount: number;
  total_amount: number;
};

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizePositiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    return null;
  }
  return value > 0 ? value : null;
}

function normalizeNonNegativeInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    return null;
  }
  return value >= 0 ? value : null;
}

async function resolveOrderId(context: RouteContext) {
  const params = await context.params;
  return params.id?.trim() ?? "";
}

export async function POST(req: Request, context: RouteContext) {
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

  const orderId = await resolveOrderId(context);
  if (!orderId) {
    return NextResponse.json({ error: "Order id is required" }, { status: 400 });
  }

  const { data: existingOrder, error: orderError } = await supabase
    .from("orders")
    .select("id, organization_id, subtotal_amount, total_amount")
    .eq("organization_id", activeOrgId)
    .eq("id", orderId)
    .maybeSingle<OrderTotalsRow & { id: string; organization_id: string }>();

  if (orderError) {
    if (isMissingTableInSchemaCache(orderError, "orders")) {
      return NextResponse.json(
        { error: missingTableMessageWithMigration("orders", "db/orders-schema.sql") },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to load order: ${orderError.message}` },
      { status: 500 },
    );
  }

  if (!existingOrder) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  let body: CreateOrderItemBody;
  try {
    body = (await req.json()) as CreateOrderItemBody;
  } catch {
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }

  const name = normalizeText(body.name);
  const quantity = normalizePositiveInteger(body.quantity);
  const unitPriceAmount = normalizeNonNegativeInteger(body.unitPriceAmount);

  if (!name) {
    return NextResponse.json({ error: "Line item name is required" }, { status: 400 });
  }
  if (quantity === null) {
    return NextResponse.json({ error: "quantity must be a positive integer" }, { status: 400 });
  }
  if (unitPriceAmount === null) {
    return NextResponse.json(
      { error: "unitPriceAmount must be a non-negative integer (in cents)" },
      { status: 400 },
    );
  }

  const totalAmount = normalizeNonNegativeInteger(
    body.totalAmount ?? quantity * unitPriceAmount,
  );
  if (totalAmount === null) {
    return NextResponse.json(
      { error: "totalAmount must be a non-negative integer (in cents)" },
      { status: 400 },
    );
  }

  if (totalAmount !== quantity * unitPriceAmount) {
    return NextResponse.json(
      { error: "totalAmount must equal quantity * unitPriceAmount" },
      { status: 400 },
    );
  }

  const { data: insertedItem, error: insertError } = await supabase
    .from("order_items")
    .insert({
      organization_id: activeOrgId,
      order_id: orderId,
      sku: normalizeText(body.sku),
      name,
      quantity,
      unit_price_amount: unitPriceAmount,
      total_amount: totalAmount,
    })
    .select("id, organization_id, order_id, sku, name, quantity, unit_price_amount, total_amount, created_at")
    .single<OrderItem>();

  if (insertError || !insertedItem) {
    if (isMissingTableInSchemaCache(insertError, "order_items")) {
      return NextResponse.json(
        { error: missingTableMessageWithMigration("order_items", "db/orders-schema.sql") },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to create line item: ${insertError?.message ?? "Unknown error"}` },
      { status: 500 },
    );
  }

  const nextSubtotalAmount = existingOrder.subtotal_amount + totalAmount;
  const nextTotalAmount = existingOrder.total_amount + totalAmount;

  const { data: updatedOrder, error: updateOrderError } = await supabase
    .from("orders")
    .update({
      subtotal_amount: nextSubtotalAmount,
      total_amount: nextTotalAmount,
    })
    .eq("organization_id", activeOrgId)
    .eq("id", orderId)
    .select("subtotal_amount, total_amount")
    .single<OrderTotalsRow>();

  if (updateOrderError || !updatedOrder) {
    await supabase
      .from("order_items")
      .delete()
      .eq("organization_id", activeOrgId)
      .eq("id", insertedItem.id);

    return NextResponse.json(
      {
        error: `Line item created but failed to update order totals: ${
          updateOrderError?.message ?? "Unknown error"
        }`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      item: insertedItem,
      orderTotals: updatedOrder,
    },
    { status: 201 },
  );
}
