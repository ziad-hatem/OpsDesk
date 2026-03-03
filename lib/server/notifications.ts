import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export type AppNotificationType =
  | "ticket"
  | "order"
  | "customer"
  | "alert"
  | "comment";

type NotificationInsertInput = {
  userId: string;
  organizationId: string;
  type: AppNotificationType;
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
};

type NotificationRow = {
  user_id: string;
  organization_id: string;
  type: AppNotificationType;
  title: string;
  body: string | null;
  entity_type: string | null;
  entity_id: string | null;
};

export function getUniqueRecipientIds(
  ids: Array<string | null | undefined>,
  currentUserId: string,
): string[] {
  const uniqueIds = new Set<string>();

  for (const id of ids) {
    if (!id) {
      continue;
    }
    if (id === currentUserId) {
      continue;
    }
    uniqueIds.add(id);
  }

  return Array.from(uniqueIds);
}

export async function insertAppNotifications(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  items: NotificationInsertInput[],
): Promise<void> {
  const rows: NotificationRow[] = [];

  for (const item of items) {
    const title = item.title.trim();
    if (!item.userId || !item.organizationId || !title) {
      continue;
    }

    rows.push({
      user_id: item.userId,
      organization_id: item.organizationId,
      type: item.type,
      title,
      body: item.body ?? null,
      entity_type: item.entityType ?? null,
      entity_id: item.entityId ?? null,
    });
  }

  if (!rows.length) {
    return;
  }

  const dedupedByKey = new Map<string, NotificationRow>();
  for (const row of rows) {
    const dedupeKey = [
      row.user_id,
      row.organization_id,
      row.type,
      row.title,
      row.body ?? "",
      row.entity_type ?? "",
      row.entity_id ?? "",
    ].join("|");
    dedupedByKey.set(dedupeKey, row);
  }

  const { error } = await supabase
    .from("notifications")
    .insert(Array.from(dedupedByKey.values()));

  if (error) {
    console.error(`Failed to insert notifications: ${error.message}`);
  }
}
