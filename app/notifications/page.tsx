"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  AlertCircle,
  Bell,
  CheckCheck,
  Circle,
  Loader2,
  MessageSquare,
  Package,
  RefreshCcw,
  Ticket,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { EmptyState } from "../components/ui/empty-state";
import {
  PageDescription,
  PageHeader,
  PageShell,
  PageTitle,
  StickyActionBar,
} from "../components/ui/page-layout";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "../components/ui/sheet";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  fetchTopbarData,
  selectTopbarActiveOrganizationId,
} from "@/lib/store/slices/topbar-slice";

type NotificationType = "ticket" | "order" | "customer" | "alert" | "comment";
type NotificationFilter = "all" | "unread" | "mentions" | "incidents" | "payments";

type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
  organization_id: string;
};

const notificationIcons: Record<NotificationType, typeof Ticket> = {
  ticket: Ticket,
  order: Package,
  customer: Users,
  alert: AlertCircle,
  comment: MessageSquare,
};

function getNotificationIcon(type: string) {
  if (type in notificationIcons) {
    return notificationIcons[type as NotificationType];
  }
  return Bell;
}

function getRelativeTime(isoDate: string) {
  try {
    return formatDistanceToNow(new Date(isoDate), { addSuffix: true });
  } catch {
    return "just now";
  }
}

function normalizeText(...values: Array<string | null | undefined>): string {
  return values
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

function isMentionNotification(notification: NotificationItem): boolean {
  const haystack = normalizeText(notification.title, notification.body);
  return notification.type === "comment" && (haystack.includes("mention") || haystack.includes("@"));
}

function isIncidentNotification(notification: NotificationItem): boolean {
  const haystack = normalizeText(
    notification.type,
    notification.entity_type,
    notification.title,
    notification.body,
  );
  return (
    notification.type === "alert" ||
    haystack.includes("incident") ||
    haystack.includes("outage") ||
    haystack.includes("status page")
  );
}

function isPaymentNotification(notification: NotificationItem): boolean {
  const haystack = normalizeText(
    notification.type,
    notification.entity_type,
    notification.title,
    notification.body,
  );
  return (
    notification.type === "order" ||
    haystack.includes("payment") ||
    haystack.includes("invoice") ||
    haystack.includes("checkout") ||
    haystack.includes("refund")
  );
}

async function readApiError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload.error) {
      return payload.error;
    }
  } catch {
    // ignore parse failure
  }
  return response.statusText || `Request failed (${response.status})`;
}

