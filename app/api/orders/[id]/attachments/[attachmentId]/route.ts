import { get } from "@vercel/blob";
import { NextResponse } from "next/server";
import { getTicketRequestContext } from "@/lib/server/ticket-context";
import type { OrderAttachment } from "@/lib/orders/types";
import { isMissingTableInSchemaCache, missingTableMessageWithMigration } from "@/lib/tickets/errors";

type RouteContext = {
  params: Promise<{ id: string; attachmentId: string }>;
};

type OrderAttachmentRow = Omit<OrderAttachment, "uploader">;

function buildContentDisposition(fileName: string) {
  const fallback = fileName.replace(/["\r\n]/g, "_");
  const encoded = encodeURIComponent(fileName);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export async function GET(_req: Request, context: RouteContext) {
  const ctxResult = await getTicketRequestContext();
  if (!ctxResult.ok) {
    return NextResponse.json({ error: ctxResult.error }, { status: ctxResult.status });
  }

  const { supabase, activeOrgId } = ctxResult.context;
  if (!activeOrgId) {
    return NextResponse.json(
      { error: "No active organization selected. Create or join an organization first." },
      { status: 400 },
    );
  }

  const params = await context.params;
  const orderId = params.id?.trim();
  const attachmentId = params.attachmentId?.trim();

  if (!orderId || !attachmentId) {
    return NextResponse.json(
      { error: "Order id and attachment id are required" },
      { status: 400 },
    );
  }

  const { data: attachment, error: attachmentError } = await supabase
    .from("order_attachments")
    .select(
      "id, organization_id, order_id, file_name, file_size, mime_type, storage_key, uploaded_by, created_at",
    )
    .eq("id", attachmentId)
    .eq("order_id", orderId)
    .eq("organization_id", activeOrgId)
    .maybeSingle<OrderAttachmentRow>();

  if (attachmentError) {
    if (isMissingTableInSchemaCache(attachmentError, "order_attachments")) {
      return NextResponse.json(
        { error: missingTableMessageWithMigration("order_attachments", "db/orders-schema.sql") },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to load attachment: ${attachmentError.message}` },
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
