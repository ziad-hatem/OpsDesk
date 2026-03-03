import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isMissingTableInSchemaCache } from "@/lib/tickets/errors";

export const COMMUNICATION_CHANNELS = ["email", "chat", "whatsapp", "sms"] as const;
export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number];

export const COMMUNICATION_DIRECTIONS = ["inbound", "outbound"] as const;
export type CommunicationDirection = (typeof COMMUNICATION_DIRECTIONS)[number];

type SupabaseClient = ReturnType<typeof createSupabaseAdminClient>;

type CustomerLookupRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
};

type TicketLookupRow = {
  id: string;
  customer_id: string | null;
};

type OrderLookupRow = {
  id: string;
  customer_id: string;
};

type IncidentLookupRow = {
  id: string;
};

export type CustomerCommunicationRow = {
  id: string;
  organization_id: string;
  customer_id: string;
  channel: CommunicationChannel;
  direction: CommunicationDirection;
  provider: string | null;
  provider_message_id: string | null;
  thread_key: string | null;
  subject: string | null;
  body: string;
  sender_name: string | null;
  sender_email: string | null;
  sender_phone: string | null;
  recipient_name: string | null;
  recipient_email: string | null;
  recipient_phone: string | null;
  actor_user_id: string | null;
  ticket_id: string | null;
  order_id: string | null;
  incident_id: string | null;
  metadata: Record<string, unknown> | null;
  occurred_at: string;
  created_at: string;
};

