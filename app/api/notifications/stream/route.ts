import { auth } from "@/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const POLL_INTERVAL_MS = 5000;
const HEARTBEAT_INTERVAL_MS = 20000;

type NotificationSnapshot = {
  totalCount: number;
  unreadCount: number;
  latestNotificationId: string | null;
  latestCreatedAt: string | null;
};

type LatestNotificationRow = {
  id: string;
  created_at: string;
};

function serializeSnapshot(snapshot: NotificationSnapshot): string {
  return [
    snapshot.totalCount,
    snapshot.unreadCount,
    snapshot.latestNotificationId ?? "",
    snapshot.latestCreatedAt ?? "",
  ].join(":");
}

function formatSseEvent(eventName: string, payload: unknown): string {
  return `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function formatSseComment(comment: string): string {
  return `: ${comment}\n\n`;
}

async function loadNotificationSnapshot(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
): Promise<NotificationSnapshot> {
  const [totalResult, unreadResult, latestResult] = await Promise.all([
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("read_at", null),
    supabase
      .from("notifications")
      .select("id, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .returns<LatestNotificationRow[]>(),
  ]);

  if (totalResult.error) {
    throw new Error(`Failed to load notification total count: ${totalResult.error.message}`);
  }
  if (unreadResult.error) {
    throw new Error(`Failed to load unread notification count: ${unreadResult.error.message}`);
  }
  if (latestResult.error) {
    throw new Error(`Failed to load latest notification snapshot: ${latestResult.error.message}`);
  }

  const latestRow = latestResult.data?.[0] ?? null;

  return {
    totalCount: totalResult.count ?? 0,
    unreadCount: unreadResult.count ?? 0,
    latestNotificationId: latestRow?.id ?? null,
    latestCreatedAt: latestRow?.created_at ?? null,
  };
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  const userId = session.user.id;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let isClosed = false;
      let pollTimeout: ReturnType<typeof setTimeout> | null = null;
      let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
      let lastSnapshotHash: string | null = null;

      const clearTimers = () => {
        if (pollTimeout) {
          clearTimeout(pollTimeout);
          pollTimeout = null;
        }
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
      };

      const cleanup = () => {
        if (isClosed) {
          return;
        }
        isClosed = true;
        clearTimers();
        req.signal.removeEventListener("abort", abortHandler);
      };

      const enqueue = (chunk: string) => {
        if (isClosed) {
          return;
        }
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };

      const schedulePoll = () => {
        if (isClosed) {
          return;
        }
        pollTimeout = setTimeout(() => {
          void poll();
        }, POLL_INTERVAL_MS);
      };

      const poll = async () => {
        if (isClosed) {
          return;
        }

        try {
          const snapshot = await loadNotificationSnapshot(supabase, userId);
          const snapshotHash = serializeSnapshot(snapshot);
          if (lastSnapshotHash === null) {
            lastSnapshotHash = snapshotHash;
            enqueue(formatSseEvent("notifications.snapshot", snapshot));
          } else if (lastSnapshotHash !== snapshotHash) {
            lastSnapshotHash = snapshotHash;
            enqueue(
              formatSseEvent("notifications.updated", {
                at: new Date().toISOString(),
                snapshot,
              }),
            );
          }
        } catch {
          enqueue(
            formatSseEvent("notifications.error", {
              message: "Failed to refresh notifications stream snapshot",
            }),
          );
        } finally {
          schedulePoll();
        }
      };

      const abortHandler = () => {
        cleanup();
      };

      enqueue("retry: 5000\n\n");
      enqueue(formatSseComment("notifications stream connected"));
      void poll();
      heartbeatInterval = setInterval(() => {
        enqueue(formatSseComment("keepalive"));
      }, HEARTBEAT_INTERVAL_MS);

      req.signal.addEventListener("abort", abortHandler);
    },
    cancel() {
      // No-op: cleanup is handled by request abort.
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
