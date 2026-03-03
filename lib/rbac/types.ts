import type { OrganizationRole } from "@/lib/topbar/types";

export type PermissionEffect = "allow" | "deny";
export type ApprovalRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "expired";
export type ApprovalDecision = "approved" | "rejected";

export interface RbacPermissionCatalogItem {
  key: string;
  label: string;
  description: string;
  domain: "team" | "billing" | "incidents" | "automation" | "security" | "analytics";
  risk: "low" | "medium" | "high";
}

export interface CustomRolePermissionItem {
  key: string;
  effect: PermissionEffect;
}

export interface CustomRoleItem {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  member_count: number;
  permissions: CustomRolePermissionItem[];
  created_at: string;
  updated_at: string;
}

export interface RbacMemberAssignmentItem {
  membership_id: string;
  user_id: string;
  name: string | null;
  email: string;
  status: "active" | "suspended";
  system_role: OrganizationRole;
  custom_role_id: string | null;
}

export interface ApprovalPolicyItem {
  id: string;
  permission_key: string;
  enabled: boolean;
  min_approvals: number;
  approver_roles: OrganizationRole[];
  approver_custom_role_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface ApprovalDecisionItem {
  id: string;
  request_id: string;
  decided_by: string;
  decision: ApprovalDecision;
  comment: string | null;
  created_at: string;
  decider: {
    id: string;
    name: string | null;
    email: string | null;
    avatar_url: string | null;
  } | null;
}

export interface ApprovalRequestItem {
  id: string;
  permission_key: string;
  action_label: string;
  entity_type: string | null;
  entity_id: string | null;
  payload: Record<string, unknown> | null;
  status: ApprovalRequestStatus;
  requested_by: string;
  required_approvals: number;
  approved_count: number;
  approver_roles: OrganizationRole[];
  approver_custom_role_ids: string[];
  used_at: string | null;
  created_at: string;
  updated_at: string;
  requester: {
    id: string;
    name: string | null;
    email: string | null;
    avatar_url: string | null;
  } | null;
  decisions: ApprovalDecisionItem[];
}

export interface RbacSettingsResponse {
  activeOrgId: string;
  currentUserId: string;
  actorRole: OrganizationRole;
  actorCustomRoleId: string | null;
  canManageRbac: boolean;
  permissionCatalog: RbacPermissionCatalogItem[];
  customRoles: CustomRoleItem[];
  members: RbacMemberAssignmentItem[];
  approvalPolicies: ApprovalPolicyItem[];
  pendingApprovalsCount: number;
}

export interface RbacSettingsPatchBody {
  upsertRoles?: Array<{
    id?: string;
    name?: string;
    description?: string | null;
    permissions?: CustomRolePermissionItem[];
  }>;
  deleteRoleIds?: string[];
  memberAssignments?: Array<{
    membershipId?: string;
    customRoleId?: string | null;
  }>;
  upsertPolicies?: Array<{
    permissionKey?: string;
    enabled?: boolean;
    minApprovals?: number;
    approverRoles?: OrganizationRole[];
    approverCustomRoleIds?: string[];
  }>;
}

export interface ApprovalQueueResponse {
  activeOrgId: string;
  currentUserId: string;
  scope: "inbox" | "requested";
  statusFilter: ApprovalRequestStatus | "all";
  requests: ApprovalRequestItem[];
}
