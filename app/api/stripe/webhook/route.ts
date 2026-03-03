import Stripe from "stripe";
import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/server/audit-logs";
import { getStripeClient, getStripeWebhookSecret } from "@/lib/server/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type OrderWebhookRow = {
  id: string;
  organization_id: string;
  status: "draft" | "pending" | "paid" | "fulfilled" | "cancelled" | "refunded";
  payment_status:
    | "unpaid"
    | "payment_link_sent"
    | "paid"
    | "failed"
    | "refunded"
    | "expired"
    | "cancelled";
  paid_at: string | null;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
};

async function findOrderByCheckoutSession(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  session: Stripe.Checkout.Session,
): Promise<OrderWebhookRow | null> {
  const bySessionIdResult = await supabase
    .from("orders")
    .select(
      "id, organization_id, status, payment_status, paid_at, stripe_checkout_session_id, stripe_payment_intent_id",
    )
    .eq("stripe_checkout_session_id", session.id)
    .maybeSingle<OrderWebhookRow>();

  if (bySessionIdResult.error) {
    throw new Error(bySessionIdResult.error.message);
  }
  if (bySessionIdResult.data) {
    return bySessionIdResult.data;
  }

  const metadataOrderId = session.metadata?.order_id?.trim();
  const metadataOrgId = session.metadata?.organization_id?.trim();
  if (!metadataOrderId || !metadataOrgId) {
    return null;
  }

  const byMetadataResult = await supabase
    .from("orders")
    .select(
      "id, organization_id, status, payment_status, paid_at, stripe_checkout_session_id, stripe_payment_intent_id",
    )
    .eq("organization_id", metadataOrgId)
    .eq("id", metadataOrderId)
    .maybeSingle<OrderWebhookRow>();

  if (byMetadataResult.error) {
    throw new Error(byMetadataResult.error.message);
  }

  return byMetadataResult.data ?? null;
}

async function findOrderByPaymentIntent(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  paymentIntentId: string,
): Promise<OrderWebhookRow | null> {
  const result = await supabase
    .from("orders")
    .select(
      "id, organization_id, status, payment_status, paid_at, stripe_checkout_session_id, stripe_payment_intent_id",
    )
    .eq("stripe_payment_intent_id", paymentIntentId)
    .maybeSingle<OrderWebhookRow>();

  if (result.error) {
    throw new Error(result.error.message);
  }

  return result.data ?? null;
}

async function insertStatusEvent(params: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  organizationId: string;
  orderId: string;
  fromStatus: OrderWebhookRow["status"];
  toStatus: OrderWebhookRow["status"];
  reason: string;
}) {
  const { supabase, organizationId, orderId, fromStatus, toStatus, reason } = params;
  const { error } = await supabase.from("order_status_events").insert({
    organization_id: organizationId,
    order_id: orderId,
    from_status: fromStatus,
    to_status: toStatus,
    actor_user_id: null,
    reason,
  });

  if (error) {
    console.error(
      `Failed to write order_status_events for order ${orderId}: ${error.message}`,
    );
  }
}

async function handleCheckoutCompleted(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  session: Stripe.Checkout.Session,
) {
  const order = await findOrderByCheckoutSession(supabase, session);
  if (!order) {
    return;
  }

  const nowIso = new Date().toISOString();
  const paymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : null;
  const nextStatus: OrderWebhookRow["status"] =
    order.status === "draft" || order.status === "pending" ? "paid" : order.status;

  const updatePayload: Partial<OrderWebhookRow> & {
    payment_completed_at: string;
    payment_status: OrderWebhookRow["payment_status"];
  } = {
    payment_status: "paid",
    payment_completed_at: nowIso,
    stripe_checkout_session_id: session.id,
    stripe_payment_intent_id: paymentIntentId ?? order.stripe_payment_intent_id,
  };

  if (!order.paid_at) {
    updatePayload.paid_at = nowIso;
  }
  if (nextStatus !== order.status) {
    updatePayload.status = nextStatus;
  }

  const { error: updateError } = await supabase
    .from("orders")
    .update(updatePayload)
    .eq("organization_id", order.organization_id)
    .eq("id", order.id);

  if (updateError) {
    throw new Error(updateError.message);
  }

  if (nextStatus !== order.status) {
    await insertStatusEvent({
      supabase,
      organizationId: order.organization_id,
      orderId: order.id,
      fromStatus: order.status,
      toStatus: nextStatus,
      reason: "Payment completed via Stripe checkout",
    });
  }

  await writeAuditLog({
    supabase,
    organizationId: order.organization_id,
    action: "order.payment.completed",
    entityType: "order",
    entityId: order.id,
    source: "stripe_webhook",
    details: {
      checkoutSessionId: session.id,
      paymentIntentId: paymentIntentId ?? order.stripe_payment_intent_id,
    },
  });
}

