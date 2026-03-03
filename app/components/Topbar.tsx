"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import Image from "next/image";
import {
  BarChart3,
  ArrowUpDown,
  Bell,
  ChevronDown,
  Clock3,
  CornerDownLeft,
  Loader2,
  Search,
  ShoppingCart,
  Ticket,
  TriangleAlert,
  UserRound,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { toast } from "sonner";
import { SidebarTrigger } from "./ui/sidebar";
import { Button } from "./ui/button";
import { ThemeToggle } from "./ThemeToggle";
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

type QuickAction = {
  id: string;
  label: string;
  subtitle: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  shortcut: string;
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

function getRelativeSearchTime(value: string): string {
  try {
    return formatDistanceToNow(new Date(value), { addSuffix: true });
  } catch {
    return "recently";
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
    return <Ticket className="h-4 w-4 text-muted-foreground" />;
  }
  if (type === "customer") {
    return <UserRound className="h-4 w-4 text-muted-foreground" />;
  }
  if (type === "order") {
    return <ShoppingCart className="h-4 w-4 text-muted-foreground" />;
  }
  return <Users className="h-4 w-4 text-muted-foreground" />;
}

function SearchKbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex min-w-5 items-center justify-center rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground shadow-sm">
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
      className="micro-interactive gap-3 rounded-md border border-transparent px-2 py-2 data-[selected=true]:border-border data-[selected=true]:bg-muted"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted">
        <SearchResultIcon type={item.type} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-medium text-foreground">{item.title}</p>
          <Badge variant="outline" className="h-5 rounded-full text-[10px]">
            {shortcutLabel}
          </Badge>
        </div>
        <p className="truncate text-xs text-muted-foreground">{item.subtitle}</p>
      </div>
      <CommandShortcut>{getRelativeSearchTime(item.createdAt)}</CommandShortcut>
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
  const hasUserIdentity = Boolean(userEmail || userName);
  const userInitials = hasUserIdentity
    ? getInitials(userName, userEmail || "user@local")
    : "";
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

  const quickActions = useMemo<QuickAction[]>(
    () => [
      {
        id: "go-tickets",
        label: "Go to Tickets",
        subtitle: "Manage queue, filters, and assignments",
        href: "/tickets",
        icon: Ticket,
        shortcut: "G T",
      },
      {
        id: "go-incidents",
        label: "Go to Incidents",
        subtitle: "Review status pages and incident timeline",
        href: "/incidents",
        icon: TriangleAlert,
        shortcut: "G I",
      },
      {
        id: "go-orders",
        label: "Go to Orders",
        subtitle: "Track order and payment lifecycle",
        href: "/orders",
        icon: ShoppingCart,
        shortcut: "G O",
      },
      {
        id: "go-customers",
        label: "Go to Customers",
        subtitle: "Open customer records and health",
        href: "/customers",
        icon: UserRound,
        shortcut: "G C",
      },
      {
        id: "go-reports",
        label: "Go to Reports",
        subtitle: "View analytics and compliance trends",
        href: "/reports",
        icon: BarChart3,
        shortcut: "G R",
      },
    ],
    [],
  );
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

  const handleQuickActionSelect = useCallback(
    (action: QuickAction) => {
      setSearchOpen(false);
      router.push(action.href);
    },
    [router],
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
      <header className="flex h-16 items-center justify-between border-b border-border bg-background px-6">
        <div className="flex items-center gap-2">
          <SidebarTrigger />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="min-w-[220px] justify-between gap-2"
                disabled={isTopbarLoading}
              >
                <span className="font-medium truncate max-w-[150px]">
                  {isTopbarLoading
                    ? "Loading workspace..."
                    : activeOrganization?.name ?? "Select organization"}
                </span>
                {isSwitchingOrganization ? (
                  <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
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
                        <span className="text-xs text-muted-foreground">
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
          <ThemeToggle />

          <Button
            variant="outline"
            className="min-w-[300px] justify-between gap-2 text-muted-foreground"
            onClick={() => setSearchOpen(true)}
          >
            <div className="flex items-center gap-2">
              <Search className="w-4 h-4" />
              <span>Search...</span>
            </div>
            <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-xs text-muted-foreground">
              Ctrl+K
            </kbd>
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="relative"
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
              <button className="flex items-center gap-2 rounded-lg p-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <div className="w-8 h-8 rounded-full bg-foreground/80 flex items-center justify-center text-white text-sm font-medium overflow-hidden">
                  {userAvatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={userAvatarUrl}
                      alt="User avatar"
                      className="h-full w-full object-cover"
                    />
                  ) : hasUserIdentity ? (
                    userInitials
                  ) : (
                    <Image
                      src="/logo.webp"
                      alt="OpsDesk logo"
                      width={32}
                      height={32}
                      className="h-full w-full object-cover"
                      sizes="32px"
                    />
                  )}
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[240px]">
              <DropdownMenuLabel>
                <div className="flex flex-col">
                  <span>{userName || "Signed-in user"}</span>
                  <span className="text-xs font-normal text-muted-foreground">
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
          <DialogHeader className="space-y-0 border-b border-border bg-gradient-to-r from-muted/50 to-background px-4 py-3">
            <div className="flex items-center justify-between">
              <DialogTitle className="flex items-center gap-2 text-base font-semibold text-foreground">
                <Search className="h-4 w-4 text-muted-foreground" />
                Global Search
              </DialogTitle>
              <div className="flex items-center gap-1">
                <SearchKbd>Ctrl</SearchKbd>
                <SearchKbd>K</SearchKbd>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <Badge variant="secondary" className="rounded-full bg-muted/70 text-foreground">
                Tickets
              </Badge>
              <Badge variant="secondary" className="rounded-full bg-muted/70 text-foreground">
                Customers
              </Badge>
              <Badge variant="secondary" className="rounded-full bg-muted/70 text-foreground">
                Orders
              </Badge>
              <Badge variant="secondary" className="rounded-full bg-muted/70 text-foreground">
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
            <CommandList className="max-h-[430px] bg-background">
              {canRunSearch && !isSearchLoading && !searchError && totalSearchResults > 0 && (
                <div className="border-b border-border/60 px-3 py-2 text-xs text-muted-foreground">
                  Showing {totalSearchResults} results for
                  <span className="px-1 font-medium text-foreground">
                    {`"${normalizedSearchQuery}"`}
                  </span>
                </div>
              )}

              {showRecents && (
                <>
                  <CommandGroup heading="Quick Actions">
                    {quickActions.map((action) => {
                      const Icon = action.icon;
                      return (
                        <CommandItem
                          key={action.id}
                          value={`quick-${action.id}-${action.label}`}
                          onSelect={() => handleQuickActionSelect(action)}
                          className="micro-interactive gap-3 rounded-md border border-transparent px-2 py-2 data-[selected=true]:border-border data-[selected=true]:bg-muted"
                        >
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted">
                            <Icon className="h-4 w-4 text-muted-foreground" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium text-foreground">{action.label}</p>
                            <p className="truncate text-xs text-muted-foreground">{action.subtitle}</p>
                          </div>
                          <CommandShortcut>{action.shortcut}</CommandShortcut>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                  <CommandSeparator />
                </>
              )}

              {showRecents && recentSearches.length > 0 && (
                <>
                  <CommandGroup heading="Recent">
                    {recentSearches.map((item) => (
                      <CommandItem
                        key={`recent-${item.type}-${item.id}`}
                        value={`recent-${item.type}-${item.id}-${item.title}`}
                        onSelect={() => handleSearchItemSelect(item)}
                        className="micro-interactive gap-3 rounded-md border border-transparent px-2 py-2 data-[selected=true]:border-border data-[selected=true]:bg-muted"
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted">
                          <Clock3 className="h-4 w-4 text-muted-foreground" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-foreground">{item.title}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {item.subtitle} · {getRelativeSearchTime(item.selectedAt)}
                          </p>
                        </div>
                        <CommandShortcut>{getSearchTypeLabel(item.type)}</CommandShortcut>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                  {normalizedSearchQuery.length > 0 && <CommandSeparator />}
                </>
              )}

              {!canRunSearch && normalizedSearchQuery.length > 0 && (
                <div className="px-3 py-7 text-center text-sm text-muted-foreground">
                  Type at least {GLOBAL_SEARCH_MIN_QUERY_LENGTH} characters to search.
                </div>
              )}

              {!canRunSearch &&
                normalizedSearchQuery.length === 0 &&
                recentSearches.length === 0 &&
                quickActions.length === 0 && (
                <div className="px-3 py-10 text-center text-sm text-muted-foreground">
                  Search anything in your workspace from one command palette.
                </div>
              )}

              {canRunSearch && isSearchLoading && (
                <div className="space-y-2 px-3 py-4">
                  {[0, 1, 2, 3].map((index) => (
                    <div
                      key={`search-loading-${index}`}
                      className="h-14 animate-pulse rounded-md border border-border bg-muted/50"
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
          <div className="flex items-center justify-between border-t border-border bg-muted/80 px-3 py-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1">
                <SearchKbd>Up/Down</SearchKbd>
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

