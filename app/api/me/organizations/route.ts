import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { ACTIVE_ORG_COOKIE } from "@/lib/topbar/constants";
import { isInviteCreatedAccount } from "@/lib/server/membership-access";
import { normalizeAvatarUrl } from "@/lib/avatar-url";

type CreateOrganizationRequest = {
  type?: "from_scratch" | "from_signup_company";
  name?: string;
};

function normalizeOrganizationName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function toSlug(input: string): string {
  const slug = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || `org-${Date.now()}`;
}

async function generateUniqueSlug(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  baseSlug: string,
): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
    const { count, error } = await supabase
      .from("organizations")
      .select("id", { count: "exact", head: true })
      .eq("slug", candidate);

    if (error) {
      throw new Error("Failed to validate organization slug");
    }

    if (!count) {
      return candidate;
    }
  }

  throw new Error("Could not generate unique organization slug");
}

export async function POST(req: Request) {
  const session = await auth();

  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as CreateOrganizationRequest;
    const type = body.type;

    if (type !== "from_scratch" && type !== "from_signup_company") {
      return NextResponse.json(
        { error: "Invalid organization creation type" },
        { status: 400 },
      );
    }

    const supabase = createSupabaseAdminClient();
    const { data: authUserResult, error: authUserError } =
      await supabase.auth.admin.getUserById(session.user.id);

    if (authUserError || !authUserResult.user?.email) {
      return NextResponse.json(
        { error: "Failed to read current user profile" },
        { status: 500 },
      );
    }

    const authUser = authUserResult.user;
    if (isInviteCreatedAccount(authUser.user_metadata)) {
      return NextResponse.json(
        {
          error:
            "Accounts created from an invitation cannot create organizations.",
        },
        { status: 403 },
      );
    }

    const authEmail = authUser.email;
    if (!authEmail) {
      return NextResponse.json(
        { error: "Current user email is missing" },
        { status: 500 },
      );
    }
    const firstName = normalizeOrganizationName(authUser.user_metadata?.first_name);
    const lastName = normalizeOrganizationName(authUser.user_metadata?.last_name);
    const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
    const fallbackName = authEmail.split("@")[0];

    const { error: ensureUserError } = await supabase.from("users").upsert(
      {
        id: session.user.id,
        email: authEmail,
        name: fullName || fallbackName,
        avatar_url:
          normalizeAvatarUrl(authUser.user_metadata?.avatar_url),
      },
      { onConflict: "id" },
    );

    if (ensureUserError) {
      return NextResponse.json(
        { error: `Failed to sync user profile: ${ensureUserError.message}` },
        { status: 500 },
      );
    }

    const { count: membershipsCount, error: membershipsCountError } = await supabase
      .from("organization_memberships")
      .select("id", { count: "exact", head: true })
      .eq("user_id", session.user.id);

    if (membershipsCountError) {
      return NextResponse.json(
        { error: "Failed to verify membership state" },
        { status: 500 },
      );
    }

    let organizationName: string | null = null;

    if (type === "from_scratch") {
      organizationName = normalizeOrganizationName(body.name);
      if (!organizationName) {
        return NextResponse.json(
          { error: "Organization name is required" },
          { status: 400 },
        );
      }
    } else {
      if ((membershipsCount ?? 0) > 0) {
        return NextResponse.json(
          {
            error:
              "You can only use the signup organization option before creating your first organization",
          },
          { status: 400 },
        );
      }

      organizationName = normalizeOrganizationName(
        authUserResult.user?.user_metadata?.company,
      );

      if (!organizationName) {
        return NextResponse.json(
          { error: "No organization name was provided during registration" },
          { status: 400 },
        );
      }
    }

    const baseSlug = toSlug(organizationName);
    const slug = await generateUniqueSlug(supabase, baseSlug);

    const { data: organization, error: organizationError } = await supabase
      .from("organizations")
      .insert({
        name: organizationName,
        slug,
      })
      .select("id, name, logo_url")
      .single<{
        id: string;
        name: string;
        logo_url: string | null;
      }>();

    if (organizationError || !organization) {
      const details = organizationError?.message ?? "Unknown database error";
      return NextResponse.json(
        { error: `Failed to create organization: ${details}` },
        { status: 500 },
      );
    }

    const { error: membershipError } = await supabase
      .from("organization_memberships")
      .insert({
        user_id: session.user.id,
        organization_id: organization.id,
        role: "admin",
      });

    if (membershipError) {
      const details = membershipError.message;
      return NextResponse.json(
        { error: `Organization created but membership creation failed: ${details}` },
        { status: 500 },
      );
    }

    const response = NextResponse.json(
      {
        organization,
        activeOrgId: organization.id,
      },
      { status: 201 },
    );

    response.cookies.set(ACTIVE_ORG_COOKIE, organization.id, {
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
