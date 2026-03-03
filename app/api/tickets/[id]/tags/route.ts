import { NextResponse } from "next/server";
import { getTicketRequestContext } from "@/lib/server/ticket-context";
import type { TicketTag } from "@/lib/ticket-tags/types";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type TicketTagRow = TicketTag;

type TagAssignmentRow = {
  tag_id: string;
};

type UpdateTicketTagsBody = {
  tagIds?: string[];
};

function isMissingTicketTagsSchema(error: { message?: string } | null | undefined): boolean {
  const message = (error?.message ?? "").toLowerCase();
  return (
    (message.includes("ticket_tags") || message.includes("ticket_tag_assignments")) &&
    (message.includes("schema cache") || message.includes("does not exist"))
  );
}

async function resolveTicketId(context: RouteContext): Promise<string> {
  const params = await context.params;
  return params.id?.trim() ?? "";
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

  const ticketId = await resolveTicketId(context);
  if (!ticketId) {
    return NextResponse.json({ error: "Ticket id is required" }, { status: 400 });
  }

  const { data: assignmentRows, error: assignmentError } = await supabase
    .from("ticket_tag_assignments")
    .select("tag_id")
    .eq("organization_id", activeOrgId)
    .eq("ticket_id", ticketId)
    .returns<TagAssignmentRow[]>();

  if (assignmentError) {
    if (isMissingTicketTagsSchema(assignmentError)) {
      return NextResponse.json(
        {
          error:
            "Ticket tags schema is missing. Run db/ticket-tags-schema.sql in Supabase SQL Editor, then run: NOTIFY pgrst, 'reload schema';",
        },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to load ticket tags: ${assignmentError.message}` },
      { status: 500 },
    );
  }

  const tagIds = (assignmentRows ?? []).map((row) => row.tag_id);
  if (!tagIds.length) {
    return NextResponse.json({ tags: [] }, { status: 200 });
  }

  const { data: tagRows, error: tagsError } = await supabase
    .from("ticket_tags")
    .select("id, organization_id, name, color, created_by, created_at")
    .eq("organization_id", activeOrgId)
    .in("id", tagIds)
    .order("name", { ascending: true })
    .returns<TicketTagRow[]>();

  if (tagsError) {
    return NextResponse.json(
      { error: `Failed to load ticket tags: ${tagsError.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ tags: tagRows ?? [] }, { status: 200 });
}

export async function PUT(req: Request, context: RouteContext) {
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

  const ticketId = await resolveTicketId(context);
  if (!ticketId) {
    return NextResponse.json({ error: "Ticket id is required" }, { status: 400 });
  }

  let body: UpdateTicketTagsBody;
  try {
    body = (await req.json()) as UpdateTicketTagsBody;
  } catch {
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }

  const tagIds = Array.isArray(body.tagIds)
    ? Array.from(new Set(body.tagIds.map((id) => (typeof id === "string" ? id.trim() : "")).filter(Boolean)))
    : [];

  const { data: ticketExists, error: ticketError } = await supabase
    .from("tickets")
    .select("id")
    .eq("organization_id", activeOrgId)
    .eq("id", ticketId)
    .maybeSingle<{ id: string }>();

  if (ticketError || !ticketExists) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }

  if (tagIds.length > 0) {
    const { data: existingTags, error: tagsError } = await supabase
      .from("ticket_tags")
      .select("id")
      .eq("organization_id", activeOrgId)
      .in("id", tagIds)
      .returns<Array<{ id: string }>>();

    if (tagsError) {
      if (isMissingTicketTagsSchema(tagsError)) {
        return NextResponse.json(
          {
            error:
              "Ticket tags schema is missing. Run db/ticket-tags-schema.sql in Supabase SQL Editor, then run: NOTIFY pgrst, 'reload schema';",
          },
          { status: 500 },
        );
      }
      return NextResponse.json(
        { error: `Failed to validate tag ids: ${tagsError.message}` },
        { status: 500 },
      );
    }

    const existingTagIds = new Set((existingTags ?? []).map((row) => row.id));
    const invalidTagId = tagIds.find((id) => !existingTagIds.has(id));
    if (invalidTagId) {
      return NextResponse.json(
        { error: `Tag does not belong to this organization: ${invalidTagId}` },
        { status: 400 },
      );
    }
  }

  const { error: deleteError } = await supabase
    .from("ticket_tag_assignments")
    .delete()
    .eq("organization_id", activeOrgId)
    .eq("ticket_id", ticketId);

  if (deleteError) {
    if (isMissingTicketTagsSchema(deleteError)) {
      return NextResponse.json(
        {
          error:
            "Ticket tags schema is missing. Run db/ticket-tags-schema.sql in Supabase SQL Editor, then run: NOTIFY pgrst, 'reload schema';",
        },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to update ticket tags: ${deleteError.message}` },
      { status: 500 },
    );
  }

  if (tagIds.length > 0) {
    const { error: insertError } = await supabase
      .from("ticket_tag_assignments")
      .insert(
        tagIds.map((tagId) => ({
          organization_id: activeOrgId,
          ticket_id: ticketId,
          tag_id: tagId,
        })),
      );

    if (insertError) {
      return NextResponse.json(
        { error: `Failed to update ticket tags: ${insertError.message}` },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ success: true, tagIds }, { status: 200 });
}
