import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getCustomerPortalContext } from "@/lib/server/customer-portal-auth";
import type { PortalTicketDetail, PortalTicketSummary } from "@/lib/portal/types";
import type { TicketAttachment, TicketTextWithAttachments, TicketUser } from "@/lib/tickets/types";
import { isMissingTableInSchemaCache, missingTableMessageWithMigration } from "@/lib/tickets/errors";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type TicketSummaryRow = Omit<PortalTicketSummary, "latest_message_at" | "attachments_count">;
type TicketTextRow = Omit<TicketTextWithAttachments, "author" | "attachments">;
type TicketAttachmentRow = Omit<TicketAttachment, "uploader">;
type UserRow = TicketUser;

async function resolveTicketId(context: RouteContext): Promise<string> {
  const params = await context.params;
  return params.id?.trim() ?? "";
}

export async function GET(_req: Request, context: RouteContext) {
  const portalContext = await getCustomerPortalContext();
  if (!portalContext) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ticketId = await resolveTicketId(context);
  if (!ticketId) {
    return NextResponse.json({ error: "Ticket id is required" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { organizationId, customerId } = portalContext;

  const { data: ticketRow, error: ticketError } = await supabase
    .from("tickets")
    .select(
      "id, organization_id, customer_id, order_id, title, description, status, priority, created_at, updated_at, closed_at",
    )
    .eq("organization_id", organizationId)
    .eq("customer_id", customerId)
    .eq("id", ticketId)
    .maybeSingle<TicketSummaryRow>();

  if (ticketError) {
    if (isMissingTableInSchemaCache(ticketError, "tickets")) {
      return NextResponse.json(
        { error: missingTableMessageWithMigration("tickets", "db/tickets-schema.sql") },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { error: `Failed to load portal ticket: ${ticketError.message}` },
      { status: 500 },
    );
  }

  if (!ticketRow) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }

  const [{ data: textRows, error: textError }, { data: attachmentRows, error: attachmentError }] =
    await Promise.all([
      supabase
        .from("ticket_texts")
        .select(
          "id, organization_id, ticket_id, author_id, type, body, created_at, updated_at",
        )
        .eq("organization_id", organizationId)
        .eq("ticket_id", ticketId)
        .order("created_at", { ascending: true })
        .returns<TicketTextRow[]>(),
      supabase
        .from("ticket_attachments")
        .select(
          "id, organization_id, ticket_id, ticket_text_id, file_name, file_size, mime_type, storage_key, uploaded_by, created_at",
        )
        .eq("organization_id", organizationId)
        .eq("ticket_id", ticketId)
        .order("created_at", { ascending: true })
        .returns<TicketAttachmentRow[]>(),
    ]);

  if (textError) {
    if (isMissingTableInSchemaCache(textError, "ticket_texts")) {
      return NextResponse.json(
        { error: missingTableMessageWithMigration("ticket_texts", "db/tickets-schema.sql") },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to load portal ticket messages: ${textError.message}` },
      { status: 500 },
    );
  }

  if (attachmentError) {
    if (isMissingTableInSchemaCache(attachmentError, "ticket_attachments")) {
      return NextResponse.json(
        {
          error: missingTableMessageWithMigration(
            "ticket_attachments",
            "db/tickets-schema.sql",
          ),
        },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to load portal ticket attachments: ${attachmentError.message}` },
      { status: 500 },
    );
  }

  const safeTextRows = textRows ?? [];
  const safeAttachmentRows = attachmentRows ?? [];

  const userIds = Array.from(
    new Set(
      [
        ...safeTextRows.map((row) => row.author_id),
        ...safeAttachmentRows.map((row) => row.uploaded_by),
      ],
    ),
  );

  let usersById = new Map<string, UserRow>();
  if (userIds.length > 0) {
    const { data: users, error: usersError } = await supabase
      .from("users")
      .select("id, name, email, avatar_url")
      .in("id", userIds)
      .returns<UserRow[]>();

    if (usersError) {
      return NextResponse.json(
        { error: `Failed to load message authors: ${usersError.message}` },
        { status: 500 },
      );
    }

    usersById = new Map((users ?? []).map((user) => [user.id, user]));
  }

  const attachments: TicketAttachment[] = safeAttachmentRows.map((attachment) => ({
    ...attachment,
    uploader: usersById.get(attachment.uploaded_by) ?? null,
  }));

  const attachmentsByTextId = new Map<string, TicketAttachment[]>();
  for (const attachment of attachments) {
    if (!attachment.ticket_text_id) {
      continue;
    }

    const existing = attachmentsByTextId.get(attachment.ticket_text_id);
    if (existing) {
      existing.push(attachment);
      continue;
    }

    attachmentsByTextId.set(attachment.ticket_text_id, [attachment]);
  }

  const texts: TicketTextWithAttachments[] = safeTextRows.map((text) => ({
    ...text,
    author: usersById.get(text.author_id) ?? null,
    attachments: attachmentsByTextId.get(text.id) ?? [],
  }));

  const latestMessageAt =
    safeTextRows.length > 0 ? safeTextRows[safeTextRows.length - 1]?.created_at ?? null : null;
  const ticket: PortalTicketSummary = {
    ...ticketRow,
    latest_message_at: latestMessageAt,
    attachments_count: attachments.length,
  };

  const payload: PortalTicketDetail = {
    ticket,
    texts,
    attachments,
  };

  return NextResponse.json(payload, { status: 200 });
}

