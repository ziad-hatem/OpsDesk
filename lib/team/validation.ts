import type { OrganizationRole } from "@/lib/topbar/types";
import type { MembershipStatus, TeamPermissions } from "@/lib/team/types";

export const ORGANIZATION_ROLES: OrganizationRole[] = [
  "admin",
  "manager",
  "support",
  "read_only",
];

export const MEMBERSHIP_STATUSES: MembershipStatus[] = ["active", "suspended"];

export function isOrganizationRole(value: unknown): value is OrganizationRole {
  return (
    typeof value === "string" &&
    ORGANIZATION_ROLES.includes(value as OrganizationRole)
  );
}

export function isMembershipStatus(value: unknown): value is MembershipStatus {
  return (
    typeof value === "string" &&
    MEMBERSHIP_STATUSES.includes(value as MembershipStatus)
  );
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const isLikelyEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
  return isLikelyEmail ? normalized : null;
}

export function getRoleLabel(role: OrganizationRole): string {
  if (role === "read_only") {
    return "Read-only";
  }

  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function getRolePermissions(role: OrganizationRole): TeamPermissions {
  if (role === "admin") {
    return {
      canInvite: true,
      canChangeRoles: true,
      canSuspendRemove: true,
      manageableInviteRoles: [...ORGANIZATION_ROLES],
      assignableInviteRoles: [...ORGANIZATION_ROLES],
      assignableMemberRoles: [...ORGANIZATION_ROLES],
    };
  }

  if (role === "manager") {
    const limitedRoles: OrganizationRole[] = ["support", "read_only"];
    return {
      canInvite: true,
      canChangeRoles: false,
      canSuspendRemove: false,
      manageableInviteRoles: [...limitedRoles],
      assignableInviteRoles: [...limitedRoles],
      assignableMemberRoles: [],
    };
  }

  return {
    canInvite: false,
    canChangeRoles: false,
    canSuspendRemove: false,
    manageableInviteRoles: [],
    assignableInviteRoles: [],
    assignableMemberRoles: [],
  };
}

export function canManageInviteRole(
  actorRole: OrganizationRole,
  targetRole: OrganizationRole,
): boolean {
  return getRolePermissions(actorRole).manageableInviteRoles.includes(targetRole);
}
