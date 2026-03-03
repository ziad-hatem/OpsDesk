import type { OrganizationRole } from "@/lib/topbar/types";

export type MembershipStatus = "active" | "suspended";

export interface TeamMember {
  id: string;
  user_id: string;
  name: string | null;
  email: string;
  avatar_url: string | null;
  role: OrganizationRole;
  status: MembershipStatus;
  joined_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeamInvite {
  id: string;
  email: string;
  role: OrganizationRole;
  invited_by: string;
  invited_by_name: string | null;
  created_at: string;
  expires_at: string;
}

export interface TeamPermissions {
  canInvite: boolean;
  canChangeRoles: boolean;
  canSuspendRemove: boolean;
  manageableInviteRoles: OrganizationRole[];
  assignableInviteRoles: OrganizationRole[];
  assignableMemberRoles: OrganizationRole[];
}

export interface TeamResponse {
  activeOrgId: string;
  currentUserId: string;
  currentUserRole: OrganizationRole;
  permissions: TeamPermissions;
  members: TeamMember[];
  invites: TeamInvite[];
}
