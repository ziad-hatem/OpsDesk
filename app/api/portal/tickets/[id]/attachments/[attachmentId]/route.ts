import { get } from "@vercel/blob";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getCustomerPortalContext } from "@/lib/server/customer-portal-auth";
import type { TicketAttachment } from "@/lib/tickets/types";
import { isMissingTableInSchemaCache, missingTableMessageWithMigration } from "@/lib/tickets/errors";

type RouteContext = {
  params: Promise<{ id: string; attachmentId: string }>;
};

type TicketAttachmentRow = Omit<TicketAttachment, "uploader">;

function buildContentDisposition(fileName: string) {
  const fallback = fileName.replace(/["\r\n]/g, "_");
  const encoded = encodeURIComponent(fileName);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export async function GET(_req: Request, context: RouteContext) {
  const portalContext = await getCustomerPortalContext();
  if (!portalContext) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = await context.params;
  const ticketId = params.id?.trim();
  const attachmentId = params.attachmentId?.trim();
  if (!ticketId || !attachmentId) {
    return NextResponse.json(
      { error: "Ticket id and attachment id are required" },
      { status: 400 },
    );
  }

  const supabase = createSupabaseAdminClient();
  const { organizationId, customerId } = portalContext;

  const { count: ticketCount, error: ticketAccessError } = await supabase
    .from("tickets")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("customer_id", customerId)
    .eq("id", ticketId);

  if (ticketAccessError) {
    if (isMissingTableInSchemaCache(ticketAccessError, "tickets")) {
      return NextResponse.json(
        { error: missingTableMessageWithMigration("tickets", "db/tickets-schema.sql") },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to verify portal ticket access: ${ticketAccessError.message}` },
      { status: 500 },
    );
  }

  if (!ticketCount) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }

  const { data: attachment, error: attachmentError } = await supabase
    .from("ticket_attachments")
    .select(
      "id, organization_id, ticket_id, ticket_text_id, file_name, file_size, mime_type, storage_key, uploaded_by, created_at",
    )
    .eq("organization_id", organizationId)
    .eq("ticket_id", ticketId)
    .eq("id", attachmentId)
    .maybeSingle<TicketAttachmentRow>();

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
      { error: `Failed to load portal attachment: ${attachmentError.message}` },
      { status: 500 },
    );
  }

  if (!attachment) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }

  try {
    const blobResult = await get(attachment.storage_key, {
      access: "private",
      useCache: false,
    });

    if (!blobResult || blobResult.statusCode !== 200 || !blobResult.stream) {
      return NextResponse.json({ error: "Attachment file not found" }, { status: 404 });
    }

    const headers = new Headers();
    headers.set(
      "content-type",
      blobResult.blob.contentType || attachment.mime_type || "application/octet-stream",
    );
    headers.set("content-disposition", buildContentDisposition(attachment.file_name));
    headers.set("cache-control", "private, no-store");
    if (attachment.file_size > 0) {
      headers.set("content-length", String(attachment.file_size));
    }

    return new Response(blobResult.stream, {
      status: 200,
      headers,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to generate attachment download link";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

