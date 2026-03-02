"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, Bell, ChevronDown, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { toast } from "sonner";
import { SidebarTrigger } from "./ui/sidebar";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  createTopbarOrganization,
  fetchTopbarData,
  selectIsCreatingOrganization,
  selectIsSwitchingOrganization,
  selectTopbarData,
  selectTopbarStatus,
  selectTopbarUnreadCount,
  switchTopbarOrganization,
} from "@/lib/store/slices/topbar-slice";

function getInitials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }
  }

  return email.slice(0, 2).toUpperCase();
}

export function Topbar() {
  const dispatch = useAppDispatch();
  const router = useRouter();

  const topbarData = useAppSelector(selectTopbarData);
  const topbarStatus = useAppSelector(selectTopbarStatus);
  const unreadCount = useAppSelector(selectTopbarUnreadCount);
  const isSwitchingOrganization = useAppSelector(selectIsSwitchingOrganization);
  const isCreatingOrganization = useAppSelector(selectIsCreatingOrganization);

  const [searchOpen, setSearchOpen] = useState(false);
  const [createOrganizationOpen, setCreateOrganizationOpen] = useState(false);
  const [scratchOrganizationName, setScratchOrganizationName] = useState("");

  useEffect(() => {
    if (topbarStatus === "idle") {
      void dispatch(fetchTopbarData());
    }
  }, [dispatch, topbarStatus]);

  useEffect(() => {
    const handleNotificationsUpdated = () => {
      void dispatch(fetchTopbarData());
    };

    window.addEventListener("notifications:updated", handleNotificationsUpdated);
    return () => {
      window.removeEventListener(
        "notifications:updated",
        handleNotificationsUpdated,
      );
    };
  }, [dispatch]);

  const activeOrganization = useMemo(() => {
    if (!topbarData) {
      return null;
    }

    return (
      topbarData.organizations.find(
        (organization) => organization.id === topbarData.activeOrgId,
      ) ?? topbarData.organizations[0] ?? null
    );
  }, [topbarData]);

  const userName = topbarData?.user.name ?? null;
  const userEmail = topbarData?.user.email ?? "";
  const userAvatarUrl = topbarData?.user.avatar_url ?? null;
  const userInitials =
    userEmail || userName ? getInitials(userName, userEmail || "user@local") : "OD";
  const isTopbarLoading = topbarStatus === "loading" && !topbarData;

  const handleOrganizationSwitch = async (organizationId: string) => {
    if (isSwitchingOrganization || topbarData?.activeOrgId === organizationId) {
      return;
    }

    try {
      await dispatch(switchTopbarOrganization(organizationId)).unwrap();
      toast.success("Organization switched");
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to switch organization";
      toast.error(message);
    }
  };

  const createOrganization = async (payload: {
    type: "from_scratch" | "from_signup_company";
    name?: string;
  }) => {
    if (isCreatingOrganization) {
      return;
    }

    const loadingMessage =
      payload.type === "from_signup_company"
        ? "Creating organization from your signup company..."
        : "Creating organization...";
    const toastId = toast.loading(loadingMessage);

    try {
      const result = await dispatch(createTopbarOrganization(payload)).unwrap();
      setCreateOrganizationOpen(false);
      setScratchOrganizationName("");
      toast.success(
        result.createdOrganizationName
          ? `Organization "${result.createdOrganizationName}" created`
          : "Organization created successfully",
        { id: toastId },
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to create organization";
      toast.error(message, { id: toastId });
    }
  };

  const handleCreateFromScratch = async () => {
    const normalizedName = scratchOrganizationName.trim();
    if (!normalizedName) {
      return;
    }

    await createOrganization({
      type: "from_scratch",
      name: normalizedName,
    });
  };

  const handleCreateFromSignupOrganization = async () => {
    await createOrganization({
      type: "from_signup_company",
    });
  };

  const handleCreateOrganizationClick = async () => {
    if (isCreatingOrganization) {
      return;
    }

    if (topbarData?.organizationCreation.canCreateFromSignupOrganization) {
      await handleCreateFromSignupOrganization();
      return;
    }

    setCreateOrganizationOpen(true);
  };

  const handleLogout = async () => {
    await signOut({ callbackUrl: "/login" });
  };

  const handleNotificationClick = () => {
    router.push("/notifications");
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <>
      <header className="flex items-center justify-between h-16 px-6 bg-white border-b border-slate-200">
        <div className="flex items-center gap-2">
          <SidebarTrigger />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="gap-2 min-w-[220px] justify-between focus:ring-2 focus:ring-slate-900"
                disabled={isTopbarLoading}
              >
                <span className="font-medium truncate max-w-[150px]">
                  {isTopbarLoading
                    ? "Loading workspace..."
                    : activeOrganization?.name ?? "Select organization"}
                </span>
                {isSwitchingOrganization ? (
                  <Loader2 className="w-4 h-4 text-slate-500 animate-spin" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-500" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[240px]">
              <DropdownMenuLabel>Organizations</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {topbarData?.organizations.length ? (
                topbarData.organizations.map((organization) => {
                  const isCurrent = organization.id === topbarData.activeOrgId;
                  return (
                    <DropdownMenuItem
                      key={organization.id}
                      onClick={() => handleOrganizationSwitch(organization.id)}
                      disabled={isCurrent || isSwitchingOrganization}
                    >
                      <div className="flex flex-col">
                        <span className="font-medium">{organization.name}</span>
                        <span className="text-xs text-slate-500">
                          {isCurrent
                            ? "Current"
                            : `Role: ${organization.role.replace("_", " ")}`}
                        </span>
                      </div>
                    </DropdownMenuItem>
                  );
                })
              ) : (
                <DropdownMenuItem disabled>
                  No organizations assigned
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleCreateOrganizationClick}
                disabled={isCreatingOrganization || isTopbarLoading}
              >
                {isCreatingOrganization ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Creating organization...</span>
                  </div>
                ) : (
                  "Create organization"
                )}
              </DropdownMenuItem>
              {topbarData?.organizationCreation.canCreateFromSignupOrganization &&
                topbarData.organizationCreation.signupOrganizationName && (
                  <DropdownMenuItem disabled>
                    First organization will use:{" "}
                    {topbarData.organizationCreation.signupOrganizationName}
                  </DropdownMenuItem>
                )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            className="gap-2 min-w-[300px] justify-between text-slate-500 focus:ring-2 focus:ring-slate-900"
            onClick={() => setSearchOpen(true)}
          >
            <div className="flex items-center gap-2">
              <Search className="w-4 h-4" />
              <span>Search...</span>
            </div>
            <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 font-mono text-xs text-slate-600">
              Ctrl+K
            </kbd>
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="relative focus:ring-2 focus:ring-slate-900"
            onClick={handleNotificationClick}
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <Badge className="absolute -top-1 -right-1 h-5 min-w-5 flex items-center justify-center p-0 bg-red-600 hover:bg-red-600">
                {unreadCount > 99 ? "99+" : unreadCount}
              </Badge>
            )}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-slate-900 rounded-lg p-1">
                <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-white text-sm font-medium overflow-hidden">
                  {userAvatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={userAvatarUrl}
                      alt="User avatar"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    userInitials
                  )}
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[240px]">
              <DropdownMenuLabel>
                <div className="flex flex-col">
                  <span>{userName || "Signed-in user"}</span>
                  <span className="text-xs font-normal text-slate-500">
                    {userEmail || "No email available"}
                  </span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push("/account/profile")}>
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push("/settings/team")}>
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="text-red-600">
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Global Search</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              placeholder="Search customers, orders, tickets..."
              className="focus:ring-2 focus:ring-slate-900"
              autoFocus
            />
            <div className="text-sm text-slate-500 text-center py-8">
              Start typing to search across customers, orders, and tickets...
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={createOrganizationOpen} onOpenChange={setCreateOrganizationOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create organization</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              placeholder="Organization name"
              value={scratchOrganizationName}
              onChange={(event) => setScratchOrganizationName(event.target.value)}
              disabled={isCreatingOrganization}
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setCreateOrganizationOpen(false)}
                disabled={isCreatingOrganization}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateFromScratch}
                disabled={!scratchOrganizationName.trim() || isCreatingOrganization}
              >
                {isCreatingOrganization ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Creating...
                  </span>
                ) : (
                  "Create"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
