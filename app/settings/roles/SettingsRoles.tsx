"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  Plus,
  Save,
  ShieldAlert,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/components/ui/card";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Switch } from "@/app/components/ui/switch";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/app/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { Badge } from "@/app/components/ui/badge";
import SettingsNav from "@/app/settings/SettingsNav";
import { useAppSelector } from "@/lib/store/hooks";
import { selectTopbarActiveOrganizationId } from "@/lib/store/slices/topbar-slice";
import type {
  ApprovalPolicyItem,
  ApprovalQueueResponse,
  ApprovalRequestItem,
  CustomRoleItem,
  RbacSettingsResponse,
} from "@/lib/rbac/types";
import type { OrganizationRole } from "@/lib/topbar/types";

type EditableRole = {
  id: string;
  persistedId: string | null;
  name: string;
  description: string;
  permissions: Array<{ key: string; effect: "allow" | "deny" }>;
  memberCount: number;
};

type EditablePolicy = ApprovalPolicyItem;
type PermissionDomain = RbacSettingsResponse["permissionCatalog"][number]["domain"];
type DomainFilter = PermissionDomain | "all";

type RoleData = {
  roles: EditableRole[];
  policies: EditablePolicy[];
  members: RbacSettingsResponse["members"];
  canManageRbac: boolean;
  permissionCatalog: RbacSettingsResponse["permissionCatalog"];
};

function normalizeText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function formatDateTime(isoDate: string): string {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }
  return parsed.toLocaleString();
}

function toRoleLabel(value: string): string {
  if (value === "read_only") {
    return "Read-only";
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function toDomainLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function toRiskBadgeVariant(risk: "low" | "medium" | "high"): "secondary" | "outline" | "destructive" {
  if (risk === "high") {
    return "destructive";
  }
  if (risk === "medium") {
    return "secondary";
  }
  return "outline";
}

function toRequestStatusBadgeVariant(
  status: ApprovalRequestItem["status"],
): "default" | "secondary" | "outline" {
  if (status === "approved") {
    return "default";
  }
  if (status === "pending") {
    return "secondary";
  }
  return "outline";
}

async function readApiError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as {
      error?: string;
      approvalRequestId?: string;
      code?: string;
    };
    if (payload.error) {
      if (payload.code === "approval_required" && payload.approvalRequestId) {
        return `${payload.error} (Request #${payload.approvalRequestId.slice(0, 8)})`;
      }
      return payload.error;
    }
  } catch {
    // ignore parsing error
  }
  return response.statusText || `Request failed (${response.status})`;
}

function toEditableRole(role: CustomRoleItem): EditableRole {
  return {
    id: role.id,
    persistedId: role.id,
    name: role.name,
    description: role.description ?? "",
    permissions: [...role.permissions].sort((left, right) => left.key.localeCompare(right.key)),
    memberCount: role.member_count,
  };
}

function mergePolicies(
  existing: ApprovalPolicyItem[],
  catalog: RbacSettingsResponse["permissionCatalog"],
): EditablePolicy[] {
  const existingByKey = new Map(existing.map((policy) => [policy.permission_key, policy]));
  const merged = catalog.map((entry) => {
    const existingPolicy = existingByKey.get(entry.key);
    if (existingPolicy) {
      return { ...existingPolicy };
    }
    return {
      id: `new-${entry.key}`,
      permission_key: entry.key,
      enabled: false,
      min_approvals: 1,
      approver_roles: ["admin"] as OrganizationRole[],
      approver_custom_role_ids: [],
      created_at: "",
      updated_at: "",
    };
  });
  return merged.sort((left, right) => left.permission_key.localeCompare(right.permission_key));
}

