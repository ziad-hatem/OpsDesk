import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isMissingTableInSchemaCache } from "@/lib/tickets/errors";

type SupabaseClient = ReturnType<typeof createSupabaseAdminClient>;

type SupabaseLikeError = {
  message?: string;
};

type AuditLogDetails = Record<string, unknown> | null | undefined;

interface WriteAuditLogParams {
  supabase: SupabaseClient;
  organizationId: string;
  actorUserId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  targetUserId?: string | null;
  source?: string | null;
  details?: AuditLogDetails;
}

function isMissingAuditLogsTable(error: SupabaseLikeError | null | undefined): boolean {
  const message = (error?.message ?? "").toLowerCase();
  if (!message) {
    return false;
  }

  return (
    message.includes("audit_logs") &&
    (message.includes("does not exist") || message.includes("schema cache"))
  );
}

function isMissingExtendedAuditColumn(error: SupabaseLikeError | null | undefined): boolean {
  const message = (error?.message ?? "").toLowerCase();
  if (!message) {
    return false;
  }

  return (
    message.includes("column") &&
    message.includes("audit_logs") &&
    (message.includes("target_user_id") ||
      message.includes("source") ||
      message.includes("details"))
  );
}

function normalizeAuditDetails(details: AuditLogDetails): Record<string, unknown> | null {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return null;
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (typeof value !== "undefined") {
      normalized[key] = value;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

export async function writeAuditLog(params: WriteAuditLogParams): Promise<void> {
  const {
    supabase,
    organizationId,
    actorUserId = null,
    action,
    entityType = null,
    entityId = null,
    targetUserId = null,
    source = "api",
    details,
  } = params;

  const normalizedDetails = normalizeAuditDetails(details);
  const extendedPayload = {
    organization_id: organizationId,
    actor_user_id: actorUserId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    target_user_id: targetUserId,
    source,
    details: normalizedDetails,
  };

  let { error } = await supabase.from("audit_logs").insert(extendedPayload);

  if (error && isMissingExtendedAuditColumn(error)) {
    const fallbackResult = await supabase.from("audit_logs").insert({
      organization_id: organizationId,
      actor_user_id: actorUserId,
      action,
      entity_type: entityType,
      entity_id: entityId,
    });
    error = fallbackResult.error;
  }

  if (error && !isMissingAuditLogsTable(error) && !isMissingTableInSchemaCache(error, "audit_logs")) {
    console.error(`Failed to write audit log (${action}): ${error.message}`);
  }
}
