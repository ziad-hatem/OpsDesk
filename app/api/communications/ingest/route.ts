import { NextResponse } from "next/server";
import { getTicketRequestContext } from "@/lib/server/ticket-context";
import {
  getCommunicationHttpStatus,
  insertCustomerCommunication,
  isCommunicationChannel,
  isCommunicationDirection,
} from "@/lib/server/communications";

type IngestCommunicationBody = {
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

  let body: IngestCommunicationBody = {};
  try {
    body = (await req.json()) as IngestCommunicationBody;
  } catch {
    body = {};
  }

  if (!isCommunicationChannel(body.channel)) {
    return NextResponse.json(
      { error: "channel is required (email, chat, whatsapp, sms)" },
      { status: 400 },
    );
  }

  if (!isCommunicationDirection(body.direction)) {
    return NextResponse.json(
      { error: "direction is required (inbound or outbound)" },
      { status: 400 },
    );
  }

  try {
    const communication = await insertCustomerCommunication({
      supabase,
      organizationId: activeOrgId,
      actorUserId: userId,
      channel: body.channel,
      direction: body.direction,
      body: body.body ?? "",
      subject: body.subject,
      provider: body.provider,
      providerMessageId: body.providerMessageId,
      threadKey: body.threadKey,
      senderName: body.senderName,
      senderEmail: body.senderEmail,
      senderPhone: body.senderPhone,
      recipientName: body.recipientName,
      recipientEmail: body.recipientEmail,
      recipientPhone: body.recipientPhone,
      customerId: body.customerId,
      customerEmail: body.customerEmail,
      customerPhone: body.customerPhone,
      ticketId: body.ticketId,
      orderId: body.orderId,
      incidentId: body.incidentId,
      metadata: body.metadata,
      occurredAt: body.occurredAt,
    });

    return NextResponse.json({ communication }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to ingest communication";
    const status = getCommunicationHttpStatus(error, 500);
    return NextResponse.json({ error: message }, { status });
  }
}
