import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

type AccountCheckBody = {
  accessToken?: unknown;
};

type UserProfileRow = {
  id: string;
};

type MembershipRow = {
  id: string;
};

function normalizeAccessToken(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function isOpsDeskRegisteredUser(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") {
    return false;
  }

  const record = metadata as Record<string, unknown>;
  return (
    record.registered_via_opsdesk === true ||
    record.created_from_invite === true ||
    Object.prototype.hasOwnProperty.call(record, "company")
  );
}

function isMissingTableError(message: string, tableName: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("relation") && normalized.includes(tableName);
}

export async function POST(req: Request) {
  let body: AccountCheckBody;
  try {
    body = (await req.json()) as AccountCheckBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const accessToken = normalizeAccessToken(body.accessToken);
  if (!accessToken) {
    return NextResponse.json({ error: "Access token is required" }, { status: 400 });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { data: userResult, error: userError } = await supabase.auth.getUser(
      accessToken,
    );

    if (userError || !userResult.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = userResult.user.id;
    const metadataKnown = isOpsDeskRegisteredUser(userResult.user.user_metadata);

    const { data: userProfile, error: profileError } = await supabase
      .from("users")
      .select("id")
      .eq("id", userId)
      .maybeSingle<UserProfileRow>();

    if (profileError) {
      if (isMissingTableError(profileError.message, "users")) {
        return NextResponse.json({ exists: metadataKnown }, { status: 200 });
      }

      return NextResponse.json(
        { error: `Failed to validate account profile: ${profileError.message}` },
        { status: 500 },
      );
    }

    const hasProfile = Boolean(userProfile?.id);

    const { data: membershipRows, error: membershipError } = await supabase
      .from("organization_memberships")
      .select("id")
      .eq("user_id", userId)
      .limit(1)
      .returns<MembershipRow[]>();

    if (membershipError) {
      if (isMissingTableError(membershipError.message, "organization_memberships")) {
        return NextResponse.json(
          { exists: metadataKnown || hasProfile },
          { status: 200 },
        );
      }

      return NextResponse.json(
        { error: `Failed to validate account membership: ${membershipError.message}` },
        { status: 500 },
      );
    }

    const hasMembership = (membershipRows ?? []).length > 0;

    return NextResponse.json(
      {
        exists: metadataKnown || hasProfile || hasMembership,
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json(
      { error: "Failed to validate Google account" },
      { status: 500 },
    );
  }
}

