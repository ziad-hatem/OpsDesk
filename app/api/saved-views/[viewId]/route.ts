import { NextResponse } from "next/server";
import { getTicketRequestContext } from "@/lib/server/ticket-context";
import type { SavedView, SavedViewScope } from "@/lib/saved-views/types";
import type { OrganizationRole } from "@/lib/topbar/types";

type RouteContext = {
  params: Promise<{ viewId: string }>;
};

type SavedViewRow = SavedView;

type UpdateSavedViewBody = {
  name?: string;
  filters?: Record<string, unknown>;
  isFavorite?: boolean;
  scope?: string;
};

type MembershipRow = {
  role: OrganizationRole;
  status?: "active" | "suspended" | null;
};

type MembershipFallbackRow = Omit<MembershipRow, "status">;

type SavedViewAccessRow = {
  id: string;
  user_id: string;
  scope?: SavedViewScope;
};

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

function normalizeScope(value: unknown): SavedViewScope {
  return value === "team" ? "team" : "personal";
}

function isMissingSavedViewsTable(error: { message?: string } | null | undefined): boolean {
  const message = (error?.message ?? "").toLowerCase();
  return Boolean(message) && message.includes("saved_views") && message.includes("schema cache");
}

async function resolveActorRole(params: {
  supabase: ReturnType<typeof import("@/lib/supabase-admin").createSupabaseAdminClient>;
  activeOrgId: string;
  userId: string;
}): Promise<OrganizationRole | null> {
  const { supabase, activeOrgId, userId } = params;

  const membershipResultWithStatus = await supabase
    .from("organization_memberships")
    .select("role, status")
    .eq("organization_id", activeOrgId)
    .eq("user_id", userId)
    .maybeSingle<MembershipRow>();

  if (!membershipResultWithStatus.error) {
    const membership = membershipResultWithStatus.data;
    if (!membership || membership.status === "suspended") {
      return null;
    }
    return membership.role;
  }

  const isMissingStatusColumn = membershipResultWithStatus.error.message
    .toLowerCase()
    .includes("organization_memberships.status");
  if (!isMissingStatusColumn) {
    return null;
  }

  const fallbackResult = await supabase
    .from("organization_memberships")
    .select("role")
    .eq("organization_id", activeOrgId)
    .eq("user_id", userId)
    .maybeSingle<MembershipFallbackRow>();

  return fallbackResult.data?.role ?? null;
}

async function resolveViewId(context: RouteContext): Promise<string> {
  const params = await context.params;
  return params.viewId?.trim() ?? "";
}

export async function PATCH(req: Request, context: RouteContext) {
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

  const viewId = await resolveViewId(context);
  if (!viewId) {
    return NextResponse.json({ error: "viewId is required" }, { status: 400 });
  }

  let viewAccessRow: SavedViewAccessRow | null = null;
  const accessResult = await supabase
    .from("saved_views")
    .select("id, user_id, scope")
    .eq("id", viewId)
    .eq("organization_id", activeOrgId)
    .maybeSingle<SavedViewAccessRow>();

  if (accessResult.error) {
    if (isMissingSavedViewsTable(accessResult.error)) {
      return NextResponse.json(
        {
          error:
            "Saved views schema is missing. Run db/saved-views-schema.sql in Supabase SQL Editor, then run: NOTIFY pgrst, 'reload schema';",
        },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to load saved view: ${accessResult.error.message}` },
      { status: 500 },
    );
  }

  viewAccessRow = accessResult.data ?? null;
  if (!viewAccessRow) {
    return NextResponse.json({ error: "Saved view not found" }, { status: 404 });
  }

  const viewScope = viewAccessRow.scope ?? "personal";
  const isOwner = viewAccessRow.user_id === userId;
  if (!isOwner && viewScope !== "team") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!isOwner && viewScope === "team") {
    const actorRole = await resolveActorRole({ supabase, activeOrgId, userId });
    if (!actorRole || (actorRole !== "admin" && actorRole !== "manager")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  let body: UpdateSavedViewBody;
  try {
    body = (await req.json()) as UpdateSavedViewBody;
  } catch {
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};

  if (Object.prototype.hasOwnProperty.call(body, "name")) {
    const name = normalizeName(body.name);
    if (!name) {
      return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
    }
    updates.name = name;
  }

  if (Object.prototype.hasOwnProperty.call(body, "filters")) {
    updates.filters = normalizeFilters(body.filters);
  }

  if (Object.prototype.hasOwnProperty.call(body, "isFavorite")) {
    updates.is_favorite = Boolean(body.isFavorite);
  }

  if (Object.prototype.hasOwnProperty.call(body, "scope")) {
    const nextScope = normalizeScope(body.scope);
    if (nextScope === "team") {
      const actorRole = await resolveActorRole({ supabase, activeOrgId, userId });
      if (!actorRole || (actorRole !== "admin" && actorRole !== "manager")) {
        return NextResponse.json(
          { error: "Only admins or managers can use team scope" },
          { status: 403 },
        );
      }
    }
    updates.scope = nextScope;
  }

  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: "No updates provided" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("saved_views")
    .update(updates)
    .eq("id", viewId)
    .eq("organization_id", activeOrgId)
    .select(
      "id, organization_id, user_id, entity_type, scope, name, filters, is_favorite, created_at, updated_at",
    )
    .maybeSingle<SavedViewRow>();

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
      { error: `Failed to update saved view: ${error.message}` },
      { status: 500 },
    );
  }

  if (!data) {
    return NextResponse.json({ error: "Saved view not found" }, { status: 404 });
  }

  return NextResponse.json(
    {
      view: {
        ...data,
        filters: normalizeFilters(data.filters),
      },
    },
    { status: 200 },
  );
}

export async function DELETE(_req: Request, context: RouteContext) {
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

  const viewId = await resolveViewId(context);
  if (!viewId) {
    return NextResponse.json({ error: "viewId is required" }, { status: 400 });
  }

  const accessResult = await supabase
    .from("saved_views")
    .select("id, user_id, scope")
    .eq("id", viewId)
    .eq("organization_id", activeOrgId)
    .maybeSingle<SavedViewAccessRow>();

  if (accessResult.error) {
    if (isMissingSavedViewsTable(accessResult.error)) {
      return NextResponse.json(
        {
          error:
            "Saved views schema is missing. Run db/saved-views-schema.sql in Supabase SQL Editor, then run: NOTIFY pgrst, 'reload schema';",
        },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to load saved view: ${accessResult.error.message}` },
      { status: 500 },
    );
  }

  const view = accessResult.data;
  if (!view) {
    return NextResponse.json({ error: "Saved view not found" }, { status: 404 });
  }

  const isOwner = view.user_id === userId;
  const viewScope = view.scope ?? "personal";
  if (!isOwner && viewScope !== "team") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!isOwner && viewScope === "team") {
    const actorRole = await resolveActorRole({ supabase, activeOrgId, userId });
    if (!actorRole || (actorRole !== "admin" && actorRole !== "manager")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const { error } = await supabase
    .from("saved_views")
    .delete()
    .eq("id", viewId)
    .eq("organization_id", activeOrgId);

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
      { error: `Failed to delete saved view: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
