"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  AlertCircle,
  Bell,
  CheckCheck,
  Loader2,
  MessageSquare,
  Package,
  Ticket,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  fetchTopbarData,
  selectTopbarActiveOrganizationId,
} from "@/lib/store/slices/topbar-slice";

type NotificationType = "ticket" | "order" | "customer" | "alert" | "comment";

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
    return "Just now";
  }
}

export default function NotificationsCenterPage() {
  const dispatch = useAppDispatch();
  const activeOrgId = useAppSelector(selectTopbarActiveOrganizationId);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [isLoading, setIsLoading] = useState(true);
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);
  const [activeMarkingId, setActiveMarkingId] = useState<string | null>(null);

  const loadNotifications = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/notifications?limit=100", {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string };
        throw new Error(errorData.error ?? "Failed to load notifications");
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

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.read_at).length,
    [notifications],
  );

  const filteredNotifications = useMemo(() => {
    if (filter === "unread") {
      return notifications.filter((notification) => !notification.read_at);
    }
    return notifications;
  }, [filter, notifications]);

  const handleMarkAsRead = async (id: string) => {
    setActiveMarkingId(id);
    try {
      const response = await fetch(`/api/notifications/${id}`, {
        method: "PATCH",
      });

      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string };
        throw new Error(errorData.error ?? "Failed to mark as read");
      }

      const readAt = new Date().toISOString();
      setNotifications((prev) =>
        prev.map((notification) =>
          notification.id === id
            ? { ...notification, read_at: notification.read_at ?? readAt }
            : notification,
        ),
      );
      void dispatch(fetchTopbarData());
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to mark as read";
      toast.error(message);
    } finally {
      setActiveMarkingId(null);
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
        const errorData = (await response.json()) as { error?: string };
        throw new Error(errorData.error ?? "Failed to mark all as read");
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
    } finally {
      setIsMarkingAllRead(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold text-slate-900">Notifications</h1>
            {unreadCount > 0 && (
              <Badge className="bg-red-600 hover:bg-red-600">{unreadCount} new</Badge>
            )}
          </div>
          <p className="text-slate-600 mt-1">Stay updated with your latest activity</p>
        </div>
        <Button
          variant="outline"
          className="gap-2 focus:ring-2 focus:ring-slate-900"
          onClick={handleMarkAllAsRead}
          disabled={unreadCount === 0 || isMarkingAllRead}
        >
          {isMarkingAllRead ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Marking...
            </>
          ) : (
            <>
              <CheckCheck className="w-4 h-4" />
              Mark all as read
            </>
          )}
        </Button>
      </div>

      <Tabs value={filter} onValueChange={(value) => setFilter(value as "all" | "unread")}>
        <TabsList>
          <TabsTrigger value="all">All ({notifications.length})</TabsTrigger>
          <TabsTrigger value="unread">Unread ({unreadCount})</TabsTrigger>
        </TabsList>

        <TabsContent value={filter} className="mt-6">
          {isLoading ? (
            <Card>
              <CardContent className="flex items-center justify-center py-12 text-slate-500">
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Loading notifications...
              </CardContent>
            </Card>
          ) : filteredNotifications.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <div className="w-16 h-16 mb-4 rounded-full bg-slate-100 flex items-center justify-center">
                  <Bell className="w-8 h-8 text-slate-400" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-1">
                  No notifications
                </h3>
                <p className="text-sm text-slate-600">You&apos;re all caught up!</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-1">
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
                    className={`${
                      isUnread ? "bg-blue-50 border-blue-200" : "bg-white"
                    } hover:shadow-sm transition-shadow`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-4">
                        <div
                          className={`p-2 rounded-lg ${
                            isUnread ? "bg-blue-100" : "bg-slate-100"
                          }`}
                        >
                          <Icon
                            className={`w-5 h-5 ${
                              isUnread ? "text-blue-600" : "text-slate-600"
                            }`}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <p className="font-medium text-slate-900 mb-1">
                                {notification.title}
                              </p>
                              {description && (
                                <p className="text-sm text-slate-600">{description}</p>
                              )}
                              <p className="text-xs text-slate-500 mt-2">
                                {getRelativeTime(notification.created_at)}
                              </p>
                            </div>
                            {isUnread && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleMarkAsRead(notification.id)}
                                disabled={activeMarkingId === notification.id}
                                className="shrink-0 focus:ring-2 focus:ring-slate-900"
                              >
                                {activeMarkingId === notification.id ? (
                                  <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Marking...
                                  </>
                                ) : (
                                  "Mark as read"
                                )}
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
