import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getOrganizationActorContext } from "@/lib/server/organization-context";
import { writeAuditLog } from "@/lib/server/audit-logs";
import {
  buildInviteLink,
  sendTeamInviteEmail,
} from "@/lib/server/team-invite-email";
import { isMissingTeamSchema, missingTeamSchemaMessage } from "@/lib/team/errors";
import type { TeamInvite } from "@/lib/team/types";
import {
  canManageInviteRole,
  getRolePermissions,
} from "@/lib/team/validation";
import type { OrganizationRole } from "@/lib/topbar/types";

type RouteContext = {
  params: Promise<{ orgId: string; inviteId: string }>;
};

type InviteRow = {
  id: string;
  email: string;
  role: OrganizationRole;
  invited_by: string;
  expires_at: string;
  created_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
};

type UserRow = {
  id: string;
  name: string | null;
};

type OrganizationRow = {
  id: string;
  name: string;
};

const RESEND_RATE_LIMIT_MS = 60_000;
const resendRateLimitByInvite = new Map<string, number>();

async function resolveParams(context: RouteContext): Promise<{
  orgId: string;
  inviteId: string;
}> {
  const params = await context.params;
  return {
    orgId: params.orgId?.trim() ?? "",
    inviteId: params.inviteId?.trim() ?? "",
  };
}

export async function POST(_req: Request, context: RouteContext) {
  const { orgId, inviteId } = await resolveParams(context);
  if (!inviteId) {
    return NextResponse.json({ error: "Invite id is required" }, { status: 400 });
  }

  const actorContextResult = await getOrganizationActorContext(orgId);
  if (!actorContextResult.ok) {
    return NextResponse.json(
      { error: actorContextResult.error },
      { status: actorContextResult.status },
    );
  }

  const {
    supabase,
    userId,
    actorMembership: { role: actorRole },
  } = actorContextResult.context;

  const rolePermissions = getRolePermissions(actorRole);
  if (!rolePermissions.canInvite) {
    return NextResponse.json(
      { error: "You do not have permission to resend invites" },
      { status: 403 },
    );
  }

  const { data: inviteData, error: inviteError } = await supabase
    .from("organization_invites")
    .select("id, email, role, invited_by, expires_at, created_at, accepted_at, revoked_at")
    .eq("organization_id", orgId)
    .eq("id", inviteId)
    .maybeSingle<InviteRow>();

  if (inviteError) {
    if (isMissingTeamSchema(inviteError)) {
      return NextResponse.json({ error: missingTeamSchemaMessage() }, { status: 500 });
    }
    return NextResponse.json(
      { error: `Failed to load invite: ${inviteError.message}` },
      { status: 500 },
    );
  }

  if (!inviteData) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }

  if (!canManageInviteRole(actorRole, inviteData.role)) {
    return NextResponse.json(
      { error: "You do not have permission to resend this invite" },
      { status: 403 },
    );
  }

  if (inviteData.accepted_at) {
    return NextResponse.json(
      { error: "Invite has already been accepted" },
      { status: 409 },
    );
  }

  if (inviteData.revoked_at) {
    return NextResponse.json({ error: "Invite has been revoked" }, { status: 409 });
  }

  const rateLimitKey = `${orgId}:${inviteId}`;
  const nowMs = Date.now();
  const lastSentMs = resendRateLimitByInvite.get(rateLimitKey) ?? 0;
  if (nowMs - lastSentMs < RESEND_RATE_LIMIT_MS) {
    return NextResponse.json(
      { error: "Invite resend is rate limited. Please wait before retrying." },
      { status: 429 },
    );
  }
  resendRateLimitByInvite.set(rateLimitKey, nowMs);

  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(nowMs + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: updatedInvite, error: updateInviteError } = await supabase
    .from("organization_invites")
    .update({
      token_hash: tokenHash,
      expires_at: expiresAt,
    })
    .eq("organization_id", orgId)
    .eq("id", inviteId)
    .select("id, email, role, invited_by, expires_at, created_at, accepted_at, revoked_at")
    .single<InviteRow>();

  if (updateInviteError || !updatedInvite) {
    if (isMissingTeamSchema(updateInviteError)) {
      return NextResponse.json({ error: missingTeamSchemaMessage() }, { status: 500 });
    }
    return NextResponse.json(
      {
        error: `Failed to resend invite: ${updateInviteError?.message ?? "Unknown error"}`,
      },
      { status: 500 },
    );
  }

  const { data: inviterData } = await supabase
    .from("users")
    .select("id, name")
    .eq("id", updatedInvite.invited_by)
    .maybeSingle<UserRow>();

  const { data: organizationData, error: organizationError } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("id", orgId)
    .maybeSingle<OrganizationRow>();

  if (organizationError) {
    resendRateLimitByInvite.delete(rateLimitKey);
    return NextResponse.json(
      { error: `Failed to load organization details: ${organizationError.message}` },
      { status: 500 },
    );
  }

  const inviteLink = buildInviteLink(token);
  const organizationName = organizationData?.name ?? "your organization";

  try {
    await sendTeamInviteEmail({
      toEmail: updatedInvite.email,
      organizationName,
      inviterName: inviterData?.name ?? null,
      role: updatedInvite.role,
      inviteLink,
      expiresAt: updatedInvite.expires_at,
    });
  } catch (error: unknown) {
    resendRateLimitByInvite.delete(rateLimitKey);
    const message =
      error instanceof Error ? error.message : "Failed to resend invite email";
    return NextResponse.json(
      { error: `Invite email failed: ${message}` },
      { status: 502 },
    );
  }

  const invite: TeamInvite = {
    id: updatedInvite.id,
    email: updatedInvite.email,
    role: updatedInvite.role,
    invited_by: updatedInvite.invited_by,
    invited_by_name: inviterData?.name ?? null,
    created_at: updatedInvite.created_at,
    expires_at: updatedInvite.expires_at,
  };

  await writeAuditLog({
    supabase,
    organizationId: orgId,
    actorUserId: userId,
    action: "team.invite.resent",
    entityType: "organization_invite",
    entityId: updatedInvite.id,
    details: {
      invitedEmail: updatedInvite.email,
      invitedRole: updatedInvite.role,
      expiresAt: updatedInvite.expires_at,
    },
  });

  return NextResponse.json(
    {
      invite,
      inviteLink,
    },
    { status: 200 },
  );
}