export default function NotificationsCenterPage() {
  const dispatch = useAppDispatch();
  const activeOrgId = useAppSelector(selectTopbarActiveOrganizationId);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);
  const [activeMarkingId, setActiveMarkingId] = useState<string | null>(null);
  const [selectedNotification, setSelectedNotification] = useState<NotificationItem | null>(null);
  const [lastRealtimeUpdateAt, setLastRealtimeUpdateAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());

  const loadNotifications = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/notifications?limit=100", {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const data = (await response.json()) as {
        notifications: NotificationItem[];
      };
      setNotifications(data.notifications ?? []);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to load notifications";
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNotifications();
  }, [activeOrgId, loadNotifications]);

  useEffect(() => {
    const handleNotificationsUpdated = () => {
      setLastRealtimeUpdateAt(Date.now());
      void loadNotifications();
      void dispatch(fetchTopbarData());
    };

    window.addEventListener("notifications:updated", handleNotificationsUpdated);
    return () => {
      window.removeEventListener("notifications:updated", handleNotificationsUpdated);
    };
  }, [dispatch, loadNotifications]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowTick(Date.now());
    }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.read_at).length,
    [notifications],
  );

  const mentionsCount = useMemo(
    () => notifications.filter(isMentionNotification).length,
    [notifications],
  );
  const incidentsCount = useMemo(
    () => notifications.filter(isIncidentNotification).length,
    [notifications],
  );
  const paymentsCount = useMemo(
    () => notifications.filter(isPaymentNotification).length,
    [notifications],
  );

  const filteredNotifications = useMemo(() => {
    if (filter === "unread") {
      return notifications.filter((notification) => !notification.read_at);
    }
    if (filter === "mentions") {
      return notifications.filter(isMentionNotification);
    }
    if (filter === "incidents") {
      return notifications.filter(isIncidentNotification);
    }
    if (filter === "payments") {
      return notifications.filter(isPaymentNotification);
    }
    return notifications;
  }, [filter, notifications]);

  const visibleUnreadIds = useMemo(
    () =>
      filteredNotifications
        .filter((notification) => !notification.read_at)
        .map((notification) => notification.id),
    [filteredNotifications],
  );

  const isRealtimeFresh =
    lastRealtimeUpdateAt !== null && nowTick - lastRealtimeUpdateAt < 15000;

  const handleMarkAsRead = async (id: string) => {
    setActiveMarkingId(id);
    setNotifications((prev) =>
      prev.map((notification) =>
        notification.id === id && !notification.read_at
          ? { ...notification, read_at: new Date().toISOString() }
          : notification,
      ),
    );
    try {
      const response = await fetch(`/api/notifications/${id}`, {
        method: "PATCH",
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      void dispatch(fetchTopbarData());
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to mark as read";
      toast.error(message);
      await loadNotifications();
    } finally {
      setActiveMarkingId(null);
    }
  };

  const markIdsAsRead = async (ids: string[]) => {
    if (!ids.length) {
      return;
    }

    setNotifications((prev) => {
      const readAt = new Date().toISOString();
      const idSet = new Set(ids);
      return prev.map((notification) =>
        idSet.has(notification.id) && !notification.read_at
          ? { ...notification, read_at: readAt }
          : notification,
      );
    });

    const response = await fetch("/api/notifications", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ids }),
    });

    if (!response.ok) {
      throw new Error(await readApiError(response));
    }
    void dispatch(fetchTopbarData());
  };

  const handleMarkVisibleAsRead = async () => {
    if (!visibleUnreadIds.length) {
      return;
    }
    const toastId = toast.loading("Marking visible notifications as read...");
    try {
      await markIdsAsRead(visibleUnreadIds);
      toast.success("Visible notifications marked as read", { id: toastId });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to mark visible notifications as read";
      toast.error(message, { id: toastId });
      await loadNotifications();
    }
  };

  const handleMarkAllAsRead = async () => {
    if (!unreadCount) {
      return;
    }

    const toastId = toast.loading("Marking all notifications as read...");
    setIsMarkingAllRead(true);
    try {
      const response = await fetch("/api/notifications", {
        method: "PATCH",
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const readAt = new Date().toISOString();
      setNotifications((prev) =>
        prev.map((notification) => ({ ...notification, read_at: readAt })),
      );
      void dispatch(fetchTopbarData());
      toast.success("All notifications marked as read", { id: toastId });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to mark all as read";
      toast.error(message, { id: toastId });
      await loadNotifications();
    } finally {
      setIsMarkingAllRead(false);
    }
  };

  const selectedDescription =
    selectedNotification?.body ||
    [selectedNotification?.entity_type, selectedNotification?.entity_id]
      .filter(Boolean)
      .join(" ")
      .trim();

  return (
    <PageShell>
      <PageHeader>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <PageTitle>Notifications</PageTitle>
            {unreadCount > 0 ? (
              <Badge className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                {unreadCount} unread
              </Badge>
            ) : null}
            <Badge
              variant="outline"
              className={
                isRealtimeFresh
                  ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                  : ""
              }
            >
              <Circle
                className={`mr-1.5 h-2.5 w-2.5 ${
                  isRealtimeFresh
                    ? "fill-emerald-500 text-emerald-500 dark:fill-emerald-400 dark:text-emerald-400"
                    : "fill-muted-foreground/40 text-muted-foreground/60"
                }`}
              />
              {isRealtimeFresh ? "Live updates" : "Waiting for realtime"}
            </Badge>
          </div>
          <PageDescription>
            Filter, triage, and clear activity quickly without leaving this page.
          </PageDescription>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => void loadNotifications()}
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            onClick={handleMarkAllAsRead}
            disabled={unreadCount === 0 || isMarkingAllRead}
          >
            {isMarkingAllRead ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Marking...
              </>
            ) : (
              <>
                <CheckCheck className="h-4 w-4" />
                Mark all read
              </>
            )}
          </Button>
        </div>
      </PageHeader>

      <StickyActionBar className="micro-fade-in">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <Tabs
            value={filter}
            onValueChange={(value) => setFilter(value as NotificationFilter)}
          >
            <TabsList className="h-auto flex-wrap justify-start">
              <TabsTrigger value="all">All ({notifications.length})</TabsTrigger>
              <TabsTrigger value="unread">Unread ({unreadCount})</TabsTrigger>
              <TabsTrigger value="mentions">Mentions ({mentionsCount})</TabsTrigger>
              <TabsTrigger value="incidents">Incidents ({incidentsCount})</TabsTrigger>
              <TabsTrigger value="payments">Payments ({paymentsCount})</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => void handleMarkVisibleAsRead()}
            disabled={visibleUnreadIds.length === 0}
          >
            <CheckCheck className="h-4 w-4" />
            Mark visible as read
          </Button>
        </div>
      </StickyActionBar>

      {isLoading ? (
        <Card>
          <CardContent className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Loading notifications...
          </CardContent>
        </Card>
      ) : filteredNotifications.length === 0 ? (
        <EmptyState
          icon={<Bell className="h-5 w-5" />}
          title="No notifications in this view"
          description="Try switching filters or refresh to check for new updates."
          action={
            <Button variant="outline" className="gap-2" onClick={() => void loadNotifications()}>
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {filteredNotifications.map((notification) => {
            const Icon = getNotificationIcon(notification.type);
            const isUnread = !notification.read_at;
            const description =
              notification.body ||
              [notification.entity_type, notification.entity_id]
                .filter(Boolean)
                .join(" ")
                .trim();

            return (
              <Card
                key={notification.id}
                className={`micro-interactive cursor-pointer transition-all duration-200 ${
                  isUnread ? "border-primary/30 bg-primary/10" : "border-border/70 bg-card"
                }`}
                onClick={() => setSelectedNotification(notification)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    <div
                      className={`rounded-lg p-2 ${
                        isUnread
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <p className="mb-1 font-medium text-foreground">{notification.title}</p>
                          {description ? (
                            <p className="max-h-10 overflow-hidden text-sm text-muted-foreground">
                              {description}
                            </p>
                          ) : null}
                          <p className="mt-2 text-xs text-muted-foreground">
                            {getRelativeTime(notification.created_at)}
                          </p>
                        </div>
                        {isUnread ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleMarkAsRead(notification.id);
                            }}
                            disabled={activeMarkingId === notification.id}
                            className="shrink-0"
                          >
                            {activeMarkingId === notification.id ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Marking...
                              </>
                            ) : (
                              "Mark as read"
                            )}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Sheet
        open={Boolean(selectedNotification)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedNotification(null);
          }
        }}
      >
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Notification Details</SheetTitle>
            <SheetDescription>
              Review full details and update read status inline.
            </SheetDescription>
          </SheetHeader>
          {selectedNotification ? (
            <div className="space-y-4 px-4">
              <div className="rounded-lg border border-border bg-muted/50 p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Title</p>
                <p className="mt-1 text-sm font-medium text-foreground">
                  {selectedNotification.title}
                </p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Description</p>
                <p className="mt-1 text-sm text-foreground">
                  {selectedDescription || "No additional context provided."}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Type</p>
                  <p className="mt-1 text-foreground">{selectedNotification.type}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Created</p>
                  <p className="mt-1 text-foreground">
                    {getRelativeTime(selectedNotification.created_at)}
                  </p>
                </div>
              </div>
            </div>
          ) : null}
          <SheetFooter className="flex-row justify-end gap-2">
            <Button variant="outline" onClick={() => setSelectedNotification(null)}>
              Close
            </Button>
            {selectedNotification && !selectedNotification.read_at ? (
              <Button
                onClick={() => void handleMarkAsRead(selectedNotification.id)}
                disabled={activeMarkingId === selectedNotification.id}
              >
                {activeMarkingId === selectedNotification.id ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Marking...
                  </>
                ) : (
                  "Mark as read"
                )}
              </Button>
            ) : null}
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </PageShell>
  );
}

