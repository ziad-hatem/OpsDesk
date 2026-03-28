import { createSupabaseAdminClient } from "@/lib/supabase-admin";

type MembershipRow = {
  status?: "active" | "suspended" | null;
};

export type MembershipAccessSummary = {
  totalMemberships: number;
  activeMemberships: number;
  suspendedMemberships: number;
  hasOnlySuspendedMemberships: boolean;
};

export function emptyMembershipAccessSummary(): MembershipAccessSummary {
  return {
    totalMemberships: 0,
    activeMemberships: 0,
    suspendedMemberships: 0,
    hasOnlySuspendedMemberships: false,
  };
}

function isMissingStatusColumnError(message: string): boolean {
  return message.toLowerCase().includes("organization_memberships.status");
}

function buildMembershipAccessSummary(rows: MembershipRow[]): MembershipAccessSummary {
  const totalMemberships = rows.length;
  const suspendedMemberships = rows.filter(
    (row) => row.status === "suspended",
  ).length;
  const activeMemberships = totalMemberships - suspendedMemberships;

  return {
    totalMemberships,
    activeMemberships,
    suspendedMemberships,
    hasOnlySuspendedMemberships:
      totalMemberships > 0 && activeMemberships === 0,
  };
}

function buildLegacySummary(totalMemberships: number): MembershipAccessSummary {
  return {
    totalMemberships,
    activeMemberships: totalMemberships,
    suspendedMemberships: 0,
    hasOnlySuspendedMemberships: false,
  };
}

export async function loadMembershipAccessSummary(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
): Promise<{ summary: MembershipAccessSummary; error: string | null }> {
  const membershipResultWithStatus = await supabase
    .from("organization_memberships")
    .select("status")
    .eq("user_id", userId)
    .returns<MembershipRow[]>();

  if (membershipResultWithStatus.error) {
    if (
      !isMissingStatusColumnError(
        membershipResultWithStatus.error.message,
      )
    ) {
      return {
        summary: emptyMembershipAccessSummary(),
        error: membershipResultWithStatus.error.message,
      };
    }

    const fallbackResult = await supabase
      .from("organization_memberships")
      .select("id")
      .eq("user_id", userId)
      .returns<Array<{ id: string }>>();

    if (fallbackResult.error) {
      return {
        summary: emptyMembershipAccessSummary(),
        error: fallbackResult.error.message,
      };
    }

    return {
      summary: buildLegacySummary((fallbackResult.data ?? []).length),
      error: null,
    };
  }

  return {
    summary: buildMembershipAccessSummary(membershipResultWithStatus.data ?? []),
    error: null,
  };
}

export function isInviteCreatedAccount(userMetadata: unknown): boolean {
  if (!userMetadata || typeof userMetadata !== "object") {
    return false;
  }

  const metadata = userMetadata as Record<string, unknown>;
  return metadata.created_from_invite === true;
}