export type InsertCustomerCommunicationParams = {
  supabase: SupabaseClient;
  organizationId: string;
  actorUserId?: string | null;
  channel: CommunicationChannel;
  direction: CommunicationDirection;
  body: string;
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

type HttpError = Error & { status: number };

function createHttpError(status: number, message: string): HttpError {
  const error = new Error(message) as HttpError;
  error.status = status;
  return error;
}

export function isCommunicationChannel(value: unknown): value is CommunicationChannel {
  return (
    typeof value === "string" &&
    (COMMUNICATION_CHANNELS as readonly string[]).includes(value)
  );
}

export function isCommunicationDirection(value: unknown): value is CommunicationDirection {
  return (
    typeof value === "string" &&
    (COMMUNICATION_DIRECTIONS as readonly string[]).includes(value)
  );
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeEmail(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized ? normalized.toLowerCase() : null;
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

function sanitizePhoneForCompare(value: unknown): string | null {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  const sanitized = normalized.replace(/[^\d+]/g, "");
  return sanitized.length > 0 ? sanitized : null;
}

export function isMissingCommunicationsSchema(
  error: { message?: string } | null | undefined,
  table: string = "customer_communications",
): boolean {
  const message = (error?.message ?? "").toLowerCase();
  return (
    message.includes(table.toLowerCase()) &&
    (message.includes("schema cache") || message.includes("does not exist"))
  );
}

function isDuplicateProviderMessageError(
  error: { message?: string } | null | undefined,
): boolean {
  const message = (error?.message ?? "").toLowerCase();
  return (
    message.includes("duplicate key") &&
    message.includes("idx_customer_communications_org_provider_message_unique")
  );
}

async function resolveCustomerForCommunication(params: {
  supabase: SupabaseClient;
  organizationId: string;
  customerId?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
}): Promise<CustomerLookupRow | null> {
  const { supabase, organizationId } = params;
  const customerId = normalizeText(params.customerId);
  const customerEmail = normalizeEmail(params.customerEmail);
  const customerPhone = sanitizePhoneForCompare(params.customerPhone);

  if (customerId) {
    const { data, error } = await supabase
      .from("customers")
      .select("id, name, email, phone")
      .eq("organization_id", organizationId)
      .eq("id", customerId)
      .maybeSingle<CustomerLookupRow>();
    if (error) {
      if (isMissingTableInSchemaCache(error, "customers")) {
        throw createHttpError(
          500,
          "Customers schema is missing. Run db/customers-schema.sql and reload PostgREST schema.",
        );
      }
      throw createHttpError(500, `Failed to resolve customer: ${error.message}`);
    }
    return data ?? null;
  }

  if (customerEmail) {
    const { data, error } = await supabase
      .from("customers")
      .select("id, name, email, phone")
      .eq("organization_id", organizationId)
      .ilike("email", customerEmail)
      .order("updated_at", { ascending: false })
      .limit(1)
      .returns<CustomerLookupRow[]>();
    if (error) {
      throw createHttpError(500, `Failed to resolve customer by email: ${error.message}`);
    }
    if ((data ?? []).length > 0) {
      return data?.[0] ?? null;
    }
  }

  if (customerPhone) {
    const { data, error } = await supabase
      .from("customers")
      .select("id, name, email, phone")
      .eq("organization_id", organizationId)
      .eq("phone", customerPhone)
      .order("updated_at", { ascending: false })
      .limit(1)
      .returns<CustomerLookupRow[]>();
    if (error) {
      throw createHttpError(500, `Failed to resolve customer by phone: ${error.message}`);
    }
    if ((data ?? []).length > 0) {
      return data?.[0] ?? null;
    }
  }

  return null;
}

async function validateRelatedEntities(params: {
  supabase: SupabaseClient;
  organizationId: string;
  customerId: string;
  ticketId?: string | null;
  orderId?: string | null;
  incidentId?: string | null;
}): Promise<{
  ticketId: string | null;
  orderId: string | null;
  incidentId: string | null;
}> {
  const { supabase, organizationId, customerId } = params;
  const ticketId = normalizeText(params.ticketId);
  const orderId = normalizeText(params.orderId);
  const incidentId = normalizeText(params.incidentId);

  if (ticketId) {
    const { data, error } = await supabase
      .from("tickets")
      .select("id, customer_id")
      .eq("organization_id", organizationId)
      .eq("id", ticketId)
      .maybeSingle<TicketLookupRow>();

    if (error) {
      if (isMissingTableInSchemaCache(error, "tickets")) {
        throw createHttpError(
          500,
          "Tickets schema is missing. Run db/tickets-schema.sql and reload PostgREST schema.",
        );
      }
      throw createHttpError(500, `Failed to validate ticket link: ${error.message}`);
    }
    if (!data) {
      throw createHttpError(400, "ticketId is invalid for the active organization");
    }
    if (data.customer_id && data.customer_id !== customerId) {
      throw createHttpError(400, "ticketId does not belong to the resolved customer");
    }
  }

  if (orderId) {
    const { data, error } = await supabase
      .from("orders")
      .select("id, customer_id")
      .eq("organization_id", organizationId)
      .eq("id", orderId)
      .maybeSingle<OrderLookupRow>();

    if (error) {
      if (isMissingTableInSchemaCache(error, "orders")) {
        throw createHttpError(
          500,
          "Orders schema is missing. Run db/orders-schema.sql and reload PostgREST schema.",
        );
      }
      throw createHttpError(500, `Failed to validate order link: ${error.message}`);
    }
    if (!data) {
      throw createHttpError(400, "orderId is invalid for the active organization");
    }
    if (data.customer_id !== customerId) {
      throw createHttpError(400, "orderId does not belong to the resolved customer");
    }
  }

  if (incidentId) {
    const { data, error } = await supabase
      .from("incidents")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("id", incidentId)
      .maybeSingle<IncidentLookupRow>();

    if (error) {
      if (isMissingTableInSchemaCache(error, "incidents")) {
        throw createHttpError(
          500,
          "Incidents schema is missing. Run db/incidents-schema.sql and reload PostgREST schema.",
        );
      }
      throw createHttpError(500, `Failed to validate incident link: ${error.message}`);
    }
    if (!data) {
      throw createHttpError(400, "incidentId is invalid for the active organization");
    }
  }

  return {
    ticketId: ticketId ?? null,
    orderId: orderId ?? null,
    incidentId: incidentId ?? null,
  };
}

export async function insertCustomerCommunication(
  params: InsertCustomerCommunicationParams,
): Promise<CustomerCommunicationRow> {
  const {
    supabase,
    organizationId,
    actorUserId = null,
    channel,
    direction,
    metadata,
  } = params;

  if (!isCommunicationChannel(channel)) {
    throw createHttpError(400, "Invalid communication channel");
  }

  if (!isCommunicationDirection(direction)) {
    throw createHttpError(400, "Invalid communication direction");
  }

  const body = normalizeText(params.body);
  if (!body) {
    throw createHttpError(400, "Communication body is required");
  }

  const customer = await resolveCustomerForCommunication({
    supabase,
    organizationId,
    customerId: params.customerId,
    customerEmail: params.customerEmail,
    customerPhone: params.customerPhone,
  });

  if (!customer) {
    throw createHttpError(
      404,
      "Unable to resolve customer from customerId, customerEmail, or customerPhone",
    );
  }

  const links = await validateRelatedEntities({
    supabase,
    organizationId,
    customerId: customer.id,
    ticketId: params.ticketId,
    orderId: params.orderId,
    incidentId: params.incidentId,
  });

  const provider = normalizeText(params.provider);
  const providerMessageId = normalizeText(params.providerMessageId);
  const threadKey = normalizeText(params.threadKey);
  const subject = normalizeText(params.subject);
  const senderName = normalizeText(params.senderName);
  const senderEmail = normalizeEmail(params.senderEmail);
  const senderPhone = sanitizePhoneForCompare(params.senderPhone);
  const recipientName = normalizeText(params.recipientName);
  const recipientEmail = normalizeEmail(params.recipientEmail);
  const recipientPhone = sanitizePhoneForCompare(params.recipientPhone);
  const occurredAt = normalizeIsoDate(params.occurredAt) ?? new Date().toISOString();
  const normalizedMetadata =
    metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : null;

  const { data, error } = await supabase
    .from("customer_communications")
    .insert({
      organization_id: organizationId,
      customer_id: customer.id,
      channel,
      direction,
      provider,
      provider_message_id: providerMessageId,
      thread_key: threadKey,
      subject,
      body,
      sender_name: senderName,
      sender_email: senderEmail,
      sender_phone: senderPhone,
      recipient_name: recipientName,
      recipient_email: recipientEmail,
      recipient_phone: recipientPhone,
      actor_user_id: actorUserId,
      ticket_id: links.ticketId,
      order_id: links.orderId,
      incident_id: links.incidentId,
      metadata: normalizedMetadata,
      occurred_at: occurredAt,
    })
    .select(
      "id, organization_id, customer_id, channel, direction, provider, provider_message_id, thread_key, subject, body, sender_name, sender_email, sender_phone, recipient_name, recipient_email, recipient_phone, actor_user_id, ticket_id, order_id, incident_id, metadata, occurred_at, created_at",
    )
    .maybeSingle<CustomerCommunicationRow>();

  if (error) {
    if (isMissingCommunicationsSchema(error)) {
      throw createHttpError(
        500,
        "Communications schema is missing. Run db/communications-schema.sql and reload PostgREST schema.",
      );
    }

    if (provider && providerMessageId && isDuplicateProviderMessageError(error)) {
      const { data: existing } = await supabase
        .from("customer_communications")
        .select(
          "id, organization_id, customer_id, channel, direction, provider, provider_message_id, thread_key, subject, body, sender_name, sender_email, sender_phone, recipient_name, recipient_email, recipient_phone, actor_user_id, ticket_id, order_id, incident_id, metadata, occurred_at, created_at",
        )
        .eq("organization_id", organizationId)
        .eq("provider", provider)
        .eq("provider_message_id", providerMessageId)
        .maybeSingle<CustomerCommunicationRow>();

      if (existing) {
        return existing;
      }
    }

    throw createHttpError(500, `Failed to insert communication: ${error.message}`);
  }

  if (!data) {
    throw createHttpError(500, "Failed to insert communication");
  }

  return data;
}

export async function insertCustomerCommunicationSafe(
  params: InsertCustomerCommunicationParams & { source?: string },
): Promise<CustomerCommunicationRow | null> {
  try {
    return await insertCustomerCommunication(params);
  } catch (error: unknown) {
    const source = normalizeText(params.source) ?? "unknown";
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`Communication insert failed (${source}): ${message}`);
    return null;
  }
}

export function formatCommunicationPreview(
  body: string,
  maxLength: number = 120,
): string {
  const normalized = body.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function getCommunicationHttpStatus(error: unknown, fallback: number = 500): number {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number" && Number.isFinite(status)) {
      return status;
    }
  }
  return fallback;
}
