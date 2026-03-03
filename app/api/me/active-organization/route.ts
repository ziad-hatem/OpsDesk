import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { ACTIVE_ORG_COOKIE } from "@/lib/topbar/constants";

export async function POST(req: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as { organizationId?: string };
    const organizationId = body.organizationId?.trim();

    if (!organizationId) {
      return NextResponse.json(
        { error: "organizationId is required" },
        { status: 400 },
      );
    }

    const supabase = createSupabaseAdminClient();
    const membershipResultWithStatus = await supabase
      .from("organization_memberships")
      .select("id", { count: "exact", head: true })
      .eq("user_id", session.user.id)
      .eq("organization_id", organizationId)
      .eq("status", "active");

    const shouldFallbackToLegacyMembershipQuery =
      Boolean(membershipResultWithStatus.error) &&
      membershipResultWithStatus.error?.message
        .toLowerCase()
        .includes("organization_memberships.status");

    const membershipResult = shouldFallbackToLegacyMembershipQuery
      ? await supabase
          .from("organization_memberships")
          .select("id", { count: "exact", head: true })
          .eq("user_id", session.user.id)
          .eq("organization_id", organizationId)
      : membershipResultWithStatus;

    if (membershipResult.error) {
      return NextResponse.json(
        { error: "Failed to verify organization access" },
        { status: 500 },
      );
    }

    if (!membershipResult.count) {
      return NextResponse.json(
        { error: "You do not have access to this organization" },
        { status: 403 },
      );
    }

    const response = NextResponse.json(
      { activeOrgId: organizationId },
      { status: 200 },
    );

    response.cookies.set(ACTIVE_ORG_COOKIE, organizationId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    return response;
  } catch {
    return NextResponse.json(
      { error: "Invalid request payload" },
      { status: 400 },
    );
  }
}
