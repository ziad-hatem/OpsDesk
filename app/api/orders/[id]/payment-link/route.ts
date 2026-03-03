import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/server/audit-logs";
import { authorizeRbacAction, loadActorMembership } from "@/lib/server/rbac";
import { getTicketRequestContext } from "@/lib/server/ticket-context";
import { sendOrderPaymentLinkEmail } from "@/lib/server/order-payment-email";
import { getAppBaseUrl, getStripeClient } from "@/lib/server/stripe";
import { isMissingTableInSchemaCache, missingTableMessageWithMigration } from "@/lib/tickets/errors";

export const runtime = "nodejs";
const STRIPE_CHECKOUT_EXPIRES_IN_SECONDS = 23 * 60 * 60;

type RouteContext = {
  params: Promise<{ id: string }>;
};

type OrderPaymentRow = {
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

type CustomerRow = {
  id: string;
  name: string;
  email: string | null;
};

type OrganizationRow = {
  id: string;
  name: string;
};

async function resolveOrderId(context: RouteContext): Promise<string> {
  const params = await context.params;
  return params.id?.trim() ?? "";
}

export async function POST(_req: Request, context: RouteContext) {
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

  const actorMembershipResult = await loadActorMembership({
    supabase,
    organizationId: activeOrgId,
    userId,
  });
  if (actorMembershipResult.error) {
    return NextResponse.json(
      { error: `Failed to verify organization membership: ${actorMembershipResult.error}` },
      { status: 500 },
    );
  }
  if (!actorMembershipResult.membership || actorMembershipResult.membership.status !== "active") {
    return NextResponse.json(
      { error: "You do not have access to this organization" },
      { status: 403 },
    );
  }

  const authorizeBilling = await authorizeRbacAction({
    supabase,
    organizationId: activeOrgId,
    userId,
    permissionKey: "action.billing.order.payment_link.send",
    actionLabel: "Send order payment link",
    fallbackAllowed:
      actorMembershipResult.membership.role === "admin" ||
      actorMembershipResult.membership.role === "manager",
    actorMembership: actorMembershipResult.membership,
    useApprovalFlow: true,
    entityType: "order",
    entityId: orderId,
  });
  if (!authorizeBilling.ok) {
    return NextResponse.json(
      {
        error: authorizeBilling.error,
        code: authorizeBilling.code,
        approvalRequestId: authorizeBilling.approvalRequestId ?? null,
      },
      { status: authorizeBilling.status },
    );
  }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select(
      "id, organization_id, customer_id, order_number, status, payment_status, currency, total_amount",
    )
    .eq("organization_id", activeOrgId)
    .eq("id", orderId)
    .maybeSingle<OrderPaymentRow>();

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
      { error: `Cannot send payment link for ${order.status} order` },
      { status: 409 },
    );
  }

  if (order.payment_status === "paid") {
    return NextResponse.json(
      { error: "This order is already paid" },
      { status: 409 },
    );
  }

  if (order.total_amount <= 0) {
    return NextResponse.json(
      { error: "Order total must be greater than 0 to request payment" },
      { status: 400 },
    );
  }

  const [{ data: customer, error: customerError }, { data: organization, error: orgError }] =
    await Promise.all([
      supabase
        .from("customers")
        .select("id, name, email")
        .eq("organization_id", activeOrgId)
        .eq("id", order.customer_id)
        .maybeSingle<CustomerRow>(),
      supabase
        .from("organizations")
        .select("id, name")
        .eq("id", activeOrgId)
        .maybeSingle<OrganizationRow>(),
    ]);

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

  if (!customer) {
    return NextResponse.json({ error: "Order customer not found" }, { status: 404 });
  }

  if (!customer.email) {
    return NextResponse.json(
      { error: "Customer does not have an email address" },
      { status: 400 },
    );
  }

  if (orgError) {
    return NextResponse.json(
      { error: `Failed to load organization: ${orgError.message}` },
      { status: 500 },
    );
  }

  const baseUrl = getAppBaseUrl();
  const stripe = getStripeClient();
  const expiresAtSeconds =
    Math.floor(Date.now() / 1000) + STRIPE_CHECKOUT_EXPIRES_IN_SECONDS;
  const successUrl =
    `${baseUrl}/payment/thank-you?` +
    `order_id=${encodeURIComponent(order.id)}&` +
    `order_number=${encodeURIComponent(order.order_number)}&` +
    "session_id={CHECKOUT_SESSION_ID}";
  const cancelUrl = `${baseUrl}/orders/${order.id}?payment=cancelled`;

  let sessionUrl: string | null = null;
  let sessionId = "";
  let paymentIntentId: string | null = null;
  let expiresAtIso = new Date(expiresAtSeconds * 1000).toISOString();

  try {
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: customer.email,
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
        organization_id: activeOrgId,
        customer_id: customer.id,
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
      error instanceof Error ? error.message : "Failed to create Stripe checkout session";
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
    .eq("organization_id", activeOrgId)
    .eq("id", order.id);

  if (updateOrderError) {
    return NextResponse.json(
      { error: `Payment link created but order update failed: ${updateOrderError.message}` },
      { status: 500 },
    );
  }

  try {
    await sendOrderPaymentLinkEmail({
      toEmail: customer.email,
      customerName: customer.name ?? null,
      organizationName: organization?.name ?? "OpsDesk",
      orderNumber: order.order_number,
      amountCents: order.total_amount,
      currency: order.currency,
      paymentUrl: sessionUrl,
      expiresAt: expiresAtIso,
    });
  } catch (error: unknown) {
    const { error: markFailedError } = await supabase
      .from("orders")
      .update({
        payment_status: "failed",
      })
      .eq("organization_id", activeOrgId)
      .eq("id", order.id);

    if (markFailedError) {
      console.error(
        `Failed to mark order ${order.id} payment status as failed: ${markFailedError.message}`,
      );
    }

    const message =
      error instanceof Error ? error.message : "Failed to send payment email";
    return NextResponse.json(
      { error: `Payment link created but email sending failed: ${message}` },
      { status: 502 },
    );
  }

  await writeAuditLog({
    supabase,
    organizationId: activeOrgId,
    actorUserId: userId,
    action: "order.payment_link.sent",
    entityType: "order",
    entityId: order.id,
    details: {
      orderNumber: order.order_number,
      customerEmail: customer.email,
      checkoutSessionId: sessionId,
      expiresAt: expiresAtIso,
    },
  });

  return NextResponse.json(
    {
      orderId: order.id,
      paymentStatus: "payment_link_sent",
      paymentLinkUrl: sessionUrl,
      stripeCheckoutSessionId: sessionId,
      expiresAt: expiresAtIso,
    },
    { status: 200 },
  );
}
