"use client";

import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
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

    const channel = supabase
      .channel(`notifications-websocket-${currentUser.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${currentUser.id}`,
        },
        () => {
          if (refreshTimeoutRef.current) {
            clearTimeout(refreshTimeoutRef.current);
          }
          refreshTimeoutRef.current = setTimeout(() => {
            window.dispatchEvent(new CustomEvent("notifications:updated"));
            void dispatch(fetchTopbarData());
          }, 150);
        },
      )
      .subscribe();

    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
      void supabase.removeChannel(channel);
    };
  }, [currentUser?.id, dispatch]);

  return null;
}
