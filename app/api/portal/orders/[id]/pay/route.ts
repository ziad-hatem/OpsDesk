import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/server/audit-logs";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  ensureCustomerPortalIdentityUser,
  getCustomerPortalContext,
} from "@/lib/server/customer-portal-auth";
import { runPortalEventAutomationEngine } from "@/lib/server/automation-engine";
import { getAppBaseUrl, getStripeClient } from "@/lib/server/stripe";
import { isMissingTableInSchemaCache, missingTableMessageWithMigration } from "@/lib/tickets/errors";

export const runtime = "nodejs";

const STRIPE_CHECKOUT_EXPIRES_IN_SECONDS = 23 * 60 * 60;

type RouteContext = {
  params: Promise<{ id: string }>;
};

type OrderRow = {
  id: string;
  organization_id: string;
  customer_id: string;
  order_number: string;
  status: "draft" | "pending" | "paid" | "fulfilled" | "cancelled" | "refunded";
  payment_status:
    | "unpaid"
    | "payment_link_sent"
    | "paid"
    | "failed"
    | "refunded"
    | "expired"
    | "cancelled";
  currency: string;
  total_amount: number;
};

async function resolveOrderId(context: RouteContext): Promise<string> {
  const params = await context.params;
  return params.id?.trim() ?? "";
}

export async function POST(_req: Request, context: RouteContext) {
  const portalContext = await getCustomerPortalContext();
  if (!portalContext) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orderId = await resolveOrderId(context);
  if (!orderId) {
    return NextResponse.json({ error: "Order id is required" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { organizationId, customerId } = portalContext;

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select(
      "id, organization_id, customer_id, order_number, status, payment_status, currency, total_amount",
    )
    .eq("organization_id", organizationId)
    .eq("customer_id", customerId)
    .eq("id", orderId)
    .maybeSingle<OrderRow>();

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

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (order.status === "cancelled" || order.status === "refunded") {
    return NextResponse.json(
      { error: `Cannot pay a ${order.status} order` },
      { status: 409 },
    );
  }

  if (order.payment_status === "paid") {
    return NextResponse.json({ error: "This order is already paid" }, { status: 409 });
  }

  if (order.total_amount <= 0) {
    return NextResponse.json(
      { error: "Order total must be greater than 0 to pay online" },
      { status: 400 },
    );
  }

  const baseUrl = getAppBaseUrl();
  const stripe = getStripeClient();
  const expiresAtSeconds =
    Math.floor(Date.now() / 1000) + STRIPE_CHECKOUT_EXPIRES_IN_SECONDS;
  const successUrl =
    `${baseUrl}/portal?` +
    `tab=orders&` +
    `paid=1&` +
    `order=${encodeURIComponent(order.id)}&` +
    "session_id={CHECKOUT_SESSION_ID}";
  const cancelUrl =
    `${baseUrl}/portal?` +
    `tab=orders&` +
    `payment=cancelled&` +
    `order=${encodeURIComponent(order.id)}`;

  let sessionUrl: string | null = null;
  let sessionId = "";
  let paymentIntentId: string | null = null;
  let expiresAtIso = new Date(expiresAtSeconds * 1000).toISOString();

  try {
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: portalContext.email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: order.currency.trim().toLowerCase(),
            unit_amount: order.total_amount,
            product_data: {
              name: `Order ${order.order_number}`,
              description: `Payment for order ${order.order_number}`,
            },
          },
        },
      ],
      metadata: {
        order_id: order.id,
        organization_id: organizationId,
        customer_id: customerId,
        source: "customer_portal",
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
      expires_at: expiresAtSeconds,
    });

    sessionUrl = checkoutSession.url;
    sessionId = checkoutSession.id;
    paymentIntentId =
      typeof checkoutSession.payment_intent === "string"
        ? checkoutSession.payment_intent
        : null;
    if (checkoutSession.expires_at) {
      expiresAtIso = new Date(checkoutSession.expires_at * 1000).toISOString();
    }
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to create payment session";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  if (!sessionUrl) {
    return NextResponse.json(
      { error: "Stripe checkout session did not return a payment URL" },
      { status: 502 },
    );
  }

  const nowIso = new Date().toISOString();
  const { error: updateOrderError } = await supabase
    .from("orders")
    .update({
      payment_status: "payment_link_sent",
      payment_link_url: sessionUrl,
      payment_link_sent_at: nowIso,
      stripe_checkout_session_id: sessionId,
      stripe_payment_intent_id: paymentIntentId,
    })
    .eq("organization_id", organizationId)
    .eq("id", order.id);

  if (updateOrderError) {
    return NextResponse.json(
      { error: `Payment link created but order update failed: ${updateOrderError.message}` },
      { status: 500 },
    );
  }

  let actorUserId: string | null = null;
  try {
    actorUserId = await ensureCustomerPortalIdentityUser({
      organizationId,
      customerId,
      customerName: portalContext.customer.name,
    });
  } catch {
    actorUserId = null;
  }

  await writeAuditLog({
    supabase,
    organizationId,
    actorUserId,
    action: "order.payment_link.opened_from_portal",
    entityType: "order",
    entityId: order.id,
    details: {
      orderNumber: order.order_number,
      checkoutSessionId: sessionId,
      expiresAt: expiresAtIso,
      source: "customer_portal",
    },
  });

  await runPortalEventAutomationEngine({
    supabase,
    organizationId,
    actorUserId,
    triggerEvent: "portal.order_payment_started",
    portalEvent: {
      id: sessionId,
      organization_id: organizationId,
      event_name: "portal.order_payment_started",
      entity_type: "order",
      entity_id: order.id,
      title: order.order_number,
      status: order.status,
      customer_id: customerId,
      email: portalContext.email,
      metadata: {
        paymentStatus: order.payment_status,
        checkoutSessionId: sessionId,
        paymentIntentId,
        expiresAt: expiresAtIso,
      },
      created_at: nowIso,
      updated_at: nowIso,
    },
  });

  return NextResponse.json(
    {
      checkoutUrl: sessionUrl,
      stripeCheckoutSessionId: sessionId,
      expiresAt: expiresAtIso,
    },
    { status: 200 },
  );
}
