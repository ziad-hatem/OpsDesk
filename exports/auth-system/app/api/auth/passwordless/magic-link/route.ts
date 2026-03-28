import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { sendMagicLinkEmail } from "@/lib/server/magic-link-email";

export const runtime = "nodejs";

type RequestBody = {
  email?: string;
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

function getAppBaseUrl(): string {
  const base =
    process.env.NEXTAUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000";
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

const SUCCESS_MESSAGE = "A sign-in link has been sent to your email.";

type AuthListUser = {
  email?: string | null;
};

async function hasRegisteredAuthUser(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  email: string,
): Promise<boolean> {
  const perPage = 200;
  let page = 1;

  while (page <= 50) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      throw new Error(`Failed to verify user registration: ${error.message}`);
    }

    const users = (data?.users ?? []) as AuthListUser[];
    if (users.some((user) => normalizeEmail(user.email) === email)) {
      return true;
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

  return false;
}

export async function POST(req: Request) {
  let body: RequestBody = {};
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    body = {};
  }

  const session = await auth();
  const sessionEmail = normalizeEmail(session?.user?.email ?? null);
  const requestedEmail = normalizeEmail(body.email);
  const email = requestedEmail ?? sessionEmail;

  if (!email) {
    return NextResponse.json(
      { error: "A valid email is required" },
      { status: 400 },
    );
  }

  try {
    const supabase = createSupabaseAdminClient();
    const isRegistered = await hasRegisteredAuthUser(supabase, email);
    if (!isRegistered) {
      return NextResponse.json(
        { error: "No account is registered with this email." },
        { status: 404 },
      );
    }

    const redirectTo = `${getAppBaseUrl()}/auth/magic-link`;

    const { data: linkData, error: linkError } =
      await supabase.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: { redirectTo },
      });

    if (linkError || !linkData?.properties?.action_link) {
      console.error(
        `Magic link generation failed for ${email}: ${linkError?.message ?? "No action_link returned"}`,
      );
      return NextResponse.json(
        { error: "Failed to generate magic link" },
        { status: 502 },
      );
    }

    await sendMagicLinkEmail({
      toEmail: email,
      magicLink: linkData.properties.action_link,
    });

    return NextResponse.json({ message: SUCCESS_MESSAGE }, { status: 200 });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to send magic link";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
