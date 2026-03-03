import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  ensureCustomerPortalIdentityUser,
  getCustomerPortalContext,
  isMissingCustomerPortalSchema,
} from "@/lib/server/customer-portal-auth";
import type { TicketAttachment, TicketUser } from "@/lib/tickets/types";
import { isMissingTableInSchemaCache, missingTableMessageWithMigration } from "@/lib/tickets/errors";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type TicketAttachmentRow = Omit<TicketAttachment, "uploader">;

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function sanitizeFilename(filename: string): string {
  return filename
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "attachment";
}

export async function POST(req: Request, context: RouteContext) {
  const portalContext = await getCustomerPortalContext();
  if (!portalContext) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = await context.params;
  const ticketId = params.id?.trim();
  if (!ticketId) {
    return NextResponse.json({ error: "Ticket id is required" }, { status: 400 });
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

  const { searchParams } = new URL(req.url);
  const filename = normalizeText(searchParams.get("filename"));
  const ticketTextId = normalizeText(searchParams.get("ticketTextId"));
  if (!filename) {
    return NextResponse.json(
      { error: "filename query parameter is required" },
      { status: 400 },
    );
  }
  if (!req.body) {
    return NextResponse.json({ error: "File body is required" }, { status: 400 });
  }

  if (ticketTextId) {
    const { count: textCount, error: textAccessError } = await supabase
      .from("ticket_texts")
      .select("id", { count: "exact", head: true })
      .eq("id", ticketTextId)
      .eq("ticket_id", ticketId)
      .eq("organization_id", organizationId);

    if (textAccessError) {
      if (isMissingTableInSchemaCache(textAccessError, "ticket_texts")) {
        return NextResponse.json(
          { error: missingTableMessageWithMigration("ticket_texts", "db/tickets-schema.sql") },
          { status: 500 },
        );
      }
      return NextResponse.json(
        { error: `Failed to verify ticket message: ${textAccessError.message}` },
        { status: 500 },
      );
    }

    if (!textCount) {
      return NextResponse.json(
        { error: "Provided ticketTextId does not belong to this ticket" },
        { status: 400 },
      );
    }
  }

  let uploaderId = "";
  try {
    uploaderId = await ensureCustomerPortalIdentityUser({
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

  const contentType =
    normalizeText(req.headers.get("content-type")) ?? "application/octet-stream";
  const rawSizeHeader =
    normalizeText(req.headers.get("x-file-size")) ??
    normalizeText(req.headers.get("content-length"));
  const fileSize = Number(rawSizeHeader ?? "0");
  const safeFileSize = Number.isFinite(fileSize) && fileSize > 0 ? Math.round(fileSize) : 0;

  const safeFilename = sanitizeFilename(filename);
  const storagePath = `tickets/${organizationId}/${ticketId}/${Date.now()}-${safeFilename}`;

  try {
    const blob = await put(storagePath, req.body, {
      access: "private",
      addRandomSuffix: true,
      contentType,
    });

    const { data: insertedAttachment, error: insertError } = await supabase
      .from("ticket_attachments")
      .insert({
        organization_id: organizationId,
        ticket_id: ticketId,
        ticket_text_id: ticketTextId,
        file_name: filename,
        file_size: safeFileSize,
        mime_type: contentType,
        storage_key: blob.pathname,
        uploaded_by: uploaderId,
      })
      .select(
        "id, organization_id, ticket_id, ticket_text_id, file_name, file_size, mime_type, storage_key, uploaded_by, created_at",
      )
      .maybeSingle<TicketAttachmentRow>();

    if (insertError || !insertedAttachment) {
      if (isMissingTableInSchemaCache(insertError, "ticket_attachments")) {
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
      .eq("id", uploaderId)
      .maybeSingle<TicketUser>();

    const attachment: TicketAttachment = {
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