async function handleCheckoutExpired(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  session: Stripe.Checkout.Session,
) {
  const order = await findOrderByCheckoutSession(supabase, session);
  if (!order) {
    return;
  }

  const { error: updateError } = await supabase
    .from("orders")
    .update({
      payment_status: "expired",
      stripe_checkout_session_id: session.id,
    })
    .eq("organization_id", order.organization_id)
    .eq("id", order.id);

  if (updateError) {
    throw new Error(updateError.message);
  }

  await writeAuditLog({
    supabase,
    organizationId: order.organization_id,
    action: "order.payment.expired",
    entityType: "order",
    entityId: order.id,
    source: "stripe_webhook",
    details: {
      checkoutSessionId: session.id,
    },
  });
}

async function handlePaymentFailed(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  paymentIntent: Stripe.PaymentIntent,
) {
  const order = await findOrderByPaymentIntent(supabase, paymentIntent.id);
  if (!order) {
    return;
  }

  const { error: updateError } = await supabase
    .from("orders")
    .update({
      payment_status: "failed",
      stripe_payment_intent_id: paymentIntent.id,
    })
    .eq("organization_id", order.organization_id)
    .eq("id", order.id);

  if (updateError) {
    throw new Error(updateError.message);
  }

  await writeAuditLog({
    supabase,
    organizationId: order.organization_id,
    action: "order.payment.failed",
    entityType: "order",
    entityId: order.id,
    source: "stripe_webhook",
    details: {
      paymentIntentId: paymentIntent.id,
    },
  });
}

async function handleChargeRefunded(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  charge: Stripe.Charge,
) {
  const paymentIntentId =
    typeof charge.payment_intent === "string" ? charge.payment_intent : null;
  if (!paymentIntentId) {
    return;
  }

  const order = await findOrderByPaymentIntent(supabase, paymentIntentId);
  if (!order) {
    return;
  }

  const nextStatus: OrderWebhookRow["status"] =
    order.status === "paid" ? "refunded" : order.status;
  const updatePayload: Partial<OrderWebhookRow> = {
    payment_status: "refunded",
    stripe_payment_intent_id: paymentIntentId,
  };
  if (nextStatus !== order.status) {
    updatePayload.status = nextStatus;
  }

  const { error: updateError } = await supabase
    .from("orders")
    .update(updatePayload)
    .eq("organization_id", order.organization_id)
    .eq("id", order.id);

  if (updateError) {
    throw new Error(updateError.message);
  }

  if (nextStatus !== order.status) {
    await insertStatusEvent({
      supabase,
      organizationId: order.organization_id,
      orderId: order.id,
      fromStatus: order.status,
      toStatus: nextStatus,
      reason: "Payment refunded via Stripe",
    });
  }

  await writeAuditLog({
    supabase,
    organizationId: order.organization_id,
    action: "order.payment.refunded",
    entityType: "order",
    entityId: order.id,
    source: "stripe_webhook",
    details: {
      paymentIntentId,
      chargeId: charge.id,
      amountRefunded: charge.amount_refunded,
    },
  });
}

export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    const payload = await req.text();
    event = getStripeClient().webhooks.constructEvent(
      payload,
      signature,
      getStripeWebhookSecret(),
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Invalid webhook signature";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(
          supabase,
          event.data.object as Stripe.Checkout.Session,
        );
        break;
      case "checkout.session.expired":
        await handleCheckoutExpired(
          supabase,
          event.data.object as Stripe.Checkout.Session,
        );
        break;
      case "payment_intent.payment_failed":
        await handlePaymentFailed(
          supabase,
          event.data.object as Stripe.PaymentIntent,
        );
        break;
      case "charge.refunded":
        await handleChargeRefunded(supabase, event.data.object as Stripe.Charge);
        break;
      default:
        break;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to process webhook";
    console.error(`Stripe webhook processing failed for ${event.type}: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