export default function SettingsRoles() {
  const activeOrgId = useAppSelector(selectTopbarActiveOrganizationId);
  const [roleData, setRoleData] = useState<RoleData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshingApprovals, setIsRefreshingApprovals] = useState(false);
  const [deletedRoleIds, setDeletedRoleIds] = useState<string[]>([]);
  const [approvalInbox, setApprovalInbox] = useState<ApprovalRequestItem[]>([]);
  const [approvalRequested, setApprovalRequested] = useState<ApprovalRequestItem[]>([]);
  const [busyApprovalRequestId, setBusyApprovalRequestId] = useState<string | null>(null);
  const [policyDomainFilter, setPolicyDomainFilter] = useState<DomainFilter>("all");
  const [policySearch, setPolicySearch] = useState("");

  const loadSettings = useCallback(async () => {
    if (!activeOrgId) {
      setRoleData(null);
      setApprovalInbox([]);
      setApprovalRequested([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(`/api/orgs/${activeOrgId}/rbac`, {
        method: "GET",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      const payload = (await response.json()) as RbacSettingsResponse;
      setDeletedRoleIds([]);
      setRoleData({
        roles: payload.customRoles.map(toEditableRole),
        policies: mergePolicies(payload.approvalPolicies, payload.permissionCatalog),
        members: payload.members,
        canManageRbac: payload.canManageRbac,
        permissionCatalog: payload.permissionCatalog,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to load RBAC settings";
      toast.error(message);
      setRoleData(null);
    } finally {
      setIsLoading(false);
    }
  }, [activeOrgId]);

  const loadApprovalQueues = useCallback(async () => {
    if (!activeOrgId) {
      setApprovalInbox([]);
      setApprovalRequested([]);
      return;
    }
    setIsRefreshingApprovals(true);
    try {
      const [inboxResponse, requestedResponse] = await Promise.all([
        fetch(`/api/orgs/${activeOrgId}/approvals?scope=inbox&status=pending`, {
          method: "GET",
          cache: "no-store",
        }),
        fetch(`/api/orgs/${activeOrgId}/approvals?scope=requested&status=all`, {
          method: "GET",
          cache: "no-store",
        }),
      ]);
      if (!inboxResponse.ok) {
        throw new Error(await readApiError(inboxResponse));
      }
      if (!requestedResponse.ok) {
        throw new Error(await readApiError(requestedResponse));
      }

      const inboxPayload = (await inboxResponse.json()) as ApprovalQueueResponse;
      const requestedPayload = (await requestedResponse.json()) as ApprovalQueueResponse;
      setApprovalInbox(inboxPayload.requests ?? []);
      setApprovalRequested(requestedPayload.requests ?? []);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to load approval queue";
      toast.error(message);
      setApprovalInbox([]);
      setApprovalRequested([]);
    } finally {
      setIsRefreshingApprovals(false);
    }
  }, [activeOrgId]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    void loadApprovalQueues();
  }, [loadApprovalQueues]);

  const roleOptions = useMemo(
    () =>
      roleData?.roles.map((role) => ({
        id: role.id,
        label: role.name,
      })) ?? [],
    [roleData?.roles],
  );

  const permissionCatalog = useMemo(
    () => roleData?.permissionCatalog ?? [],
    [roleData?.permissionCatalog],
  );
  const permissionCatalogByKey = useMemo(
    () => new Map(permissionCatalog.map((permission) => [permission.key, permission])),
    [permissionCatalog],
  );
  const permissionGroups = useMemo(() => {
    const groups = new Map<PermissionDomain, RbacSettingsResponse["permissionCatalog"]>();
    for (const permission of permissionCatalog) {
      const existing = groups.get(permission.domain);
      if (existing) {
        existing.push(permission);
      } else {
        groups.set(permission.domain, [permission]);
      }
    }
    return Array.from(groups.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([domain, permissions]) => ({
        domain,
        permissions: [...permissions].sort((left, right) => left.label.localeCompare(right.label)),
      }));
  }, [permissionCatalog]);
  const policyDomainOptions = useMemo(
    () =>
      Array.from(new Set(permissionCatalog.map((permission) => permission.domain))).sort((left, right) =>
        left.localeCompare(right),
      ),
    [permissionCatalog],
  );
  const filteredPolicies = useMemo(() => {
    if (!roleData) {
      return [];
    }
    const normalizedSearch = policySearch.trim().toLowerCase();
    return roleData.policies.filter((policy) => {
      const catalog = permissionCatalogByKey.get(policy.permission_key);
      const domain = catalog?.domain ?? "security";
      if (policyDomainFilter !== "all" && domain !== policyDomainFilter) {
        return false;
      }
      if (!normalizedSearch) {
        return true;
      }
      const haystack = [
        policy.permission_key,
        catalog?.label ?? "",
        catalog?.description ?? "",
        domain,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [roleData, policySearch, policyDomainFilter, permissionCatalogByKey]);
  const customRoleMembersCount = useMemo(
    () => roleData?.members.filter((member) => Boolean(member.custom_role_id)).length ?? 0,
    [roleData?.members],
  );
  const enabledPoliciesCount = useMemo(
    () => roleData?.policies.filter((policy) => policy.enabled).length ?? 0,
    [roleData?.policies],
  );

  const handleAddRole = () => {
    setRoleData((prev) => {
      if (!prev || !prev.canManageRbac) {
        return prev;
      }
      const newRoleId = `new-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      return {
        ...prev,
        roles: [
          ...prev.roles,
          {
            id: newRoleId,
            persistedId: null,
            name: "New custom role",
            description: "",
            permissions: [],
            memberCount: 0,
          },
        ],
      };
    });
  };

  const handleDeleteRole = (roleId: string) => {
    setRoleData((prev) => {
      if (!prev || !prev.canManageRbac) {
        return prev;
      }
      const target = prev.roles.find((role) => role.id === roleId);
      if (!target) {
        return prev;
      }
      if (target.memberCount > 0) {
        toast.error("Unassign members from this custom role before deleting it.");
        return prev;
      }
      if (target.persistedId) {
        setDeletedRoleIds((current) => Array.from(new Set([...current, target.persistedId!])));
      }
      return {
        ...prev,
        roles: prev.roles.filter((role) => role.id !== roleId),
        members: prev.members.map((member) => ({
          ...member,
          custom_role_id: member.custom_role_id === target.persistedId ? null : member.custom_role_id,
        })),
        policies: prev.policies.map((policy) => ({
          ...policy,
          approver_custom_role_ids: policy.approver_custom_role_ids.filter(
            (customRoleId) => customRoleId !== target.persistedId,
          ),
        })),
      };
    });
  };

  const updateRoleField = (
    roleId: string,
    field: "name" | "description",
    value: string,
  ) => {
    setRoleData((prev) => {
      if (!prev || !prev.canManageRbac) {
        return prev;
      }
      return {
        ...prev,
        roles: prev.roles.map((role) =>
          role.id === roleId
            ? {
                ...role,
                [field]: value,
              }
            : role,
        ),
      };
    });
  };

  const toggleRolePermission = (roleId: string, permissionKey: string) => {
    setRoleData((prev) => {
      if (!prev || !prev.canManageRbac) {
        return prev;
      }
      return {
        ...prev,
        roles: prev.roles.map((role) => {
          if (role.id !== roleId) {
            return role;
          }
          const exists = role.permissions.some((permission) => permission.key === permissionKey);
          if (exists) {
            return {
              ...role,
              permissions: role.permissions.filter((permission) => permission.key !== permissionKey),
            };
          }
          const nextPermissions: EditableRole["permissions"] = [
            ...role.permissions.map((permission) => ({
              key: permission.key,
              effect: permission.effect === "deny" ? ("deny" as const) : ("allow" as const),
            })),
            { key: permissionKey, effect: "allow" as const },
          ].sort((left, right) => left.key.localeCompare(right.key));
          return {
            ...role,
            permissions: nextPermissions,
          };
        }),
      };
    });
  };

  const updateMemberCustomRole = (membershipId: string, nextCustomRoleId: string) => {
    setRoleData((prev) => {
      if (!prev || !prev.canManageRbac) {
        return prev;
      }
      return {
        ...prev,
        members: prev.members.map((member) =>
          member.membership_id === membershipId
            ? {
                ...member,
                custom_role_id: nextCustomRoleId === "none" ? null : nextCustomRoleId,
              }
            : member,
        ),
      };
    });
  };

  const updatePolicyField = <K extends keyof EditablePolicy>(
    permissionKey: string,
    field: K,
    value: EditablePolicy[K],
  ) => {
    setRoleData((prev) => {
      if (!prev || !prev.canManageRbac) {
        return prev;
      }
      return {
        ...prev,
        policies: prev.policies.map((policy) =>
          policy.permission_key === permissionKey
            ? {
                ...policy,
                [field]: value,
              }
            : policy,
        ),
      };
    });
  };

  const togglePolicyApproverRole = (permissionKey: string, role: "admin" | "manager" | "support" | "read_only") => {
    setRoleData((prev) => {
      if (!prev || !prev.canManageRbac) {
        return prev;
      }
      return {
        ...prev,
        policies: prev.policies.map((policy) => {
          if (policy.permission_key !== permissionKey) {
            return policy;
          }
          const exists = policy.approver_roles.includes(role);
          const approverRoles = exists
            ? policy.approver_roles.filter((item) => item !== role)
            : [...policy.approver_roles, role];
          return {
            ...policy,
            approver_roles: approverRoles.length > 0 ? approverRoles : ["admin"],
          };
        }),
      };
    });
  };

  const togglePolicyCustomRole = (permissionKey: string, customRoleId: string) => {
    setRoleData((prev) => {
      if (!prev || !prev.canManageRbac) {
        return prev;
      }
      return {
        ...prev,
        policies: prev.policies.map((policy) => {
          if (policy.permission_key !== permissionKey) {
            return policy;
          }
          const exists = policy.approver_custom_role_ids.includes(customRoleId);
          return {
            ...policy,
            approver_custom_role_ids: exists
              ? policy.approver_custom_role_ids.filter((id) => id !== customRoleId)
              : [...policy.approver_custom_role_ids, customRoleId],
          };
        }),
      };
    });
  };

  const handleSave = async () => {
    if (!roleData || !activeOrgId || !roleData.canManageRbac) {
      return;
    }

    for (const role of roleData.roles) {
      const roleName = normalizeText(role.name);
      if (!roleName) {
        toast.error("Every custom role must have a name.");
        return;
      }
    }

    setIsSaving(true);
    const toastId = toast.loading("Saving RBAC settings...");
    try {
      const response = await fetch(`/api/orgs/${activeOrgId}/rbac`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          upsertRoles: roleData.roles.map((role) => ({
            id: role.persistedId ?? undefined,
            name: role.name,
            description: role.description || null,
            permissions: role.permissions.map((permission) => ({
              key: permission.key,
              effect: permission.effect,
            })),
          })),
          deleteRoleIds: deletedRoleIds,
          memberAssignments: roleData.members.map((member) => ({
            membershipId: member.membership_id,
            customRoleId: member.custom_role_id,
          })),
          upsertPolicies: roleData.policies.map((policy) => ({
            permissionKey: policy.permission_key,
            enabled: policy.enabled,
            minApprovals: policy.min_approvals,
            approverRoles: policy.approver_roles,
            approverCustomRoleIds: policy.approver_custom_role_ids,
          })),
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      const payload = (await response.json()) as RbacSettingsResponse;
      setDeletedRoleIds([]);
      setRoleData({
        roles: payload.customRoles.map(toEditableRole),
        policies: mergePolicies(payload.approvalPolicies, payload.permissionCatalog),
        members: payload.members,
        canManageRbac: payload.canManageRbac,
        permissionCatalog: payload.permissionCatalog,
      });
      toast.success("RBAC settings saved", { id: toastId });
      await loadApprovalQueues();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to save RBAC settings";
      toast.error(message, { id: toastId });
    } finally {
      setIsSaving(false);
    }
  };

  const handleReviewApproval = async (
    requestId: string,
    decision: "approved" | "rejected",
  ) => {
    if (!activeOrgId || busyApprovalRequestId) {
      return;
    }
    setBusyApprovalRequestId(requestId);
    const toastId = toast.loading(
      decision === "approved" ? "Approving request..." : "Rejecting request...",
    );
    try {
      const response = await fetch(`/api/orgs/${activeOrgId}/approvals/${requestId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      toast.success(
        decision === "approved" ? "Request approved" : "Request rejected",
        { id: toastId },
      );
      await loadApprovalQueues();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to submit approval decision";
      toast.error(message, { id: toastId });
    } finally {
      setBusyApprovalRequestId(null);
    }
  };

  if (!activeOrgId) {
    return (
      <div className="space-y-4 p-6">
        <SettingsNav />
        <Card>
          <CardContent className="p-6 text-muted-foreground">
            Select or create an organization to manage RBAC and approvals.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <SettingsNav />
        <Card>
          <CardContent className="flex items-center gap-2 p-6 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading RBAC settings...
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!roleData) {
    return (
      <div className="space-y-4 p-6">
        <SettingsNav />
        <Card>
          <CardContent className="p-6 text-muted-foreground">
            Failed to load RBAC settings for this organization.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <SettingsNav />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-foreground">Custom RBAC & Approvals</h1>
          <p className="mt-1 text-muted-foreground">
            Configure per-action permissions and enforce approval flow for risky operations.
          </p>
        </div>
        {roleData.canManageRbac ? (
          <Button onClick={handleSave} disabled={isSaving} className="gap-2">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save Changes
          </Button>
        ) : null}
      </div>

      {!roleData.canManageRbac ? (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="flex items-center gap-2 p-4 text-amber-800">
            <ShieldAlert className="h-4 w-4" />
            You can review approvals, but RBAC settings are read-only for your account.
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Custom Roles</p>
            <p className="mt-1 text-2xl font-semibold text-foreground">{roleData.roles.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Members with Custom Role</p>
            <p className="mt-1 text-2xl font-semibold text-foreground">{customRoleMembersCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Enabled Approval Policies</p>
            <p className="mt-1 text-2xl font-semibold text-foreground">{enabledPoliciesCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Pending Inbox Requests</p>
            <p className="mt-1 text-2xl font-semibold text-foreground">{approvalInbox.length}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Access Model</CardTitle>
          <CardDescription>
            Manage custom roles, permission bundles, and per-member role assignment.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle>Custom Roles</CardTitle>
              <CardDescription>
                Build permission bundles for page/action/field level access.
              </CardDescription>
            </div>
            {roleData.canManageRbac ? (
              <Button variant="outline" onClick={handleAddRole} className="gap-2">
                <Plus className="h-4 w-4" />
                Add Role
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {roleData.roles.length === 0 ? (
            <p className="text-sm text-muted-foreground">No custom roles yet.</p>
          ) : (
            <Accordion type="multiple" className="w-full">
              {roleData.roles.map((role) => {
                const selectedPermissions = new Set(
                  role.permissions.map((permission) => permission.key),
                );
                return (
                  <AccordionItem key={role.id} value={role.id} className="border-border">
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex flex-wrap items-center gap-2 text-left">
                        <span className="font-medium text-foreground">{role.name}</span>
                        <Badge variant="secondary">{role.memberCount} members</Badge>
                        <Badge variant="outline">{selectedPermissions.size} permissions</Badge>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="grid w-full gap-3 md:grid-cols-2">
                          <div className="space-y-2">
                            <Label>Role Name</Label>
                            <Input
                              value={role.name}
                              disabled={!roleData.canManageRbac}
                              onChange={(event) =>
                                updateRoleField(role.id, "name", event.target.value)
                              }
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Description</Label>
                            <Input
                              value={role.description}
                              disabled={!roleData.canManageRbac}
                              onChange={(event) =>
                                updateRoleField(role.id, "description", event.target.value)
                              }
                            />
                          </div>
                        </div>
                        {roleData.canManageRbac ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteRole(role.id)}
                            title="Delete role"
                          >
                            <Trash2 className="h-4 w-4 text-rose-600" />
                          </Button>
                        ) : null}
                      </div>

                      <div className="space-y-3">
                        {permissionGroups.map((group) => (
                          <div
                            key={`${role.id}-${group.domain}`}
                            className="rounded-md border border-border p-3"
                          >
                            <div className="mb-2 flex items-center gap-2">
                              <Badge variant="outline">{toDomainLabel(group.domain)}</Badge>
                              <span className="text-xs text-muted-foreground">
                                {group.permissions.length} permissions
                              </span>
                            </div>
                            <div className="grid gap-2 md:grid-cols-2">
                              {group.permissions.map((permission) => (
                                <label
                                  key={`${role.id}-${permission.key}`}
                                  className="flex items-start gap-2 rounded-md border border-border p-2 text-sm"
                                >
                                  <Checkbox
                                    checked={selectedPermissions.has(permission.key)}
                                    disabled={!roleData.canManageRbac}
                                    onCheckedChange={() =>
                                      toggleRolePermission(role.id, permission.key)
                                    }
                                  />
                                  <span>
                                    <span className="flex items-center gap-2 font-medium text-foreground">
                                      {permission.label}
                                      <Badge variant={toRiskBadgeVariant(permission.risk)}>
                                        {permission.risk}
                                      </Badge>
                                    </span>
                                    <span className="block text-xs text-muted-foreground">
                                      {permission.description}
                                    </span>
                                  </span>
                                </label>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Member Role Assignment</CardTitle>
          <CardDescription>Attach an optional custom role to each membership.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {roleData.members.map((member) => (
            <div
              key={member.membership_id}
              className="grid grid-cols-1 gap-2 rounded-md border border-border p-3 md:grid-cols-[1.6fr_1fr_1.2fr]"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">{member.name ?? member.email}</p>
                <p className="truncate text-xs text-muted-foreground">{member.email}</p>
              </div>
              <div className="text-sm text-muted-foreground">
                System: <span className="font-medium text-foreground">{toRoleLabel(member.system_role)}</span>
              </div>
              <Select
                value={member.custom_role_id ?? "none"}
                onValueChange={(value) => updateMemberCustomRole(member.membership_id, value)}
                disabled={!roleData.canManageRbac}
              >
                <SelectTrigger>
                  <SelectValue placeholder="No custom role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No custom role</SelectItem>
                  {roleOptions.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Approval Controls</CardTitle>
          <CardDescription>
            Configure risky actions with explicit review gates and approver scopes.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Approval Policies</CardTitle>
          <CardDescription>
            Configure which actions require extra approval and who can approve.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[1fr_220px]">
            <div className="space-y-1">
              <Label className="text-xs">Search action</Label>
              <Input
                value={policySearch}
                onChange={(event) => setPolicySearch(event.target.value)}
                placeholder="Find by label, key, or description"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Domain</Label>
              <Select
                value={policyDomainFilter}
                onValueChange={(value) => setPolicyDomainFilter(value as DomainFilter)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All domains</SelectItem>
                  {policyDomainOptions.map((domain) => (
                    <SelectItem key={domain} value={domain}>
                      {toDomainLabel(domain)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {filteredPolicies.length === 0 ? (
            <p className="text-sm text-muted-foreground">No policies match the selected filters.</p>
          ) : (
            <Accordion type="multiple" className="w-full">
              {filteredPolicies.map((policy) => {
                const catalog = permissionCatalogByKey.get(policy.permission_key);
                return (
                  <AccordionItem
                    key={policy.permission_key}
                    value={policy.permission_key}
                    className="border-border"
                  >
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex flex-wrap items-center gap-2 text-left">
                        <span className="font-medium text-foreground">
                          {catalog?.label ?? policy.permission_key}
                        </span>
                        <Badge variant={policy.enabled ? "default" : "outline"}>
                          {policy.enabled ? "Required" : "Disabled"}
                        </Badge>
                        <Badge variant="outline">
                          {toDomainLabel(catalog?.domain ?? "security")}
                        </Badge>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-3">
                      <p className="text-xs text-muted-foreground">
                        {catalog?.description ?? policy.permission_key}
                      </p>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Require approval</span>
                        <Switch
                          checked={policy.enabled}
                          disabled={!roleData.canManageRbac}
                          onCheckedChange={(value) =>
                            updatePolicyField(policy.permission_key, "enabled", value)
                          }
                        />
                      </div>

                      <div className="grid gap-3 md:grid-cols-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Minimum approvals</Label>
                          <Input
                            type="number"
                            min={1}
                            max={10}
                            value={String(policy.min_approvals)}
                            disabled={!roleData.canManageRbac || !policy.enabled}
                            onChange={(event) =>
                              updatePolicyField(
                                policy.permission_key,
                                "min_approvals",
                                Math.min(10, Math.max(1, Number(event.target.value) || 1)),
                              )
                            }
                          />
                        </div>
                        <div className="space-y-1 md:col-span-2">
                          <Label className="text-xs">Approver system roles</Label>
                          <div className="flex flex-wrap gap-3 rounded-md border border-border p-2">
                            {(["admin", "manager", "support", "read_only"] as const).map((role) => (
                              <label
                                key={`${policy.permission_key}-${role}`}
                                className="flex items-center gap-2 text-sm"
                              >
                                <Checkbox
                                  checked={policy.approver_roles.includes(role)}
                                  disabled={!roleData.canManageRbac || !policy.enabled}
                                  onCheckedChange={() =>
                                    togglePolicyApproverRole(policy.permission_key, role)
                                  }
                                />
                                <span>{toRoleLabel(role)}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>

                      {roleData.roles.length > 0 ? (
                        <div className="space-y-1">
                          <Label className="text-xs">Approver custom roles</Label>
                          <div className="flex flex-wrap gap-3 rounded-md border border-border p-2">
                            {roleData.roles.map((role) => (
                              <label
                                key={`${policy.permission_key}-custom-${role.id}`}
                                className="flex items-center gap-2 text-sm"
                              >
                                <Checkbox
                                  checked={policy.approver_custom_role_ids.includes(role.persistedId ?? "")}
                                  disabled={!roleData.canManageRbac || !policy.enabled || !role.persistedId}
                                  onCheckedChange={() => {
                                    if (!role.persistedId) {
                                      return;
                                    }
                                    togglePolicyCustomRole(policy.permission_key, role.persistedId);
                                  }}
                                />
                                <span>{role.name}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Approval Requests</CardTitle>
          <CardDescription>
            Review team requests and track approval progress in one place.
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle>Approval Inbox</CardTitle>
              <CardDescription>
                Review pending approval requests from team, billing, incidents, and automation.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={isRefreshingApprovals}
              onClick={() => {
                void loadApprovalQueues();
              }}
            >
              {isRefreshingApprovals ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Refreshing
                </span>
              ) : (
                "Refresh"
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {approvalInbox.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending approvals in your inbox.</p>
          ) : (
            approvalInbox.map((request) => (
              <div key={request.id} className="rounded-lg border border-border p-3 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-foreground">{request.action_label}</p>
                    <p className="text-xs text-muted-foreground">
                      Requested by {request.requester?.name ?? request.requester?.email ?? request.requested_by} on{" "}
                      {formatDateTime(request.created_at)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Permission: <code>{request.permission_key}</code>
                    </p>
                  </div>
                  <Badge variant="outline">
                    {request.approved_count}/{request.required_approvals} approvals
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    className="gap-1"
                    disabled={busyApprovalRequestId === request.id}
                    onClick={() => {
                      void handleReviewApproval(request.id, "approved");
                    }}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    disabled={busyApprovalRequestId === request.id}
                    onClick={() => {
                      void handleReviewApproval(request.id, "rejected");
                    }}
                  >
                    <XCircle className="h-4 w-4" />
                    Reject
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>My Requests</CardTitle>
          <CardDescription>Status of approval requests you have triggered.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {approvalRequested.length === 0 ? (
            <p className="text-sm text-muted-foreground">No approval requests submitted yet.</p>
          ) : (
            approvalRequested.map((request) => (
              <div key={request.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-foreground">{request.action_label}</p>
                    <p className="text-xs text-muted-foreground">{formatDateTime(request.created_at)}</p>
                  </div>
                  <Badge variant={toRequestStatusBadgeVariant(request.status)}>
                    {request.status}
                  </Badge>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  );
}

