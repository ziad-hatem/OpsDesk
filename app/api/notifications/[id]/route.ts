import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

function toIsoNow() {
  return new Date().toISOString();
}

export async function PATCH(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const params = await context.params;
    const notificationId = params.id;

    if (!notificationId) {
      return NextResponse.json(
        { error: "Notification id is required" },
        { status: 400 },
      );
    }

    const supabase = createSupabaseAdminClient();
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: toIsoNow() })
      .eq("id", notificationId)
      .eq("user_id", session.user.id)
      .is("read_at", null);

    if (error) {
      return NextResponse.json(
        { error: `Failed to mark notification as read: ${error.message}` },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch {
    return NextResponse.json(
      { error: "Failed to mark notification as read" },
      { status: 500 },
    );
  }
}
