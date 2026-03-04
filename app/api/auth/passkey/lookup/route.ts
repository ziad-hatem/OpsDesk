import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type RequestBody = {
  email?: string;
};

type AuthListUser = {
  id?: string | null;
  email?: string | null;
};

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
    ? normalized
    : null;
}

async function findAuthUserIdByEmail(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  email: string,
): Promise<string | null> {
  const perPage = 200;
  let page = 1;

  while (page <= 50) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      throw new Error(`Failed to look up auth user: ${error.message}`);
    }

    const users = (data?.users ?? []) as AuthListUser[];
    const found = users.find((user) => normalizeEmail(user.email) === email);
    const userId =
      typeof found?.id === "string" ? found.id.trim() : "";
    if (userId) {
      return userId;
    }

    const lastPage =
      typeof data?.lastPage === "number" && data.lastPage > 0
        ? data.lastPage
        : null;

    if (lastPage !== null && page >= lastPage) {
      break;
    }

    if (users.length < perPage) {
      break;
    }

    page += 1;
  }

  return null;
}

async function hasRegisteredPasskey(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("passkeys")
    .select("credential_id")
    .eq("user_id", userId)
    .limit(1);

  if (error) {
    throw new Error(`Failed to check passkeys: ${error.message}`);
  }

  return Array.isArray(data) && data.length > 0;
}

export async function POST(req: Request) {
  let body: RequestBody = {};
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    body = {};
  }

  const email = normalizeEmail(body.email);
  if (!email) {
    return NextResponse.json(
      { error: "A valid email is required." },
      { status: 400 },
    );
  }

  try {
    const supabase = createSupabaseAdminClient();
    const userId = await findAuthUserIdByEmail(supabase, email);
    if (!userId) {
      return NextResponse.json(
        { hasPasskey: false, userId: null },
        { status: 200 },
      );
    }

    const hasPasskey = await hasRegisteredPasskey(supabase, userId);
    return NextResponse.json(
      {
        hasPasskey,
        userId: hasPasskey ? userId : null,
      },
      { status: 200 },
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to check passkey availability";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
