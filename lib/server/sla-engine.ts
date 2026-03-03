import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isMissingTableInSchemaCache } from "@/lib/tickets/errors";
import type { OrganizationRole } from "@/lib/topbar/types";
import type { TicketPriority, TicketStatus } from "@/lib/tickets/types";
import { writeAuditLog } from "@/lib/server/audit-logs";
import { insertAppNotifications } from "@/lib/server/notifications";
import type { SlaPolicy, SlaEventType } from "@/lib/sla/types";

type SupabaseClient = ReturnType<typeof createSupabaseAdminClient>;

type SlaPolicyRow = SlaPolicy;

type MembershipRow = {
  user_id: string;
  role: OrganizationRole;
  status?: "active" | "suspended" | null;
};

type MembershipFallbackRow = Omit<MembershipRow, "status">;

type TicketRow = {
  id: string;
  organization_id: string;
  title: string;
  status: TicketStatus;
  priority: TicketPriority;
  assignee_id: string | null;
  created_by: string;
  created_at: string;
  sla_due_at: string | null;
};

type TicketTextRow = {
  ticket_id: string;
  author_id: string;
  type: "comment" | "internal_note" | "system";
  created_at: string;
};

const MINUTE_IN_MS = 60 * 1000;
const OPEN_TICKET_STATUSES: TicketStatus[] = ["open", "pending"];

const DEFAULT_SLA_POLICIES: Record<
  TicketPriority,
  Pick<
    SlaPolicy,
    | "first_response_minutes"
    | "resolution_minutes"
    | "warning_minutes"
    | "escalation_role"
    | "auto_escalate"
  >
> = {
  low: {
    first_response_minutes: 8 * 60,
    resolution_minutes: 72 * 60,
    warning_minutes: 8 * 60,
    escalation_role: "manager",
    auto_escalate: true,
  },
  medium: {
    first_response_minutes: 4 * 60,
    resolution_minutes: 48 * 60,
    warning_minutes: 4 * 60,
    escalation_role: "manager",
    auto_escalate: true,
  },
  high: {
    first_response_minutes: 2 * 60,
    resolution_minutes: 24 * 60,
    warning_minutes: 2 * 60,
    escalation_role: "manager",
    auto_escalate: true,
  },
  urgent: {
    first_response_minutes: 30,
    resolution_minutes: 8 * 60,
    warning_minutes: 30,
    escalation_role: "manager",
    auto_escalate: true,
  },
};

function toIso(date: Date): string {
  return date.toISOString();
}

function parseDateSafe(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function addMinutes(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * MINUTE_IN_MS);
}

function isDuplicateInsertError(error: { code?: string | null; message?: string | null }): boolean {
  return (
    error.code === "23505" ||
    (error.message ?? "").toLowerCase().includes("duplicate key value")
  );
}

async function loadManagers(
  supabase: SupabaseClient,
  organizationId: string,
  escalationRole: OrganizationRole,
): Promise<string[]> {
  const eligibleRoles: OrganizationRole[] =
    escalationRole === "admin" ? ["admin"] : ["admin", "manager"];

  const membershipResultWithStatus = await supabase
    .from("organization_memberships")
    .select("user_id, role, status")
    .eq("organization_id", organizationId)
    .in("role", eligibleRoles)
    .returns<MembershipRow[]>();

  let memberships: MembershipRow[] = [];
  if (membershipResultWithStatus.error) {
    const isMissingStatusColumn = membershipResultWithStatus.error.message
      .toLowerCase()
      .includes("organization_memberships.status");

    if (!isMissingStatusColumn) {
      return [];
    }

    const fallbackMembershipResult = await supabase
      .from("organization_memberships")
      .select("user_id, role")
      .eq("organization_id", organizationId)
      .in("role", eligibleRoles)
      .returns<MembershipFallbackRow[]>();

    if (fallbackMembershipResult.error) {
      return [];
    }

    memberships = (fallbackMembershipResult.data ?? []).map((membership) => ({
      ...membership,
      status: "active",
    }));
  } else {
    memberships = membershipResultWithStatus.data ?? [];
  }

  return memberships
    .filter((membership) => membership.status !== "suspended")
    .map((membership) => membership.user_id);
}

