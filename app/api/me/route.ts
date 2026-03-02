import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { ACTIVE_ORG_COOKIE } from "@/lib/topbar/constants";
import type { MeResponse, TopbarOrganization } from "@/lib/topbar/types";

type OrganizationRow = {
  id: string;
  name: string;
  logo_url: string | null;
};

type MembershipRow = {
  organization_id: string;
  role: TopbarOrganization["role"];
  organizations: OrganizationRow | OrganizationRow[] | null;
};

type UserRow = {
  id: string;
  name: string | null;
  email: string;
  avatar_url: string | null;
};

type AuthSession = {
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
};

function normalizeSignupOrganizationName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function buildFallbackPayload(
  session: AuthSession,
  signupOrganizationName: string | null,
): MeResponse {
  return {
    user: {
      id: session.user.id,
      name: session.user.name ?? null,
      email: session.user.email ?? "",
      avatar_url: session.user.image ?? null,
    },
    organizations: [],
    activeOrgId: null,
    notifications: {
      unreadCount: 0,
    },
    organizationCreation: {
      signupOrganizationName,
      canCreateFromSignupOrganization: Boolean(signupOrganizationName),
    },
  };
}

function normalizeOrganization(row: MembershipRow): TopbarOrganization | null {
  const org = Array.isArray(row.organizations)
    ? row.organizations[0]
    : row.organizations;

  if (!org) {
    return null;
  }

  return {
    id: org.id,
    name: org.name,
    logo_url: org.logo_url,
    role: row.role,
  };
}

export async function GET() {
  const session = await auth();

  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { data: authUserResult } = await supabase.auth.admin.getUserById(
      session.user.id,
    );
    const signupOrganizationName = normalizeSignupOrganizationName(
      authUserResult.user?.user_metadata?.company,
    );

    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("id, name, email, avatar_url")
      .eq("id", session.user.id)
      .maybeSingle<UserRow>();

    if (userError) {
      return NextResponse.json(
        buildFallbackPayload(session, signupOrganizationName),
        { status: 200 },
      );
    }

    if (!userData) {
      const nameFromSession = session.user.name ?? session.user.email.split("@")[0];
      const { error: insertError } = await supabase.from("users").upsert(
        {
          id: session.user.id,
          email: session.user.email,
          name: nameFromSession,
          avatar_url: session.user.image ?? null,
        },
        { onConflict: "id" },
      );

      if (insertError) {
        return NextResponse.json(
          buildFallbackPayload(session, signupOrganizationName),
          { status: 200 },
        );
      }
    }

    const currentUser = userData ?? {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name ?? null,
      avatar_url: session.user.image ?? null,
    };

    const { data: membershipsData, error: membershipsError } = await supabase
      .from("organization_memberships")
      .select("organization_id, role, organizations(id, name, logo_url)")
      .eq("user_id", currentUser.id)
      .returns<MembershipRow[]>();

    const organizations = membershipsError
      ? []
      : (membershipsData ?? [])
          .map(normalizeOrganization)
          .filter((item): item is TopbarOrganization => item !== null);

    const cookieStore = await cookies();
    const activeOrgCookie = cookieStore.get(ACTIVE_ORG_COOKIE)?.value;

    const isCookieOrgAccessible = activeOrgCookie
      ? organizations.some((org) => org.id === activeOrgCookie)
      : false;
    const activeOrgId = isCookieOrgAccessible
      ? activeOrgCookie ?? null
      : organizations[0]?.id ?? null;

    let unreadCount = 0;
    const notificationQuery = supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", currentUser.id)
      .is("read_at", null);

    if (activeOrgId) {
      notificationQuery.eq("organization_id", activeOrgId);
    }

    const { count, error: notificationsError } = await notificationQuery;
    if (!notificationsError) {
      unreadCount = count ?? 0;
    }

    const payload: MeResponse = {
      user: currentUser,
      organizations,
      activeOrgId,
      notifications: {
        unreadCount,
      },
      organizationCreation: {
        signupOrganizationName,
        canCreateFromSignupOrganization:
          Boolean(signupOrganizationName) && organizations.length === 0,
      },
    };

    const response = NextResponse.json(payload, { status: 200 });

    if (activeOrgId) {
      response.cookies.set(ACTIVE_ORG_COOKIE, activeOrgId, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
    } else {
      response.cookies.delete(ACTIVE_ORG_COOKIE);
    }

    return response;
  } catch {
    return NextResponse.json(buildFallbackPayload(session, null), {
      status: 200,
    });
  }
}
