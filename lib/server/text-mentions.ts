import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  buildMentionHandlesForIdentity,
  extractMentionHandlesFromText,
} from "@/lib/tickets/mention-handles";

type MentionableUser = {
  id: string;
  name: string | null;
  email: string;
};

type MembershipUserRow = {
  user_id: string;
  status?: "active" | "suspended" | null;
  users:
    | {
        id: string;
        name: string | null;
        email: string;
      }
    | Array<{
        id: string;
        name: string | null;
        email: string;
      }>
    | null;
};

type MembershipUserFallbackRow = Omit<MembershipUserRow, "status">;

function normalizeMembershipUser(
  row: MembershipUserRow | MembershipUserFallbackRow,
): MentionableUser | null {
  const user = Array.isArray(row.users) ? row.users[0] : row.users;
  if (!user?.id || !user.email) {
    return null;
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
  };
}

function hasMissingMembershipStatusColumn(errorMessage: string): boolean {
  return errorMessage.toLowerCase().includes("organization_memberships.status");
}


async function loadMentionableOrgUsers(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  organizationId: string,
): Promise<MentionableUser[]> {
  const withStatus = await supabase
    .from("organization_memberships")
    .select("user_id, status, users(id, name, email)")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .returns<MembershipUserRow[]>();

  if (!withStatus.error) {
    return (withStatus.data ?? [])
      .map((row) => normalizeMembershipUser(row))
      .filter((row): row is MentionableUser => row !== null);
  }

  if (!hasMissingMembershipStatusColumn(withStatus.error.message)) {
    throw new Error(`Failed to load organization members for mentions: ${withStatus.error.message}`);
  }

  const fallback = await supabase
    .from("organization_memberships")
    .select("user_id, users(id, name, email)")
    .eq("organization_id", organizationId)
    .returns<MembershipUserFallbackRow[]>();

  if (fallback.error) {
    throw new Error(`Failed to load organization members for mentions: ${fallback.error.message}`);
  }

  return (fallback.data ?? [])
    .map((row) => normalizeMembershipUser(row))
    .filter((row): row is MentionableUser => row !== null);
}

export async function resolveMentionedOrgUserIds(params: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  organizationId: string;
  textBody: string;
  excludeUserIds?: string[];
}): Promise<string[]> {
  const { supabase, organizationId, textBody, excludeUserIds = [] } = params;
  const handles = extractMentionHandlesFromText(textBody);
  if (handles.length === 0) {
    return [];
  }

  const users = await loadMentionableOrgUsers(supabase, organizationId);
  if (users.length === 0) {
    return [];
  }

  const handleToUserIds = new Map<string, Set<string>>();
  for (const user of users) {
    const userHandles = buildMentionHandlesForIdentity(user);
    for (const handle of userHandles) {
      const existing = handleToUserIds.get(handle);
      if (existing) {
        existing.add(user.id);
      } else {
        handleToUserIds.set(handle, new Set([user.id]));
      }
    }
  }

  const excluded = new Set(excludeUserIds);
  const resolvedIds = new Set<string>();
  for (const handle of handles) {
    const owners = handleToUserIds.get(handle);
    if (!owners || owners.size !== 1) {
      continue;
    }

    const [ownerId] = Array.from(owners);
    if (!ownerId || excluded.has(ownerId)) {
      continue;
    }

    resolvedIds.add(ownerId);
  }

  return Array.from(resolvedIds);
}
