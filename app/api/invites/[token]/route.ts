import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isMissingTeamSchema, missingTeamSchemaMessage } from "@/lib/team/errors";
import { normalizeInviteToken, hashInviteToken } from "@/lib/team/invite-token";
import { getRoleLabel } from "@/lib/team/validation";
import type { OrganizationRole } from "@/lib/topbar/types";

type RouteContext = {
  params: Promise<{ token: string }>;
};

type InviteRow = {
  id: string;
  organization_id: string;
  email: string;
  role: OrganizationRole;
  expires_at: string;
  invited_by: string;
  accepted_at: string | null;
  revoked_at: string | null;
};

type OrganizationRow = {
  id: string;
  name: string;
};

type UserRow = {
  id: string;
  name: string | null;
};

async function resolveToken(context: RouteContext): Promise<string | null> {
  const params = await context.params;
  return normalizeInviteToken(params.token);
}

export async function GET(_req: Request, context: RouteContext) {
  const token = await resolveToken(context);
  if (!token) {
    return NextResponse.json({ error: "Invalid invite token" }, { status: 400 });
  }

  const tokenHash = hashInviteToken(token);
  const now = new Date();
  const supabase = createSupabaseAdminClient();

  const { data: inviteData, error: inviteError } = await supabase
    .from("organization_invites")
    .select(
      "id, organization_id, email, role, expires_at, invited_by, accepted_at, revoked_at",
    )
    .eq("token_hash", tokenHash)
    .maybeSingle<InviteRow>();

  if (inviteError) {
    if (isMissingTeamSchema(inviteError)) {
      return NextResponse.json({ error: missingTeamSchemaMessage() }, { status: 500 });
    }

    return NextResponse.json(
      { error: `Failed to verify invite: ${inviteError.message}` },
      { status: 500 },
    );
  }

  if (!inviteData || inviteData.revoked_at || inviteData.accepted_at) {
    return NextResponse.json({ error: "Invite is not valid" }, { status: 404 });
  }

  if (new Date(inviteData.expires_at).getTime() <= now.getTime()) {
    return NextResponse.json({ error: "Invite has expired" }, { status: 410 });
  }

  const [{ data: organizationData, error: organizationError }, { data: inviterData }] =
    await Promise.all([
      supabase
        .from("organizations")
        .select("id, name")
        .eq("id", inviteData.organization_id)
        .maybeSingle<OrganizationRow>(),
      supabase
        .from("users")
        .select("id, name")
        .eq("id", inviteData.invited_by)
        .maybeSingle<UserRow>(),
    ]);

  if (organizationError || !organizationData) {
    return NextResponse.json(
      {
        error: organizationError
          ? `Failed to load organization: ${organizationError.message}`
          : "Organization not found for this invite",
      },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      invite: {
        email: inviteData.email,
        role: inviteData.role,
        roleLabel: getRoleLabel(inviteData.role),
        expiresAt: inviteData.expires_at,
        organization: organizationData,
        inviterName: inviterData?.name ?? null,
      },
    },
    { status: 200 },
  );
}
