"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpDown,
  Bell,
  ChevronDown,
  Clock3,
  CornerDownLeft,
  Loader2,
  Search,
  ShoppingCart,
  Ticket,
  UserRound,
  Users,
} from "lucide-react";
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "./ui/command";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import type {
  GlobalSearchItem,
  GlobalSearchItemType,
  GlobalSearchResponse,
} from "@/lib/search/types";
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

const GLOBAL_SEARCH_MIN_QUERY_LENGTH = 2;
const GLOBAL_SEARCH_RECENTS_LIMIT = 8;
const GLOBAL_SEARCH_RECENTS_KEY = "opsdesk:global-search:recent:v1";

type RecentSearchItem = GlobalSearchItem & {
  selectedAt: string;
};

function getSearchTypeLabel(type: GlobalSearchItemType): string {
  switch (type) {
    case "ticket":
      return "Ticket";
    case "customer":
      return "Customer";
    case "order":
      return "Order";
    case "team_member":
      return "Team";
    default:
      return "Item";
  }
}

function isRecentSearchItem(value: unknown): value is RecentSearchItem {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<RecentSearchItem>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.type === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.subtitle === "string" &&
    typeof candidate.href === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.selectedAt === "string"
  );
}

function SearchResultIcon({ type }: { type: GlobalSearchItemType }) {
  if (type === "ticket") {
    return <Ticket className="h-4 w-4 text-slate-500" />;
  }
  if (type === "customer") {
    return <UserRound className="h-4 w-4 text-slate-500" />;
  }
  if (type === "order") {
    return <ShoppingCart className="h-4 w-4 text-slate-500" />;
  }
  return <Users className="h-4 w-4 text-slate-500" />;
}

function SearchKbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex min-w-5 items-center justify-center rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-600 shadow-sm">
      {children}
    </kbd>
  );
}

