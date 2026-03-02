import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { ACTIVE_ORG_COOKIE } from "@/lib/topbar/constants";

type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
  organization_id: string;
};

function toIsoNow() {
  return new Date().toISOString();
}

async function resolveActiveOrgId(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
) {
  const cookieStore = await cookies();
  const activeOrgFromCookie = cookieStore.get(ACTIVE_ORG_COOKIE)?.value;

  if (!activeOrgFromCookie) {
    return null;
  }

  const { count, error } = await supabase
    .from("organization_memberships")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("organization_id", activeOrgFromCookie);

  if (error || !count) {
    return null;
  }

  return activeOrgFromCookie;
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { searchParams } = new URL(req.url);
    const filter = searchParams.get("filter") === "unread" ? "unread" : "all";
    const limit = Number(searchParams.get("limit") ?? "50");
    const boundedLimit = Number.isFinite(limit)
      ? Math.min(Math.max(limit, 1), 200)
      : 50;
    const activeOrgId = await resolveActiveOrgId(supabase, session.user.id);

    let query = supabase
      .from("notifications")
      .select(
        "id, type, title, body, entity_type, entity_id, read_at, created_at, organization_id",
      )
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(boundedLimit);

    if (activeOrgId) {
      query = query.eq("organization_id", activeOrgId);
    }
    if (filter === "unread") {
      query = query.is("read_at", null);
    }

    const { data, error } = await query.returns<NotificationRow[]>();
    if (error) {
      return NextResponse.json(
        { error: `Failed to load notifications: ${error.message}` },
        { status: 500 },
      );
    }

    let unreadCountQuery = supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", session.user.id)
      .is("read_at", null);
    if (activeOrgId) {
      unreadCountQuery = unreadCountQuery.eq("organization_id", activeOrgId);
    }
    const { count, error: unreadCountError } = await unreadCountQuery;

    return NextResponse.json(
      {
        notifications: data ?? [],
        unreadCount: unreadCountError ? 0 : count ?? 0,
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json(
      { error: "Failed to load notifications" },
      { status: 500 },
    );
  }
}

export async function PATCH() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const activeOrgId = await resolveActiveOrgId(supabase, session.user.id);

    let updateQuery = supabase
      .from("notifications")
      .update({ read_at: toIsoNow() })
      .eq("user_id", session.user.id)
      .is("read_at", null);

    if (activeOrgId) {
      updateQuery = updateQuery.eq("organization_id", activeOrgId);
    }

    const { error } = await updateQuery;

    if (error) {
      return NextResponse.json(
        { error: `Failed to mark notifications as read: ${error.message}` },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch {
    return NextResponse.json(
      { error: "Failed to mark notifications as read" },
      { status: 500 },
    );
  }
}
