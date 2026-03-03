import { NextResponse } from "next/server";
import { getTicketRequestContext } from "@/lib/server/ticket-context";
import { runSlaEscalationEngine } from "@/lib/server/sla-engine";
import {
  getUniqueRecipientIds,
  insertAppNotifications,
} from "@/lib/server/notifications";
import type { TicketTextType, TicketTextWithAttachments, TicketUser } from "@/lib/tickets/types";
import { isTicketTextType } from "@/lib/tickets/validation";
import {
  isMissingTableInSchemaCache,
  missingTableMessage,
} from "@/lib/tickets/errors";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type CreateTicketTextBody = {
  body?: string;
  type?: string;
};

type TicketTextRow = Omit<TicketTextWithAttachments, "author" | "attachments">;
type TicketRecipientsRow = {
  id: string;
  title: string;
  assignee_id: string | null;
  created_by: string;
};

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeTicketTextType(value: unknown): TicketTextType {
  if (typeof value !== "string") {
    return "comment";
  }
  return isTicketTextType(value) ? value : "comment";
}

export async function POST(req: Request, context: RouteContext) {
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

  const params = await context.params;
  const ticketId = params.id?.trim();
  if (!ticketId) {
    return NextResponse.json({ error: "Ticket id is required" }, { status: 400 });
  }

  let body: CreateTicketTextBody;
  try {
    body = (await req.json()) as CreateTicketTextBody;
  } catch {
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }

  const content = normalizeText(body.body);
  if (!content) {
    return NextResponse.json({ error: "Message body is required" }, { status: 400 });
  }

  const type = normalizeTicketTextType(body.type);
  if (type === "system") {
    return NextResponse.json(
      { error: "Creating system messages manually is not allowed" },
      { status: 400 },
    );
  }

  const { data: ticketRow, error: ticketAccessError } = await supabase
    .from("tickets")
    .select("id, title, assignee_id, created_by")
    .eq("id", ticketId)
    .eq("organization_id", activeOrgId)
    .maybeSingle<TicketRecipientsRow>();

  if (ticketAccessError) {
    if (isMissingTableInSchemaCache(ticketAccessError, "tickets")) {
      return NextResponse.json(
        { error: missingTableMessage("tickets") },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to verify ticket access: ${ticketAccessError.message}` },
      { status: 500 },
    );
  }
  if (!ticketRow) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }

  const { data: insertedText, error: insertError } = await supabase
    .from("ticket_texts")
    .insert({
      organization_id: activeOrgId,
      ticket_id: ticketId,
      author_id: userId,
      type,
      body: content,
    })
    .select(
      "id, organization_id, ticket_id, author_id, type, body, created_at, updated_at",
    )
    .single<TicketTextRow>();

  if (insertError || !insertedText) {
    if (isMissingTableInSchemaCache(insertError, "ticket_texts")) {
      return NextResponse.json(
        { error: missingTableMessage("ticket_texts") },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to create ticket message: ${insertError?.message ?? "Unknown error"}` },
      { status: 500 },
    );
  }

  const { data: author } = await supabase
    .from("users")
    .select("id, name, email, avatar_url")
    .eq("id", userId)
    .maybeSingle<TicketUser>();

  const text: TicketTextWithAttachments = {
    ...insertedText,
    author: author ?? null,
    attachments: [],
  };

  const recipients = getUniqueRecipientIds(
    [ticketRow.created_by, ticketRow.assignee_id],
    userId,
  );
  if (recipients.length > 0) {
    const preview = content.length > 120 ? `${content.slice(0, 117)}...` : content;
    const title = type === "internal_note"
      ? "New internal note on ticket"
      : "New comment on ticket";
    await insertAppNotifications(
      supabase,
      recipients.map((recipientId) => ({
        userId: recipientId,
        organizationId: activeOrgId,
        type: "comment",
        title,
        body: `${ticketRow.title}: ${preview}`,
        entityType: "ticket",
        entityId: ticketId,
      })),
    );
  }

  await runSlaEscalationEngine({
    supabase,
    organizationId: activeOrgId,
    actorUserId: userId,
    ticketId,
  });

  return NextResponse.json({ text }, { status: 201 });
}
