"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Loader2, Mail, MoreHorizontal, Plus } from "lucide-react";
import { toast } from "sonner";
import { DataTable } from "../../components/DataTable";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import SettingsNav from "../SettingsNav";
import { useAppSelector } from "@/lib/store/hooks";
import { selectTopbarActiveOrganizationId } from "@/lib/store/slices/topbar-slice";
import type { TeamInvite, TeamMember, TeamPermissions, TeamResponse } from "@/lib/team/types";
import { getRoleLabel } from "@/lib/team/validation";
import type { OrganizationRole } from "@/lib/topbar/types";

const ROLE_ORDER: OrganizationRole[] = ["admin", "manager", "support", "read_only"];

const ROLE_DESCRIPTIONS: Record<OrganizationRole, string> = {
  admin: "Full control: invites, roles, suspension, and removal.",
  manager: "Can invite support/read-only members.",
  support: "Operational access only. No member management.",
  read_only: "View-only workspace access.",
};

function formatDate(isoDate: string | null): string {
  if (!isoDate) {
    return "-";
  }

  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }

  return parsed.toLocaleDateString();
}

function formatDateTime(isoDate: string): string {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }

  return parsed.toLocaleString();
}

function getInitials(name: string | null, email: string): string {
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    if (parts.length === 1 && parts[0]) {
      return parts[0].slice(0, 2).toUpperCase();
    }
  }

  return email.slice(0, 2).toUpperCase();
}

async function readApiError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload.error) {
      return payload.error;
    }
  } catch {
    // Ignore parse failures and fall back to status text.
  }

  return response.statusText || `Request failed with status ${response.status}`;
}

