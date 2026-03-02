import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { getTicketRequestContext } from "@/lib/server/ticket-context";
import type { OrderAttachment, OrderUser } from "@/lib/orders/types";
import { isMissingTableInSchemaCache, missingTableMessageWithMigration } from "@/lib/tickets/errors";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type OrderAttachmentRow = Omit<OrderAttachment, "uploader">;

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function sanitizeFilename(filename: string): string {
  return (
    filename
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || "attachment"
  );
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
  const orderId = params.id?.trim();
  if (!orderId) {
    return NextResponse.json({ error: "Order id is required" }, { status: 400 });
  }

  const { count: orderCount, error: orderAccessError } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("id", orderId)
    .eq("organization_id", activeOrgId);

  if (orderAccessError) {
    if (isMissingTableInSchemaCache(orderAccessError, "orders")) {
      return NextResponse.json(
        { error: missingTableMessageWithMigration("orders", "db/orders-schema.sql") },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to verify order access: ${orderAccessError.message}` },
      { status: 500 },
    );
  }
  if (!orderCount) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const filename = normalizeText(searchParams.get("filename"));
  if (!filename) {
    return NextResponse.json({ error: "filename query parameter is required" }, { status: 400 });
  }
  if (!req.body) {
    return NextResponse.json({ error: "File body is required" }, { status: 400 });
  }

  const contentType = normalizeText(req.headers.get("content-type")) ?? "application/octet-stream";
  const rawSizeHeader =
    normalizeText(req.headers.get("x-file-size")) ??
    normalizeText(req.headers.get("content-length"));
  const fileSize = Number(rawSizeHeader ?? "0");
  const safeFileSize = Number.isFinite(fileSize) && fileSize > 0 ? Math.round(fileSize) : 0;

  const safeFilename = sanitizeFilename(filename);
  const storagePath = `orders/${activeOrgId}/${orderId}/${Date.now()}-${safeFilename}`;

  try {
    const blob = await put(storagePath, req.body, {
      access: "private",
      addRandomSuffix: true,
      contentType,
    });

    const { data: insertedAttachment, error: insertError } = await supabase
      .from("order_attachments")
      .insert({
        organization_id: activeOrgId,
        order_id: orderId,
        file_name: filename,
        file_size: safeFileSize,
        mime_type: contentType,
        storage_key: blob.pathname,
        uploaded_by: userId,
      })
      .select(
        "id, organization_id, order_id, file_name, file_size, mime_type, storage_key, uploaded_by, created_at",
      )
      .single<OrderAttachmentRow>();

    if (insertError || !insertedAttachment) {
      if (isMissingTableInSchemaCache(insertError, "order_attachments")) {
        return NextResponse.json(
          { error: missingTableMessageWithMigration("order_attachments", "db/orders-schema.sql") },
          { status: 500 },
        );
      }
      return NextResponse.json(
        {
          error: `File uploaded but metadata persistence failed: ${
            insertError?.message ?? "Unknown error"
          }`,
        },
        { status: 500 },
      );
    }

    const { data: uploader } = await supabase
      .from("users")
      .select("id, name, email, avatar_url")
      .eq("id", userId)
      .maybeSingle<OrderUser>();

    const attachment: OrderAttachment = {
      ...insertedAttachment,
      uploader: uploader ?? null,
    };

    return NextResponse.json(
      {
        attachment,
        blob: {
          url: blob.url,
          pathname: blob.pathname,
          downloadUrl: blob.downloadUrl,
        },
      },
      { status: 201 },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to upload file";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
