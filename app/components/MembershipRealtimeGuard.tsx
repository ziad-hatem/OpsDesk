"use client";

import { useEffect, useRef } from "react";
import { signOut, useSession } from "next-auth/react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAppDispatch } from "@/lib/store/hooks";
import { fetchTopbarData } from "@/lib/store/slices/topbar-slice";

export function MembershipRealtimeGuard() {
  const dispatch = useAppDispatch();
  const { data: session, status } = useSession();
  const logoutInProgressRef = useRef(false);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (status !== "authenticated" || !session?.user?.id) {
      return;
    }

    let isUnmounted = false;

    const refreshAccessAndEnforce = async () => {
      try {
        const mePayload = await dispatch(fetchTopbarData()).unwrap();
        if (
          !isUnmounted &&
          mePayload.access.hasOnlySuspendedMemberships &&
          !logoutInProgressRef.current
        ) {
          logoutInProgressRef.current = true;
          toast.error(
            "Your organization access is suspended. You have been signed out.",
          );
          await signOut({ callbackUrl: "/login?error=account_suspended" });
        }
      } catch {
        // Ignore transient fetch failures and keep current session.
      }
    };

    void refreshAccessAndEnforce();
    const intervalId = setInterval(() => {
      void refreshAccessAndEnforce();
    }, 45_000);

    const channel = supabase
      .channel(`memberships-websocket-${session.user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "organization_memberships",
          filter: `user_id=eq.${session.user.id}`,
        },
        () => {
          if (refreshTimeoutRef.current) {
            clearTimeout(refreshTimeoutRef.current);
          }
          refreshTimeoutRef.current = setTimeout(() => {
            void refreshAccessAndEnforce();
          }, 120);
        },
      )
      .subscribe();

    return () => {
      isUnmounted = true;
      logoutInProgressRef.current = false;
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
      clearInterval(intervalId);
      void supabase.removeChannel(channel);
    };
  }, [dispatch, session?.user?.id, status]);

  return null;
}