export default function SettingsTeam() {
  const activeOrgId = useAppSelector(selectTopbarActiveOrganizationId);

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [permissions, setPermissions] = useState<TeamPermissions | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<OrganizationRole | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<OrganizationRole>("support");
  const [isInviting, setIsInviting] = useState(false);

  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);
  const [busyInviteId, setBusyInviteId] = useState<string | null>(null);

  const inviteRoleOptions = useMemo(
    () => permissions?.assignableInviteRoles ?? [],
    [permissions?.assignableInviteRoles],
  );
  const memberRoleOptions = useMemo(
    () => permissions?.assignableMemberRoles ?? [],
    [permissions?.assignableMemberRoles],
  );
  const manageableInviteRoles = useMemo(
    () => new Set(permissions?.manageableInviteRoles ?? []),
    [permissions?.manageableInviteRoles],
  );

  const loadTeamData = useCallback(async () => {
    if (!activeOrgId) {
      setMembers([]);
      setInvites([]);
      setPermissions(null);
      setCurrentUserId(null);
      setCurrentUserRole(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(`/api/orgs/${activeOrgId}/team`, {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const payload = (await response.json()) as TeamResponse;
      setMembers(payload.members ?? []);
      setInvites(payload.invites ?? []);
      setPermissions(payload.permissions ?? null);
      setCurrentUserId(payload.currentUserId ?? null);
      setCurrentUserRole(payload.currentUserRole ?? null);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to load team data";
      toast.error(message);
      setMembers([]);
      setInvites([]);
      setPermissions(null);
      setCurrentUserId(null);
      setCurrentUserRole(null);
    } finally {
      setIsLoading(false);
    }
  }, [activeOrgId]);

  useEffect(() => {
    void loadTeamData();
  }, [loadTeamData]);

  useEffect(() => {
    if (!inviteRoleOptions.length) {
      return;
    }

    setInviteRole((prev) =>
      inviteRoleOptions.includes(prev) ? prev : inviteRoleOptions[0],
    );
  }, [inviteRoleOptions]);

  const handleInvite = async () => {
    if (!activeOrgId) {
      return;
    }

    if (!inviteEmail.trim()) {
      toast.error("Email is required");
      return;
    }

    setIsInviting(true);
    const toastId = toast.loading("Sending invite...");
    try {
      const response = await fetch(`/api/orgs/${activeOrgId}/invites`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          role: inviteRole,
        }),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const payload = (await response.json()) as {
        invite?: TeamInvite;
      };

      if (payload.invite) {
        setInvites((prev) => [payload.invite!, ...prev]);
      }

      setInviteEmail("");
      setInviteOpen(false);
      toast.success("Invitation sent", { id: toastId });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to send invitation";
      toast.error(message, { id: toastId });
    } finally {
      setIsInviting(false);
    }
  };

  const handleRoleChange = useCallback(
    async (membershipId: string, nextRole: OrganizationRole) => {
      if (!activeOrgId) {
        return;
      }

      setBusyMemberId(membershipId);
      try {
        const response = await fetch(
          `/api/orgs/${activeOrgId}/members/${membershipId}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ role: nextRole }),
          },
        );

        if (!response.ok) {
          throw new Error(await readApiError(response));
        }

        const payload = (await response.json()) as { member?: TeamMember };
        if (payload.member) {
          setMembers((prev) =>
            prev.map((member) =>
              member.id === membershipId ? payload.member! : member,
            ),
          );
        }

        toast.success("Role updated");
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Failed to update role";
        toast.error(message);
      } finally {
        setBusyMemberId(null);
      }
    },
    [activeOrgId],
  );

  const handleStatusChange = useCallback(
    async (membershipId: string, nextStatus: TeamMember["status"]) => {
      if (!activeOrgId) {
        return;
      }

      setBusyMemberId(membershipId);
      try {
        const response = await fetch(
          `/api/orgs/${activeOrgId}/members/${membershipId}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ status: nextStatus }),
          },
        );

        if (!response.ok) {
          throw new Error(await readApiError(response));
        }

        const payload = (await response.json()) as { member?: TeamMember };
        if (payload.member) {
          setMembers((prev) =>
            prev.map((member) =>
              member.id === membershipId ? payload.member! : member,
            ),
          );
        }

        toast.success(
          nextStatus === "suspended" ? "Member suspended" : "Member reactivated",
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Failed to update status";
        toast.error(message);
      } finally {
        setBusyMemberId(null);
      }
    },
    [activeOrgId],
  );

  const handleRemoveMember = useCallback(
    async (membershipId: string) => {
      if (!activeOrgId) {
        return;
      }

      setBusyMemberId(membershipId);
      try {
        const response = await fetch(
          `/api/orgs/${activeOrgId}/members/${membershipId}`,
          {
            method: "DELETE",
          },
        );

        if (!response.ok) {
          throw new Error(await readApiError(response));
        }

        setMembers((prev) => prev.filter((member) => member.id !== membershipId));
        toast.success("Member removed");
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Failed to remove member";
        toast.error(message);
      } finally {
        setBusyMemberId(null);
      }
    },
    [activeOrgId],
  );

  const handleResendInvite = useCallback(
    async (inviteId: string) => {
      if (!activeOrgId) {
        return;
      }

      setBusyInviteId(inviteId);
      try {
        const response = await fetch(
          `/api/orgs/${activeOrgId}/invites/${inviteId}/resend`,
          {
            method: "POST",
          },
        );

        if (!response.ok) {
          throw new Error(await readApiError(response));
        }

        const payload = (await response.json()) as { invite?: TeamInvite };
        if (payload.invite) {
          setInvites((prev) =>
            prev.map((invite) => (invite.id === inviteId ? payload.invite! : invite)),
          );
        }

        toast.success("Invite resent");
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Failed to resend invite";
        toast.error(message);
      } finally {
        setBusyInviteId(null);
      }
    },
    [activeOrgId],
  );

  const handleRevokeInvite = useCallback(
    async (inviteId: string) => {
      if (!activeOrgId) {
        return;
      }

      setBusyInviteId(inviteId);
      try {
        const response = await fetch(`/api/orgs/${activeOrgId}/invites/${inviteId}`, {
          method: "DELETE",
        });

        if (!response.ok) {
          throw new Error(await readApiError(response));
        }

        setInvites((prev) => prev.filter((invite) => invite.id !== inviteId));
        toast.success("Invite revoked");
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Failed to revoke invite";
        toast.error(message);
      } finally {
        setBusyInviteId(null);
      }
    },
    [activeOrgId],
  );

  const memberColumns = useMemo<ColumnDef<TeamMember>[]>(
    () => [
      {
        id: "member",
        accessorFn: (row) => row.name ?? row.email,
        header: "Member",
        cell: ({ row }) => {
          const member = row.original;
          return (
            <div className="flex items-center gap-3">
              <div className="bg-muted text-foreground flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold">
                {getInitials(member.name, member.email)}
              </div>
              <div>
                <p className="font-medium text-foreground">{member.name ?? "Unnamed user"}</p>
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "email",
        header: "Email",
        cell: ({ row }) => <span className="text-foreground">{row.original.email}</span>,
      },
      {
        accessorKey: "role",
        header: "Role",
        cell: ({ row }) => {
          const member = row.original;
          const canChangeRoles = Boolean(permissions?.canChangeRoles && memberRoleOptions.length);

          if (!canChangeRoles) {
            return (
              <Badge variant="secondary" className="capitalize">
                {getRoleLabel(member.role)}
              </Badge>
            );
          }

          return (
            <Select
              value={member.role}
              onValueChange={(value) =>
                void handleRoleChange(member.id, value as OrganizationRole)
              }
              disabled={busyMemberId === member.id}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_ORDER.filter((role) => memberRoleOptions.includes(role)).map((role) => (
                  <SelectItem key={role} value={role}>
                    {getRoleLabel(role)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        },
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
          const status = row.original.status;
          return (
            <Badge
              className={
                status === "active"
                  ? "bg-green-100 text-green-800 hover:bg-green-100"
                  : "bg-amber-100 text-amber-800 hover:bg-amber-100"
              }
            >
              {status === "active" ? "Active" : "Suspended"}
            </Badge>
          );
        },
      },
      {
        accessorKey: "joined_at",
        header: "Joined",
        cell: ({ row }) => (
          <span className="text-muted-foreground">{formatDate(row.original.joined_at)}</span>
        ),
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => {
          const member = row.original;

          if (!permissions?.canSuspendRemove) {
            return <span className="text-muted-foreground/70">-</span>;
          }

          if (currentUserId && member.user_id === currentUserId) {
            return <span className="text-muted-foreground/70">Self</span>;
          }

          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" disabled={busyMemberId === member.id}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() =>
                    void handleStatusChange(
                      member.id,
                      member.status === "active" ? "suspended" : "active",
                    )
                  }
                >
                  {member.status === "active" ? "Suspend" : "Reactivate"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-red-600"
                  onClick={() => void handleRemoveMember(member.id)}
                >
                  Remove
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [
      busyMemberId,
      currentUserId,
      memberRoleOptions,
      permissions?.canChangeRoles,
      permissions?.canSuspendRemove,
      handleRemoveMember,
      handleRoleChange,
      handleStatusChange,
    ],
  );

  const inviteColumns = useMemo<ColumnDef<TeamInvite>[]>(
    () => [
      {
        accessorKey: "email",
        header: "Email",
        cell: ({ row }) => <span className="text-foreground">{row.original.email}</span>,
      },
      {
        accessorKey: "role",
        header: "Role",
        cell: ({ row }) => (
          <Badge variant="secondary" className="capitalize">
            {getRoleLabel(row.original.role)}
          </Badge>
        ),
      },
      {
        accessorKey: "invited_by_name",
        header: "Invited by",
        cell: ({ row }) => (
          <span className="text-foreground">{row.original.invited_by_name ?? "Unknown user"}</span>
        ),
      },
      {
        accessorKey: "created_at",
        header: "Sent at",
        cell: ({ row }) => (
          <span className="text-muted-foreground">{formatDateTime(row.original.created_at)}</span>
        ),
      },
      {
        accessorKey: "expires_at",
        header: "Expires",
        cell: ({ row }) => (
          <span className="text-muted-foreground">{formatDateTime(row.original.expires_at)}</span>
        ),
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => {
          const invite = row.original;
          const canManageInvite =
            Boolean(permissions?.canInvite) && manageableInviteRoles.has(invite.role);

          if (!canManageInvite) {
            return <span className="text-muted-foreground/70">-</span>;
          }

          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" disabled={busyInviteId === invite.id}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => void handleResendInvite(invite.id)}>
                  Resend
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-red-600"
                  onClick={() => void handleRevokeInvite(invite.id)}
                >
                  Revoke
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [
      busyInviteId,
      manageableInviteRoles,
      permissions?.canInvite,
      handleResendInvite,
      handleRevokeInvite,
    ],
  );

  const roleCards = ROLE_ORDER.map((role) => (
    <Card key={role}>
      <CardContent className="p-4">
        <h3 className="font-medium text-foreground mb-1">{getRoleLabel(role)}</h3>
        <p className="text-sm text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</p>
      </CardContent>
    </Card>
  ));

  if (!activeOrgId) {
    return (
      <div className="p-6 space-y-4">
        <SettingsNav />
        <Card>
          <CardContent className="p-6 text-muted-foreground">
            Select or create an organization to manage team members.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <SettingsNav />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-foreground">Team & Roles</h1>
          <p className="text-muted-foreground mt-1">
            Manage members, pending invites, and role access for this organization.
          </p>
          {currentUserRole && (
            <p className="text-sm text-muted-foreground mt-2">
              Your role: <span className="font-medium">{getRoleLabel(currentUserRole)}</span>
            </p>
          )}
        </div>

        {permissions?.canInvite && (
          <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                Invite Member
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Invite team member</DialogTitle>
                <DialogDescription>
                  Send an invite by email and assign a role.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="invite-email">Email</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    placeholder="teammate@company.com"
                    disabled={isInviting}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invite-role">Role</Label>
                  <Select
                    value={inviteRole}
                    onValueChange={(value) => setInviteRole(value as OrganizationRole)}
                    disabled={isInviting || inviteRoleOptions.length === 0}
                  >
                    <SelectTrigger id="invite-role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLE_ORDER.filter((role) => inviteRoleOptions.includes(role)).map((role) => (
                        <SelectItem key={role} value={role}>
                          {getRoleLabel(role)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setInviteOpen(false)}
                  disabled={isInviting}
                >
                  Cancel
                </Button>
                <Button onClick={() => void handleInvite()} disabled={isInviting}>
                  {isInviting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Mail className="mr-2 h-4 w-4" />
                      Send Invite
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">{roleCards}</div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Members</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="rounded-lg border border-border bg-background p-10 text-center text-muted-foreground">
              <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin" />
              Loading members...
            </div>
          ) : (
            <DataTable
              columns={memberColumns}
              data={members}
              searchKey="member"
              searchPlaceholder="Search members..."
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Pending Invites</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="rounded-lg border border-border bg-background p-10 text-center text-muted-foreground">
              <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin" />
              Loading invites...
            </div>
          ) : (
            <DataTable
              columns={inviteColumns}
              data={invites}
              searchKey="email"
              searchPlaceholder="Search invites..."
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