function SearchResultCommandItem({
  item,
  shortcutLabel,
  onSelect,
}: {
  item: GlobalSearchItem;
  shortcutLabel: string;
  onSelect: (item: GlobalSearchItem) => void;
}) {
  return (
    <CommandItem
      value={`${item.type}-${item.id}-${item.title}`}
      onSelect={() => onSelect(item)}
      className="gap-3 rounded-md border border-transparent px-2 py-2 data-[selected=true]:border-slate-300 data-[selected=true]:bg-slate-100"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100">
        <SearchResultIcon type={item.type} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-slate-900">{item.title}</p>
        <p className="truncate text-xs text-slate-500">{item.subtitle}</p>
      </div>
      <CommandShortcut>{shortcutLabel}</CommandShortcut>
    </CommandItem>
  );
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
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GlobalSearchItem[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const [recentSearches, setRecentSearches] = useState<RecentSearchItem[]>([]);

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
  const canCreateOrganizations =
    topbarData?.organizationCreation.canCreateFromScratch ?? true;
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
    if (isCreatingOrganization || !canCreateOrganizations) {
      if (!canCreateOrganizations) {
        toast.error("This invited account cannot create organizations.");
      }
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

  const normalizedSearchQuery = searchQuery.trim();
  const canRunSearch = normalizedSearchQuery.length >= GLOBAL_SEARCH_MIN_QUERY_LENGTH;
  const showRecents = normalizedSearchQuery.length === 0;

  const groupedSearchResults = useMemo(() => {
    return {
      tickets: searchResults.filter((item) => item.type === "ticket"),
      customers: searchResults.filter((item) => item.type === "customer"),
      orders: searchResults.filter((item) => item.type === "order"),
      teamMembers: searchResults.filter((item) => item.type === "team_member"),
    };
  }, [searchResults]);
  const totalSearchResults = searchResults.length;

  useEffect(() => {
    try {
      const rawValue = window.localStorage.getItem(GLOBAL_SEARCH_RECENTS_KEY);
      if (!rawValue) {
        return;
      }

      const parsed = JSON.parse(rawValue) as unknown;
      if (!Array.isArray(parsed)) {
        return;
      }

      const normalized = parsed
        .filter(isRecentSearchItem)
        .slice(0, GLOBAL_SEARCH_RECENTS_LIMIT);
      setRecentSearches(normalized);
    } catch {
      // Ignore malformed localStorage payload.
    }
  }, []);

  const persistRecentSearch = useCallback((item: GlobalSearchItem) => {
    setRecentSearches((prev) => {
      const nextItem: RecentSearchItem = {
        ...item,
        selectedAt: new Date().toISOString(),
      };
      const deduped = [
        nextItem,
        ...prev.filter(
          (entry) => !(entry.id === nextItem.id && entry.type === nextItem.type),
        ),
      ].slice(0, GLOBAL_SEARCH_RECENTS_LIMIT);

      try {
        window.localStorage.setItem(GLOBAL_SEARCH_RECENTS_KEY, JSON.stringify(deduped));
      } catch {
        // Ignore storage failures.
      }

      return deduped;
    });
  }, []);

  const handleSearchItemSelect = useCallback(
    (item: GlobalSearchItem) => {
      persistRecentSearch(item);
      setSearchOpen(false);
      router.push(item.href);
    },
    [persistRecentSearch, router],
  );

  useEffect(() => {
    if (!searchOpen || !canRunSearch) {
      setIsSearchLoading(false);
      setSearchError(null);
      if (!canRunSearch) {
        setSearchResults([]);
      }
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsSearchLoading(true);
      setSearchError(null);

      try {
        const params = new URLSearchParams({
          q: normalizedSearchQuery,
          limit: "6",
        });
        const response = await fetch(`/api/search?${params.toString()}`, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          const payload = (await response.json()) as { error?: string };
          throw new Error(payload.error ?? "Failed to search");
        }

        const payload = (await response.json()) as GlobalSearchResponse;
        setSearchResults(payload.items ?? []);
      } catch (error: unknown) {
        if (controller.signal.aborted) {
          return;
        }
        const message = error instanceof Error ? error.message : "Search failed";
        setSearchError(message);
        setSearchResults([]);
      } finally {
        if (!controller.signal.aborted) {
          setIsSearchLoading(false);
        }
      }
    }, 220);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [canRunSearch, normalizedSearchQuery, searchOpen]);

  useEffect(() => {
    if (searchOpen) {
      return;
    }
    setSearchQuery("");
    setSearchResults([]);
    setSearchError(null);
    setIsSearchLoading(false);
  }, [searchOpen]);

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
                disabled={isCreatingOrganization || isTopbarLoading || !canCreateOrganizations}
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
              {!canCreateOrganizations && (
                <DropdownMenuItem disabled>
                  Organization creation is disabled for invited accounts.
                </DropdownMenuItem>
              )}
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
        <DialogContent className="max-w-3xl overflow-hidden p-0">
          <DialogHeader className="space-y-0 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white px-4 py-3">
            <div className="flex items-center justify-between">
              <DialogTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
                <Search className="h-4 w-4 text-slate-600" />
                Global Search
              </DialogTitle>
              <div className="flex items-center gap-1">
                <SearchKbd>Ctrl</SearchKbd>
                <SearchKbd>K</SearchKbd>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <Badge variant="secondary" className="rounded-full bg-slate-200/70 text-slate-700">
                Tickets
              </Badge>
              <Badge variant="secondary" className="rounded-full bg-slate-200/70 text-slate-700">
                Customers
              </Badge>
              <Badge variant="secondary" className="rounded-full bg-slate-200/70 text-slate-700">
                Orders
              </Badge>
              <Badge variant="secondary" className="rounded-full bg-slate-200/70 text-slate-700">
                Team Members
              </Badge>
            </div>
          </DialogHeader>
          <Command shouldFilter={false} className="rounded-none">
            <CommandInput
              value={searchQuery}
              onValueChange={setSearchQuery}
              placeholder="Search tickets, customers, orders, team members..."
              className="text-sm"
            />
            <CommandList className="max-h-[430px] bg-white">
              {canRunSearch && !isSearchLoading && !searchError && totalSearchResults > 0 && (
                <div className="border-b border-slate-100 px-3 py-2 text-xs text-slate-500">
                  Showing {totalSearchResults} results for
                  <span className="px-1 font-medium text-slate-700">
                    {`"${normalizedSearchQuery}"`}
                  </span>
                </div>
              )}

              {showRecents && recentSearches.length > 0 && (
                <>
                  <CommandGroup heading="Recent">
                    {recentSearches.map((item) => (
                      <CommandItem
                        key={`recent-${item.type}-${item.id}`}
                        value={`recent-${item.type}-${item.id}-${item.title}`}
                        onSelect={() => handleSearchItemSelect(item)}
                        className="gap-3 rounded-md border border-transparent px-2 py-2 data-[selected=true]:border-slate-300 data-[selected=true]:bg-slate-100"
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100">
                          <Clock3 className="h-4 w-4 text-slate-500" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-slate-900">{item.title}</p>
                          <p className="truncate text-xs text-slate-500">{item.subtitle}</p>
                        </div>
                        <CommandShortcut>{getSearchTypeLabel(item.type)}</CommandShortcut>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                  {normalizedSearchQuery.length > 0 && <CommandSeparator />}
                </>
              )}

              {!canRunSearch && normalizedSearchQuery.length > 0 && (
                <div className="px-3 py-7 text-center text-sm text-slate-500">
                  Type at least {GLOBAL_SEARCH_MIN_QUERY_LENGTH} characters to search.
                </div>
              )}

              {!canRunSearch && normalizedSearchQuery.length === 0 && recentSearches.length === 0 && (
                <div className="px-3 py-10 text-center text-sm text-slate-500">
                  Search anything in your workspace from one command palette.
                </div>
              )}

              {canRunSearch && isSearchLoading && (
                <div className="space-y-2 px-3 py-4">
                  {[0, 1, 2, 3].map((index) => (
                    <div
                      key={`search-loading-${index}`}
                      className="h-14 animate-pulse rounded-md border border-slate-200 bg-slate-50"
                    />
                  ))}
                </div>
              )}

              {canRunSearch && !isSearchLoading && searchError && (
                <div className="px-3 py-8 text-center text-sm text-red-600">{searchError}</div>
              )}

              {canRunSearch &&
                !isSearchLoading &&
                !searchError &&
                groupedSearchResults.tickets.length > 0 && (
                  <CommandGroup heading="Tickets">
                    {groupedSearchResults.tickets.map((item) => (
                      <SearchResultCommandItem
                        key={`${item.type}-${item.id}`}
                        item={item}
                        shortcutLabel="Ticket"
                        onSelect={handleSearchItemSelect}
                      />
                    ))}
                  </CommandGroup>
                )}

              {canRunSearch &&
                !isSearchLoading &&
                !searchError &&
                groupedSearchResults.customers.length > 0 && (
                  <>
                    <CommandSeparator />
                    <CommandGroup heading="Customers">
                      {groupedSearchResults.customers.map((item) => (
                        <SearchResultCommandItem
                          key={`${item.type}-${item.id}`}
                          item={item}
                          shortcutLabel="Customer"
                          onSelect={handleSearchItemSelect}
                        />
                      ))}
                    </CommandGroup>
                  </>
                )}

              {canRunSearch &&
                !isSearchLoading &&
                !searchError &&
                groupedSearchResults.orders.length > 0 && (
                  <>
                    <CommandSeparator />
                    <CommandGroup heading="Orders">
                      {groupedSearchResults.orders.map((item) => (
                        <SearchResultCommandItem
                          key={`${item.type}-${item.id}`}
                          item={item}
                          shortcutLabel="Order"
                          onSelect={handleSearchItemSelect}
                        />
                      ))}
                    </CommandGroup>
                  </>
                )}

              {canRunSearch &&
                !isSearchLoading &&
                !searchError &&
                groupedSearchResults.teamMembers.length > 0 && (
                  <>
                    <CommandSeparator />
                    <CommandGroup heading="Team Members">
                      {groupedSearchResults.teamMembers.map((item) => (
                        <SearchResultCommandItem
                          key={`${item.type}-${item.id}`}
                          item={item}
                          shortcutLabel="Team"
                          onSelect={handleSearchItemSelect}
                        />
                      ))}
                    </CommandGroup>
                  </>
                )}

              {canRunSearch &&
                !isSearchLoading &&
                !searchError &&
                searchResults.length === 0 && <CommandEmpty>No matching records found.</CommandEmpty>}
            </CommandList>
          </Command>
          <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50/80 px-3 py-2 text-xs text-slate-600">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1">
                <SearchKbd>↑↓</SearchKbd>
                <ArrowUpDown className="h-3 w-3" />
                Navigate
              </span>
              <span className="inline-flex items-center gap-1">
                <SearchKbd>Enter</SearchKbd>
                <CornerDownLeft className="h-3 w-3" />
                Open
              </span>
              <span className="inline-flex items-center gap-1">
                <SearchKbd>Esc</SearchKbd>
                Close
              </span>
            </div>
            <span>
              {canRunSearch ? `${totalSearchResults} result(s)` : "Start typing to search"}
            </span>
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
