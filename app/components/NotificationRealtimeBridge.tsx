"use client";

import { useEffect, useRef } from "react";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  fetchTopbarData,
  selectTopbarUser,
} from "@/lib/store/slices/topbar-slice";

export function NotificationRealtimeBridge() {
  const dispatch = useAppDispatch();
  const currentUser = useAppSelector(selectTopbarUser);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!currentUser?.id) {
      return;
    }

    const handleNotificationsUpdated = () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
      refreshTimeoutRef.current = setTimeout(() => {
        window.dispatchEvent(new CustomEvent("notifications:updated"));
        void dispatch(fetchTopbarData());
      }, 150);
    };

    const eventSource = new EventSource("/api/notifications/stream", {
      withCredentials: true,
    });
    eventSource.addEventListener(
      "notifications.snapshot",
      handleNotificationsUpdated,
    );
    eventSource.addEventListener(
      "notifications.updated",
      handleNotificationsUpdated,
    );

    return () => {
      eventSource.removeEventListener(
        "notifications.snapshot",
        handleNotificationsUpdated,
      );
      eventSource.removeEventListener(
        "notifications.updated",
        handleNotificationsUpdated,
      );
      eventSource.close();
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    };
  }, [currentUser?.id, dispatch]);

  return null;
}
