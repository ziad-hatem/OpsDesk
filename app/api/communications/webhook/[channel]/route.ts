import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  insertCustomerCommunication,
  isCommunicationChannel,
  isCommunicationDirection,
} from "@/lib/server/communications";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ channel: string }>;
};

type WebhookEventPayload = {
  organizationId?: string;
  channel?: string;
  direction?: string;
  body?: string;
  subject?: string | null;
  provider?: string | null;
  providerMessageId?: string | null;
  threadKey?: string | null;
  senderName?: string | null;
  senderEmail?: string | null;
  senderPhone?: string | null;
  recipientName?: string | null;
  recipientEmail?: string | null;
  recipientPhone?: string | null;
  customerId?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  ticketId?: string | null;
  orderId?: string | null;
  incidentId?: string | null;
  metadata?: Record<string, unknown> | null;
  occurredAt?: string | null;
};

type WebhookBody = {
  organizationId?: string;
  events?: WebhookEventPayload[];
} & WebhookEventPayload;

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function readWebhookSecret(req: Request): string | null {
  const fromHeader =
    req.headers.get("x-webhook-secret") ??
    req.headers.get("x-opsdesk-webhook-secret");
  if (fromHeader) {
    return fromHeader.trim();
  }

  const authorization = req.headers.get("authorization");
  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }
  return token.trim();
}

async function resolveChannel(context: RouteContext): Promise<string> {
  const params = await context.params;
  return params.channel?.trim().toLowerCase() ?? "";
}

export async function POST(req: Request, context: RouteContext) {
  const expectedSecret = normalizeText(process.env.COMMUNICATIONS_WEBHOOK_SECRET);
  if (!expectedSecret) {
    return NextResponse.json(
      { error: "COMMUNICATIONS_WEBHOOK_SECRET is not configured" },
      { status: 500 },
    );
  }

  const providedSecret = readWebhookSecret(req);
  if (!providedSecret || providedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized webhook request" }, { status: 401 });
  }

  const routeChannel = await resolveChannel(context);
  if (!isCommunicationChannel(routeChannel)) {
    return NextResponse.json(
      { error: "Webhook channel must be one of email, chat, whatsapp, sms" },
      { status: 400 },
    );
  }

  let body: WebhookBody = {};
  try {
    body = (await req.json()) as WebhookBody;
  } catch {
    body = {};
  }

  const events = Array.isArray(body.events) && body.events.length > 0
    ? body.events
    : [body];

  const baseOrganizationId = normalizeText(body.organizationId);
  const supabase = createSupabaseAdminClient();

  let accepted = 0;
  const errors: Array<{ index: number; error: string }> = [];

  for (const [index, event] of events.entries()) {
    const organizationId = normalizeText(event.organizationId) ?? baseOrganizationId;
    if (!organizationId) {
      errors.push({
        index,
        error: "organizationId is required for webhook ingestion",
      });
      continue;
    }

    const direction = isCommunicationDirection(event.direction) ? event.direction : "inbound";
    const channel = isCommunicationChannel(event.channel) ? event.channel : routeChannel;

    try {
      await insertCustomerCommunication({
        supabase,
        organizationId,
        channel,
        direction,
        body: event.body ?? "",
        subject: event.subject,
        provider: event.provider ?? routeChannel,
        providerMessageId: event.providerMessageId,
        threadKey: event.threadKey,
        senderName: event.senderName,
        senderEmail: event.senderEmail,
        senderPhone: event.senderPhone,
        recipientName: event.recipientName,
        recipientEmail: event.recipientEmail,
        recipientPhone: event.recipientPhone,
        customerId: event.customerId,
        customerEmail: event.customerEmail,
        customerPhone: event.customerPhone,
        ticketId: event.ticketId,
        orderId: event.orderId,
        incidentId: event.incidentId,
        metadata: event.metadata,
        occurredAt: event.occurredAt,
      });
      accepted += 1;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to ingest webhook event";
      errors.push({ index, error: message });
    }
  }

  const failed = errors.length;
  const status = failed > 0 && accepted === 0 ? 400 : 200;

  return NextResponse.json(
    {
      channel: routeChannel,
      accepted,
      failed,
      errors,
    },
    { status },
  );
}
