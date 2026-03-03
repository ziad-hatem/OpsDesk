import { getTicketRequestContext } from "@/lib/server/ticket-context";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isMissingTeamSchema, missingTeamSchemaMessage } from "@/lib/team/errors";
import type { MembershipStatus } from "@/lib/team/types";
import type { OrganizationRole } from "@/lib/topbar/types";

type ActorMembershipRow = {
  id: string;
  role: OrganizationRole;
  status: MembershipStatus;
};

export interface OrganizationActorContext {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  userId: string;
  orgId: string;
  actorMembership: ActorMembershipRow;
}

export async function getOrganizationActorContext(
  rawOrgId: string,
): Promise<
  | { ok: true; context: OrganizationActorContext }
  | { ok: false; status: number; error: string }
> {
  const orgId = rawOrgId.trim();
  if (!orgId) {
    return { ok: false, status: 400, error: "Organization id is required" };
  }

  const requestContextResult = await getTicketRequestContext();
  if (!requestContextResult.ok) {
    return {
      ok: false,
      status: requestContextResult.status,
      error: requestContextResult.error,
    };
  }

  const { supabase, userId } = requestContextResult.context;

  const { data: actorMembership, error: actorMembershipError } = await supabase
    .from("organization_memberships")
    .select("id, role, status")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .maybeSingle<ActorMembershipRow>();

  if (actorMembershipError) {
    if (isMissingTeamSchema(actorMembershipError)) {
      return { ok: false, status: 500, error: missingTeamSchemaMessage() };
    }
    return {
      ok: false,
      status: 500,
      error: `Failed to verify organization membership: ${actorMembershipError.message}`,
    };
  }

  if (!actorMembership) {
    return {
      ok: false,
      status: 403,
      error: "You do not have access to this organization",
    };
  }

  if (actorMembership.status !== "active") {
    return {
      ok: false,
      status: 403,
      error: "Your organization membership is suspended",
    };
  }

  return {
    ok: true,
    context: {
      supabase,
      userId,
      orgId,
      actorMembership,
    },
  };
}
