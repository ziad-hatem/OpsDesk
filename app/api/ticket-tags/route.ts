import { NextResponse } from "next/server";
import { getTicketRequestContext } from "@/lib/server/ticket-context";
import type { TicketTag, TicketTagsResponse } from "@/lib/ticket-tags/types";

type TicketTagRow = TicketTag;

type CreateTicketTagBody = {
  name?: string;
  color?: string | null;
};

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, 50);
}

function normalizeColor(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, 20);
}

function isMissingTicketTagsSchema(error: { message?: string } | null | undefined): boolean {
  const message = (error?.message ?? "").toLowerCase();
  return (
    message.includes("ticket_tags") &&
    (message.includes("schema cache") || message.includes("does not exist"))
  );
}

export async function GET() {
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

  const { data, error } = await supabase
    .from("ticket_tags")
    .select("id, organization_id, name, color, created_by, created_at")
    .eq("organization_id", activeOrgId)
    .order("name", { ascending: true })
    .returns<TicketTagRow[]>();

  if (error) {
    if (isMissingTicketTagsSchema(error)) {
      return NextResponse.json(
        {
          error:
            "Ticket tags schema is missing. Run db/ticket-tags-schema.sql in Supabase SQL Editor, then run: NOTIFY pgrst, 'reload schema';",
        },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to load ticket tags: ${error.message}` },
      { status: 500 },
    );
  }

  const payload: TicketTagsResponse = {
    activeOrgId,
    currentUserId: userId,
    tags: data ?? [],
  };
  return NextResponse.json(payload, { status: 200 });
}

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

  let body: CreateTicketTagBody;
  try {
    body = (await req.json()) as CreateTicketTagBody;
  } catch {
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }

  const name = normalizeName(body.name);
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const color = normalizeColor(body.color);
  const { data, error } = await supabase
    .from("ticket_tags")
    .insert({
      organization_id: activeOrgId,
      name,
      color,
      created_by: userId,
    })
    .select("id, organization_id, name, color, created_by, created_at")
    .single<TicketTagRow>();

  if (error || !data) {
    if (isMissingTicketTagsSchema(error)) {
      return NextResponse.json(
        {
          error:
            "Ticket tags schema is missing. Run db/ticket-tags-schema.sql in Supabase SQL Editor, then run: NOTIFY pgrst, 'reload schema';",
        },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to create ticket tag: ${error?.message ?? "Unknown error"}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ tag: data }, { status: 201 });
}
