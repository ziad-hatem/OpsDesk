import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  ensureCustomerPortalIdentityUser,
  getCustomerPortalContext,
  isMissingCustomerPortalSchema,
} from "@/lib/server/customer-portal-auth";
import { getUniqueRecipientIds, insertAppNotifications } from "@/lib/server/notifications";
import { resolveMentionedOrgUserIds } from "@/lib/server/text-mentions";
import type { TicketTextWithAttachments, TicketUser } from "@/lib/tickets/types";
import { isMissingTableInSchemaCache, missingTableMessageWithMigration } from "@/lib/tickets/errors";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type RequestBody = {
  body?: string;
};

type TicketRow = {
  id: string;
  title: string;
  created_by: string;
  assignee_id: string | null;
};

type TicketTextRow = Omit<TicketTextWithAttachments, "author" | "attachments">;

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function formatAuthorDisplay(author: TicketUser | null): string {
  if (!author) {
    return "Someone";
  }
  return author.name?.trim() || author.email;
}

async function resolveTicketId(context: RouteContext): Promise<string> {
  const params = await context.params;
  return params.id?.trim() ?? "";
}

export async function POST(req: Request, context: RouteContext) {
  const portalContext = await getCustomerPortalContext();
  if (!portalContext) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ticketId = await resolveTicketId(context);
  if (!ticketId) {
    return NextResponse.json({ error: "Ticket id is required" }, { status: 400 });
  }

  let body: RequestBody = {};
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    body = {};
  }

  const content = normalizeText(body.body);
  if (!content) {
    return NextResponse.json({ error: "Reply body is required" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { organizationId, customerId } = portalContext;

  const { data: ticket, error: ticketError } = await supabase
    .from("tickets")
    .select("id, title, created_by, assignee_id")
    .eq("organization_id", organizationId)
    .eq("customer_id", customerId)
    .eq("id", ticketId)
    .maybeSingle<TicketRow>();

  if (ticketError) {
    if (isMissingTableInSchemaCache(ticketError, "tickets")) {
      return NextResponse.json(
        { error: missingTableMessageWithMigration("tickets", "db/tickets-schema.sql") },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to verify portal ticket access: ${ticketError.message}` },
      { status: 500 },
    );
  }

  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }

  let authorId = "";
  try {
    authorId = await ensureCustomerPortalIdentityUser({
      organizationId,
      customerId,
      customerName: portalContext.customer.name,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to resolve portal identity";
    if (isMissingCustomerPortalSchema({ message }, "customer_portal_identities")) {
      return NextResponse.json(
        {
          error: missingTableMessageWithMigration(
            "customer_portal_identities",
            "db/customer-portal-schema.sql",
          ),
        },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const prefixedContent = `[Customer Reply] ${content}`;
  const { data: insertedText, error: insertError } = await supabase
    .from("ticket_texts")
    .insert({
      organization_id: organizationId,
      ticket_id: ticketId,
      author_id: authorId,
      type: "comment",
      body: prefixedContent,
    })
    .select(
      "id, organization_id, ticket_id, author_id, type, body, created_at, updated_at",
    )
    .maybeSingle<TicketTextRow>();

  if (insertError || !insertedText) {
    if (isMissingTableInSchemaCache(insertError, "ticket_texts")) {
      return NextResponse.json(
        { error: missingTableMessageWithMigration("ticket_texts", "db/tickets-schema.sql") },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to post portal ticket reply: ${insertError?.message ?? "Unknown error"}` },
      { status: 500 },
    );
  }

  const { data: author, error: authorError } = await supabase
    .from("users")
    .select("id, name, email, avatar_url")
    .eq("id", authorId)
    .maybeSingle<TicketUser>();

  if (authorError) {
    return NextResponse.json(
      { error: `Reply created but failed to load author: ${authorError.message}` },
      { status: 500 },
    );
  }

  const recipients = getUniqueRecipientIds(
    [ticket.created_by, ticket.assignee_id],
    authorId,
  );
  const preview = content.length > 120 ? `${content.slice(0, 117)}...` : content;
  if (recipients.length > 0) {
    await insertAppNotifications(
      supabase,
      recipients.map((recipientId) => ({
        userId: recipientId,
        organizationId,
        type: "comment",
        title: "Customer replied to ticket",
        body: `${ticket.title}: ${preview}`,
        entityType: "ticket",
        entityId: ticketId,
      })),
    );
  }

  const mentionedUserIds = await resolveMentionedOrgUserIds({
    supabase,
    organizationId,
    textBody: content,
    excludeUserIds: [authorId, ...recipients],
  });
  if (mentionedUserIds.length > 0) {
    const mentionAuthor = formatAuthorDisplay(author ?? null);
    await insertAppNotifications(
      supabase,
      mentionedUserIds.map((recipientId) => ({
        userId: recipientId,
        organizationId,
        type: "comment",
        title: "You were mentioned in a ticket",
        body: `${mentionAuthor} mentioned you in "${ticket.title}": ${preview}`,
        entityType: "ticket",
        entityId: ticketId,
      })),
    );
  }

  const text: TicketTextWithAttachments = {
    ...insertedText,
    author: author ?? null,
    attachments: [],
  };

  return NextResponse.json({ text }, { status: 201 });
}