async function hasExternalFirstResponse(
  supabase: SupabaseClient,
  organizationId: string,
  ticket: TicketRow,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("ticket_texts")
    .select("ticket_id, author_id, type, created_at")
    .eq("organization_id", organizationId)
    .eq("ticket_id", ticket.id)
    .neq("type", "system")
    .order("created_at", { ascending: true })
    .limit(100)
    .returns<TicketTextRow[]>();

  if (error) {
    return false;
  }

  for (const row of data ?? []) {
    if (row.author_id !== ticket.created_by) {
      return true;
    }
  }

  return false;
}

async function insertSlaEvent(params: {
  supabase: SupabaseClient;
  organizationId: string;
  ticketId: string;
  eventType: SlaEventType;
  dueAt?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<boolean> {
  const { supabase, organizationId, ticketId, eventType, dueAt = null, metadata = null } = params;

  const { error } = await supabase.from("ticket_sla_events").insert({
    organization_id: organizationId,
    ticket_id: ticketId,
    event_type: eventType,
    due_at: dueAt,
    metadata,
  });

  if (!error) {
    return true;
  }

  if (isDuplicateInsertError(error)) {
    return false;
  }

  if (isMissingTableInSchemaCache(error, "ticket_sla_events")) {
    return false;
  }

  console.error(`Failed to insert SLA event (${eventType}): ${error.message}`);
  return false;
}

async function notifySlaEscalation(params: {
  supabase: SupabaseClient;
  organizationId: string;
  ticket: TicketRow;
  recipients: string[];
  title: string;
  body: string;
}): Promise<void> {
  const { supabase, organizationId, ticket, recipients, title, body } = params;
  if (!recipients.length) {
    return;
  }

  await insertAppNotifications(
    supabase,
    recipients.map((recipientId) => ({
      userId: recipientId,
      organizationId,
      type: "alert",
      title,
      body,
      entityType: "ticket",
      entityId: ticket.id,
    })),
  );
}

async function appendTicketSystemMessage(params: {
  supabase: SupabaseClient;
  organizationId: string;
  ticketId: string;
  actorUserId: string;
  body: string;
}): Promise<void> {
  const { supabase, organizationId, ticketId, actorUserId, body } = params;
  await supabase.from("ticket_texts").insert({
    organization_id: organizationId,
    ticket_id: ticketId,
    author_id: actorUserId,
    type: "system",
    body,
  });
}

export async function ensureDefaultSlaPolicies(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("sla_policies")
    .select("priority")
    .eq("organization_id", organizationId)
    .returns<Array<{ priority: TicketPriority }>>();

  if (error) {
    if (!isMissingTableInSchemaCache(error, "sla_policies")) {
      console.error(`Failed to load SLA policies: ${error.message}`);
    }
    return;
  }

  const existing = new Set((data ?? []).map((row) => row.priority));
  const rowsToInsert = (Object.keys(DEFAULT_SLA_POLICIES) as TicketPriority[])
    .filter((priority) => !existing.has(priority))
    .map((priority) => ({
      organization_id: organizationId,
      priority,
      ...DEFAULT_SLA_POLICIES[priority],
    }));

  if (!rowsToInsert.length) {
    return;
  }

  const { error: insertError } = await supabase
    .from("sla_policies")
    .insert(rowsToInsert);

  if (insertError && !isMissingTableInSchemaCache(insertError, "sla_policies")) {
    console.error(`Failed to insert default SLA policies: ${insertError.message}`);
  }
}

export async function getSlaPolicies(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<SlaPolicy[]> {
  await ensureDefaultSlaPolicies(supabase, organizationId);

  const { data, error } = await supabase
    .from("sla_policies")
    .select(
      "id, organization_id, priority, first_response_minutes, resolution_minutes, warning_minutes, escalation_role, auto_escalate, created_at, updated_at",
    )
    .eq("organization_id", organizationId)
    .returns<SlaPolicyRow[]>();

  if (error) {
    if (!isMissingTableInSchemaCache(error, "sla_policies")) {
      console.error(`Failed to load SLA policies: ${error.message}`);
    }
    return [];
  }

  return (data ?? []).sort((left, right) => left.priority.localeCompare(right.priority));
}

export async function getSlaPolicyByPriority(params: {
  supabase: SupabaseClient;
  organizationId: string;
  priority: TicketPriority;
}): Promise<SlaPolicy | null> {
  const { supabase, organizationId, priority } = params;
  const policies = await getSlaPolicies(supabase, organizationId);
  const match = policies.find((policy) => policy.priority === priority);
  if (match) {
    return match;
  }

  const fallback = DEFAULT_SLA_POLICIES[priority];
  if (!fallback) {
    return null;
  }

  return {
    id: "",
    organization_id: organizationId,
    priority,
    first_response_minutes: fallback.first_response_minutes,
    resolution_minutes: fallback.resolution_minutes,
    warning_minutes: fallback.warning_minutes,
    escalation_role: fallback.escalation_role,
    auto_escalate: fallback.auto_escalate,
    created_at: "",
    updated_at: "",
  };
}

export function computeResolutionDueAtFromPolicy(params: {
  createdAt: string;
  policy: Pick<SlaPolicy, "resolution_minutes">;
}): string | null {
  const createdAt = parseDateSafe(params.createdAt);
  if (!createdAt) {
    return null;
  }
  return toIso(addMinutes(createdAt, params.policy.resolution_minutes));
}

export async function runSlaEscalationEngine(params: {
  supabase: SupabaseClient;
  organizationId: string;
  actorUserId?: string | null;
  ticketId?: string | null;
}): Promise<{
  scanned: number;
  warningsCreated: number;
  breachesCreated: number;
  autoEscalations: number;
}> {
  const { supabase, organizationId, actorUserId = null, ticketId = null } = params;
  const policies = await getSlaPolicies(supabase, organizationId);
  if (!policies.length) {
    return {
      scanned: 0,
      warningsCreated: 0,
      breachesCreated: 0,
      autoEscalations: 0,
    };
  }

  const policiesByPriority = new Map(policies.map((policy) => [policy.priority, policy]));
  let ticketQuery = supabase
    .from("tickets")
    .select(
      "id, organization_id, title, status, priority, assignee_id, created_by, created_at, sla_due_at",
    )
    .eq("organization_id", organizationId)
    .in("status", OPEN_TICKET_STATUSES);

  if (ticketId) {
    ticketQuery = ticketQuery.eq("id", ticketId);
  }

  const { data: tickets, error: ticketError } = await ticketQuery.returns<TicketRow[]>();
  if (ticketError) {
    if (!isMissingTableInSchemaCache(ticketError, "tickets")) {
      console.error(`Failed to load tickets for SLA engine: ${ticketError.message}`);
    }
    return {
      scanned: 0,
      warningsCreated: 0,
      breachesCreated: 0,
      autoEscalations: 0,
    };
  }

  const rows = tickets ?? [];
  if (!rows.length) {
    return {
      scanned: 0,
      warningsCreated: 0,
      breachesCreated: 0,
      autoEscalations: 0,
    };
  }

  let warningsCreated = 0;
  let breachesCreated = 0;
  let autoEscalations = 0;
  const now = new Date();

  for (const ticket of rows) {
    const policy = policiesByPriority.get(ticket.priority);
    if (!policy) {
      continue;
    }

    const createdAt = parseDateSafe(ticket.created_at);
    if (!createdAt) {
      continue;
    }

    let resolutionDueAt = parseDateSafe(ticket.sla_due_at);
    if (!resolutionDueAt) {
      resolutionDueAt = addMinutes(createdAt, policy.resolution_minutes);
      await supabase
        .from("tickets")
        .update({ sla_due_at: toIso(resolutionDueAt) })
        .eq("organization_id", organizationId)
        .eq("id", ticket.id);
    }

    const firstResponseDueAt = addMinutes(createdAt, policy.first_response_minutes);
    const firstResponseWarningAt = addMinutes(firstResponseDueAt, -policy.warning_minutes);

    const hasFirstResponse = await hasExternalFirstResponse(supabase, organizationId, ticket);
    if (!hasFirstResponse) {
      if (now.getTime() >= firstResponseDueAt.getTime()) {
        const created = await insertSlaEvent({
          supabase,
          organizationId,
          ticketId: ticket.id,
          eventType: "first_response_breached",
          dueAt: toIso(firstResponseDueAt),
          metadata: { priority: ticket.priority },
        });
        if (created) {
          breachesCreated += 1;
          await appendTicketSystemMessage({
            supabase,
            organizationId,
            ticketId: ticket.id,
            actorUserId: actorUserId ?? ticket.created_by,
            body: "SLA breach: first response deadline missed.",
          });
        }
      } else if (now.getTime() >= firstResponseWarningAt.getTime()) {
        const created = await insertSlaEvent({
          supabase,
          organizationId,
          ticketId: ticket.id,
          eventType: "first_response_warning",
          dueAt: toIso(firstResponseDueAt),
          metadata: { priority: ticket.priority },
        });
        if (created) {
          warningsCreated += 1;
          const recipients = Array.from(
            new Set([ticket.created_by, ticket.assignee_id].filter(Boolean) as string[]),
          );
          await notifySlaEscalation({
            supabase,
            organizationId,
            ticket,
            recipients,
            title: "SLA warning: first response due soon",
            body: `Ticket "${ticket.title}" is nearing first response SLA deadline.`,
          });
        }
      }
    }

    const resolutionWarningAt = addMinutes(resolutionDueAt, -policy.warning_minutes);
    if (now.getTime() >= resolutionDueAt.getTime()) {
      const created = await insertSlaEvent({
        supabase,
        organizationId,
        ticketId: ticket.id,
        eventType: "resolution_breached",
        dueAt: toIso(resolutionDueAt),
        metadata: { priority: ticket.priority },
      });

      if (created) {
        breachesCreated += 1;
        await appendTicketSystemMessage({
          supabase,
          organizationId,
          ticketId: ticket.id,
          actorUserId: actorUserId ?? ticket.created_by,
          body: "SLA breach: resolution deadline missed.",
        });

        const managerIds = await loadManagers(
          supabase,
          organizationId,
          policy.escalation_role,
        );
        const notifyRecipients = Array.from(
          new Set([...managerIds, ticket.assignee_id, ticket.created_by].filter(Boolean) as string[]),
        );

        await notifySlaEscalation({
          supabase,
          organizationId,
          ticket,
          recipients: notifyRecipients,
          title: "SLA breached: ticket requires escalation",
          body: `Ticket "${ticket.title}" breached resolution SLA and was escalated.`,
        });

        let escalatedToUserId: string | null = null;
        if (policy.auto_escalate && managerIds.length > 0) {
          const nextManagerId = managerIds.find((id) => id !== ticket.assignee_id) ?? managerIds[0];
          if (nextManagerId && nextManagerId !== ticket.assignee_id) {
            const { error: reassignError } = await supabase
              .from("tickets")
              .update({ assignee_id: nextManagerId })
              .eq("organization_id", organizationId)
              .eq("id", ticket.id);

            if (!reassignError) {
              autoEscalations += 1;
              escalatedToUserId = nextManagerId;
              await appendTicketSystemMessage({
                supabase,
                organizationId,
                ticketId: ticket.id,
                actorUserId: actorUserId ?? ticket.created_by,
                body: "Ticket auto-escalated and reassigned to manager.",
              });
            }
          }
        }

        const escalatedEventCreated = await insertSlaEvent({
          supabase,
          organizationId,
          ticketId: ticket.id,
          eventType: "auto_escalated",
          dueAt: toIso(resolutionDueAt),
          metadata: {
            escalatedToUserId,
            escalationRole: policy.escalation_role,
          },
        });

        if (escalatedEventCreated) {
          await writeAuditLog({
            supabase,
            organizationId,
            actorUserId,
            action: "ticket.sla.auto_escalated",
            entityType: "ticket",
            entityId: ticket.id,
            targetUserId: escalatedToUserId,
            details: {
              priority: ticket.priority,
              escalationRole: policy.escalation_role,
            },
          });
        }
      }
    } else if (now.getTime() >= resolutionWarningAt.getTime()) {
      const created = await insertSlaEvent({
        supabase,
        organizationId,
        ticketId: ticket.id,
        eventType: "resolution_warning",
        dueAt: toIso(resolutionDueAt),
        metadata: { priority: ticket.priority },
      });
      if (created) {
        warningsCreated += 1;
        const recipients = Array.from(
          new Set([ticket.created_by, ticket.assignee_id].filter(Boolean) as string[]),
        );
        await notifySlaEscalation({
          supabase,
          organizationId,
          ticket,
          recipients,
          title: "SLA warning: resolution due soon",
          body: `Ticket "${ticket.title}" is nearing resolution SLA deadline.`,
        });
      }
    }
  }

  return {
    scanned: rows.length,
    warningsCreated,
    breachesCreated,
    autoEscalations,
  };
}
