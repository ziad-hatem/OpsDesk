import { NextResponse } from "next/server";
import { getTicketRequestContext } from "@/lib/server/ticket-context";
import type { SavedView, SavedViewEntityType, SavedViewsResponse } from "@/lib/saved-views/types";

type SavedViewRow = SavedView;

type CreateSavedViewBody = {
  entityType?: string;
  name?: string;
  filters?: Record<string, unknown>;
  isFavorite?: boolean;
};

function isSavedViewEntityType(value: unknown): value is SavedViewEntityType {
  return value === "tickets" || value === "orders" || value === "customers";
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, 80);
}

function normalizeFilters(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function isMissingSavedViewsTable(error: { message?: string } | null | undefined): boolean {
  const message = (error?.message ?? "").toLowerCase();
  if (!message) {
    return false;
  }

  return message.includes("saved_views") && message.includes("schema cache");
}

export async function GET(req: Request) {
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

  const { searchParams } = new URL(req.url);
  const entityType = searchParams.get("entityType");
  if (!isSavedViewEntityType(entityType)) {
    return NextResponse.json(
      { error: "entityType must be one of tickets, orders, customers" },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("saved_views")
    .select(
      "id, organization_id, user_id, entity_type, name, filters, is_favorite, created_at, updated_at",
    )
    .eq("organization_id", activeOrgId)
    .eq("user_id", userId)
    .eq("entity_type", entityType)
    .order("is_favorite", { ascending: false })
    .order("created_at", { ascending: false })
    .returns<SavedViewRow[]>();

  if (error) {
    if (isMissingSavedViewsTable(error)) {
      return NextResponse.json(
        {
          error:
            "Saved views schema is missing. Run db/saved-views-schema.sql in Supabase SQL Editor, then run: NOTIFY pgrst, 'reload schema';",
        },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to load saved views: ${error.message}` },
      { status: 500 },
    );
  }

  const payload: SavedViewsResponse = {
    activeOrgId,
    currentUserId: userId,
    entityType,
    views: (data ?? []).map((row) => ({
      ...row,
      filters: normalizeFilters(row.filters),
    })),
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

  let body: CreateSavedViewBody;
  try {
    body = (await req.json()) as CreateSavedViewBody;
  } catch {
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }

  if (!isSavedViewEntityType(body.entityType)) {
    return NextResponse.json(
      { error: "entityType must be one of tickets, orders, customers" },
      { status: 400 },
    );
  }

  const name = normalizeName(body.name);
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const filters = normalizeFilters(body.filters);

  const { data, error } = await supabase
    .from("saved_views")
    .insert({
      organization_id: activeOrgId,
      user_id: userId,
      entity_type: body.entityType,
      name,
      filters,
      is_favorite: Boolean(body.isFavorite),
    })
    .select(
      "id, organization_id, user_id, entity_type, name, filters, is_favorite, created_at, updated_at",
    )
    .single<SavedViewRow>();

  if (error || !data) {
    if (isMissingSavedViewsTable(error)) {
      return NextResponse.json(
        {
          error:
            "Saved views schema is missing. Run db/saved-views-schema.sql in Supabase SQL Editor, then run: NOTIFY pgrst, 'reload schema';",
        },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to create saved view: ${error?.message ?? "Unknown error"}` },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      view: {
        ...data,
        filters: normalizeFilters(data.filters),
      },
    },
    { status: 201 },
  );
}
