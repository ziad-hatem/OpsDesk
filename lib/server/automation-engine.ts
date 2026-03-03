import type {
  AutomationAction,
  AutomationChangedField,
  AutomationCondition,
  AutomationRule,
  AutomationTriggerEvent,
} from "@/lib/automation/types";
import { isOrganizationRole } from "@/lib/team/validation";
import { isTicketPriority, isTicketStatus } from "@/lib/tickets/validation";
import { isMissingTableInSchemaCache } from "@/lib/tickets/errors";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type { OrganizationRole } from "@/lib/topbar/types";
import type { TicketPriority, TicketStatus } from "@/lib/tickets/types";
import { getUniqueRecipientIds, insertAppNotifications } from "@/lib/server/notifications";
import { writeAuditLog } from "@/lib/server/audit-logs";

type SupabaseClient = ReturnType<typeof createSupabaseAdminClient>;

export type TicketAutomationRow = {
  id: string;
  organization_id: string;
  customer_id?: string | null;
  order_id?: string | null;
  title: string;
  description?: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  assignee_id: string | null;
  created_by: string;
  sla_due_at?: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
};

type AutomationRuleRow = Omit<AutomationRule, "conditions" | "actions"> & {
  conditions: unknown;
  actions: unknown;
};

type MembershipRow = {
  user_id: string;
  role: OrganizationRole;
  status?: "active" | "suspended" | null;
};

type MembershipFallbackRow = Omit<MembershipRow, "status">;

const AUTOMATION_TRIGGER_EVENTS: AutomationTriggerEvent[] = [
  "ticket.created",
  "ticket.updated",
];

const AUTOMATION_CHANGED_FIELDS: AutomationChangedField[] = [
  "status",
  "priority",
  "assignee_id",
];

const DEFAULT_TICKET_AUTOMATION_RULES: Array<{
  name: string;
  description: string;
  trigger_event: AutomationTriggerEvent;
  conditions: AutomationCondition;
  actions: AutomationAction[];
}> = [
  {
    name: "Urgent Unassigned Auto-Assign",
    description:
      "When an urgent ticket is created without an assignee, assign the first active manager and notify manager role.",
    trigger_event: "ticket.created",
    conditions: {
      priorities: ["urgent"],
      assigneeState: "unassigned",
    },
    actions: [
      {
        type: "assign_role",
        role: "manager",
      },
      {
        type: "notify_role",
        role: "manager",
        title: "Urgent ticket auto-assigned",
        body: 'Ticket "{{title}}" was auto-assigned by rule "{{ruleName}}".',
      },
      {
        type: "add_comment",
        message: "Automation applied: ticket auto-assigned to manager.",
      },
    ],
  },
];

function isMissingAutomationRulesTable(error: { message?: string } | null | undefined): boolean {
  const message = (error?.message ?? "").toLowerCase();
  if (!message) {
    return false;
  }

  return (
    message.includes("automation_rules") &&
    (message.includes("schema cache") || message.includes("does not exist"))
  );
}

function isMissingAutomationRuleRunsTable(error: { message?: string } | null | undefined): boolean {
  const message = (error?.message ?? "").toLowerCase();
  if (!message) {
    return false;
  }

  return (
    message.includes("automation_rule_runs") &&
    (message.includes("schema cache") || message.includes("does not exist"))
  );
}

function isAutomationAssigneeState(value: unknown): value is "any" | "assigned" | "unassigned" {
  return value === "any" || value === "assigned" || value === "unassigned";
}

function isAutomationChangedField(value: unknown): value is AutomationChangedField {
  return (
    typeof value === "string" &&
    AUTOMATION_CHANGED_FIELDS.includes(value as AutomationChangedField)
  );
}

export function isAutomationTriggerEvent(value: unknown): value is AutomationTriggerEvent {
  return (
    typeof value === "string" &&
    AUTOMATION_TRIGGER_EVENTS.includes(value as AutomationTriggerEvent)
  );
}

export function normalizeAutomationConditions(value: unknown): AutomationCondition {
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  const priorities = Array.isArray(raw.priorities)
    ? raw.priorities.filter((entry): entry is TicketPriority => isTicketPriority(entry))
    : [];

  const statuses = Array.isArray(raw.statuses)
    ? raw.statuses.filter((entry): entry is TicketStatus => isTicketStatus(entry))
    : [];

  const changedFields = Array.isArray(raw.changedFields)
    ? raw.changedFields.filter((entry): entry is AutomationChangedField =>
        isAutomationChangedField(entry),
      )
    : [];

  const assigneeState = isAutomationAssigneeState(raw.assigneeState)
    ? raw.assigneeState
    : "any";

  const result: AutomationCondition = {
    assigneeState,
  };

  if (priorities.length > 0) {
    result.priorities = Array.from(new Set(priorities));
  }
  if (statuses.length > 0) {
    result.statuses = Array.from(new Set(statuses));
  }
  if (changedFields.length > 0) {
    result.changedFields = Array.from(new Set(changedFields));
  }

  return result;
}

export function normalizeAutomationActions(value: unknown): AutomationAction[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const actions: AutomationAction[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }

    const raw = entry as Record<string, unknown>;
    const type = raw.type;
    if (type === "assign_role" && isOrganizationRole(raw.role)) {
      actions.push({
        type,
        role: raw.role,
      });
      continue;
    }

    if (type === "notify_role" && isOrganizationRole(raw.role)) {
      actions.push({
        type,
        role: raw.role,
        title: typeof raw.title === "string" ? raw.title.trim() : null,
        body: typeof raw.body === "string" ? raw.body.trim() : null,
      });
      continue;
    }

    if (type === "add_comment") {
      const message = typeof raw.message === "string" ? raw.message.trim() : "";
      if (message) {
        actions.push({
          type,
          message: message.slice(0, 800),
        });
      }
      continue;
    }

    if (
      type === "set_status" &&
      typeof raw.status === "string" &&
      isTicketStatus(raw.status)
    ) {
      actions.push({
        type,
        status: raw.status,
      });
      continue;
    }

    if (
      type === "set_priority" &&
      typeof raw.priority === "string" &&
      isTicketPriority(raw.priority)
    ) {
      actions.push({
        type,
        priority: raw.priority,
      });
    }
  }

  return actions;
}

function normalizeAutomationRuleRow(row: AutomationRuleRow): AutomationRule {
  return {
    ...row,
    conditions: normalizeAutomationConditions(row.conditions),
    actions: normalizeAutomationActions(row.actions),
  };
}

function renderTemplate(
  input: string,
  params: {
    ticket: TicketAutomationRow;
    rule: AutomationRule;
  },
): string {
  const { ticket, rule } = params;
  return input
    .replaceAll("{{ticketId}}", ticket.id)
    .replaceAll("{{title}}", ticket.title)
    .replaceAll("{{status}}", ticket.status)
    .replaceAll("{{priority}}", ticket.priority)
    .replaceAll("{{assigneeId}}", ticket.assignee_id ?? "unassigned")
    .replaceAll("{{ruleName}}", rule.name);
}

async function loadRoleMemberIds(params: {
  supabase: SupabaseClient;
  organizationId: string;
  role: OrganizationRole;
}): Promise<string[]> {
  const { supabase, organizationId, role } = params;

  const membershipsWithStatus = await supabase
    .from("organization_memberships")
    .select("user_id, role, status")
    .eq("organization_id", organizationId)
    .eq("role", role)
    .eq("status", "active")
    .returns<MembershipRow[]>();

  let memberships = membershipsWithStatus.data ?? [];
  let membershipsError = membershipsWithStatus.error;

  const isMissingStatusColumn =
    membershipsError?.message?.toLowerCase().includes("organization_memberships.status") ?? false;
  if (membershipsError && isMissingStatusColumn) {
    const fallback = await supabase
      .from("organization_memberships")
      .select("user_id, role")
      .eq("organization_id", organizationId)
      .eq("role", role)
      .returns<MembershipFallbackRow[]>();

    memberships = (fallback.data ?? []).map((row) => ({
      ...row,
      status: "active",
    }));
    membershipsError = fallback.error;
  }

  if (membershipsError) {
    return [];
  }

  return Array.from(new Set(memberships.map((row) => row.user_id)));
}

async function insertRuleRun(params: {
  supabase: SupabaseClient;
  organizationId: string;
  ruleId: string | null;
  entityId: string;
  triggerEvent: AutomationTriggerEvent;
  status: "executed" | "skipped" | "failed";
  details?: Record<string, unknown> | null;
}): Promise<void> {
  const { supabase, organizationId, ruleId, entityId, triggerEvent, status, details = null } =
    params;

  const { error } = await supabase.from("automation_rule_runs").insert({
    organization_id: organizationId,
    rule_id: ruleId,
    entity_type: "ticket",
    entity_id: entityId,
    trigger_event: triggerEvent,
    status,
    details,
  });

  if (
    error &&
    !isMissingAutomationRuleRunsTable(error) &&
    !isMissingTableInSchemaCache(error, "automation_rule_runs")
  ) {
    console.error(`Failed to insert automation rule run: ${error.message}`);
  }
}

export async function ensureDefaultAutomationRules(
  supabase: SupabaseClient,
  organizationId: string,
  createdBy: string | null = null,
): Promise<void> {
  const { data, error } = await supabase
    .from("automation_rules")
    .select("id, name")
    .eq("organization_id", organizationId)
    .eq("entity_type", "ticket")
    .returns<Array<{ id: string; name: string }>>();

  if (error) {
    if (
      !isMissingAutomationRulesTable(error) &&
      !isMissingTableInSchemaCache(error, "automation_rules")
    ) {
      console.error(`Failed to load automation rules: ${error.message}`);
    }
    return;
  }

  const existingNames = new Set((data ?? []).map((row) => row.name));
  const rowsToInsert = DEFAULT_TICKET_AUTOMATION_RULES.filter(
    (rule) => !existingNames.has(rule.name),
  ).map((rule) => ({
    organization_id: organizationId,
    entity_type: "ticket",
    name: rule.name,
    description: rule.description,
    trigger_event: rule.trigger_event,
    conditions: rule.conditions,
    actions: rule.actions,
    is_enabled: true,
    created_by: createdBy,
  }));

  if (!rowsToInsert.length) {
    return;
  }

  const { error: insertError } = await supabase.from("automation_rules").insert(rowsToInsert);
  if (
    insertError &&
    !isMissingAutomationRulesTable(insertError) &&
    !isMissingTableInSchemaCache(insertError, "automation_rules")
  ) {
    console.error(`Failed to create default automation rules: ${insertError.message}`);
  }
}

export async function getAutomationRules(
  supabase: SupabaseClient,
  organizationId: string,
  seedUserId: string | null = null,
): Promise<AutomationRule[]> {
  await ensureDefaultAutomationRules(supabase, organizationId, seedUserId);

  const { data, error } = await supabase
    .from("automation_rules")
    .select(
      "id, organization_id, entity_type, name, description, trigger_event, conditions, actions, is_enabled, created_by, created_at, updated_at",
    )
    .eq("organization_id", organizationId)
    .eq("entity_type", "ticket")
    .order("created_at", { ascending: true })
    .returns<AutomationRuleRow[]>();

  if (error) {
    if (
      !isMissingAutomationRulesTable(error) &&
      !isMissingTableInSchemaCache(error, "automation_rules")
    ) {
      console.error(`Failed to load automation rules: ${error.message}`);
    }
    return [];
  }

  return (data ?? []).map(normalizeAutomationRuleRow);
}

function matchesRuleCondition(params: {
  rule: AutomationRule;
  triggerEvent: AutomationTriggerEvent;
  ticketBefore: TicketAutomationRow | null;
  ticketAfter: TicketAutomationRow;
  changedFields: Set<AutomationChangedField>;
}): boolean {
  const { rule, triggerEvent, ticketBefore, ticketAfter, changedFields } = params;
  const conditions = rule.conditions;

  if (
    conditions.priorities &&
    conditions.priorities.length > 0 &&
    !conditions.priorities.includes(ticketAfter.priority)
  ) {
    return false;
  }

  if (
    conditions.statuses &&
    conditions.statuses.length > 0 &&
    !conditions.statuses.includes(ticketAfter.status)
  ) {
    return false;
  }

  const assigneeState = conditions.assigneeState ?? "any";
  if (assigneeState === "assigned" && !ticketAfter.assignee_id) {
    return false;
  }
  if (assigneeState === "unassigned" && Boolean(ticketAfter.assignee_id)) {
    return false;
  }

  if (
    triggerEvent === "ticket.updated" &&
    conditions.changedFields &&
    conditions.changedFields.length > 0
  ) {
    const hasMatchedChangedField = conditions.changedFields.some((field) =>
      changedFields.has(field),
    );
    if (!hasMatchedChangedField) {
      return false;
    }
  }

  if (!ticketBefore && triggerEvent === "ticket.updated") {
    return false;
  }

  return true;
}

function computeChangedFields(
  ticketBefore: TicketAutomationRow | null,
  ticketAfter: TicketAutomationRow,
): Set<AutomationChangedField> {
  const changedFields = new Set<AutomationChangedField>();
  if (!ticketBefore) {
    return changedFields;
  }

  if (ticketBefore.status !== ticketAfter.status) {
    changedFields.add("status");
  }
  if (ticketBefore.priority !== ticketAfter.priority) {
    changedFields.add("priority");
  }
  if (ticketBefore.assignee_id !== ticketAfter.assignee_id) {
    changedFields.add("assignee_id");
  }

  return changedFields;
}

async function applyTicketRule(params: {
  supabase: SupabaseClient;
  organizationId: string;
  actorUserId: string | null;
  rule: AutomationRule;
  triggerEvent: AutomationTriggerEvent;
  ticket: TicketAutomationRow;
}): Promise<{
  ticket: TicketAutomationRow;
  executedActions: Array<Record<string, unknown>>;
}> {
  const { supabase, organizationId, actorUserId, rule, triggerEvent } = params;
  let workingTicket = { ...params.ticket };
  const ticketPatch: Partial<TicketAutomationRow> = {};
  const executedActions: Array<Record<string, unknown>> = [];
  const systemAuthorId = actorUserId ?? workingTicket.created_by;

  for (const action of rule.actions) {
    if (action.type === "assign_role") {
      const roleMembers = await loadRoleMemberIds({
        supabase,
        organizationId,
        role: action.role,
      });
      if (!roleMembers.length) {
        continue;
      }
      const nextAssigneeId =
        roleMembers.find((memberId) => memberId !== workingTicket.assignee_id) ?? roleMembers[0];
      if (!nextAssigneeId || nextAssigneeId === workingTicket.assignee_id) {
        continue;
      }
      ticketPatch.assignee_id = nextAssigneeId;
      workingTicket.assignee_id = nextAssigneeId;
      executedActions.push({
        type: action.type,
        role: action.role,
        assigneeId: nextAssigneeId,
      });
      continue;
    }

    if (action.type === "set_status") {
      if (workingTicket.status === action.status) {
        continue;
      }
      ticketPatch.status = action.status;
      workingTicket.status = action.status;
      executedActions.push({
        type: action.type,
        status: action.status,
      });
      continue;
    }

    if (action.type === "set_priority") {
      if (workingTicket.priority === action.priority) {
        continue;
      }
      ticketPatch.priority = action.priority;
      workingTicket.priority = action.priority;
      executedActions.push({
        type: action.type,
        priority: action.priority,
      });
      continue;
    }

    if (action.type === "notify_role") {
      const roleMembers = await loadRoleMemberIds({
        supabase,
        organizationId,
        role: action.role,
      });
      const recipients = getUniqueRecipientIds(roleMembers, actorUserId ?? "__system__");
      if (!recipients.length) {
        continue;
      }

      const titleTemplate = action.title?.trim() || `Automation: ${rule.name}`;
      const bodyTemplate =
        action.body?.trim() ||
        `Ticket "{{title}}" matched automation rule "{{ruleName}}" on ${triggerEvent}.`;

      const title = renderTemplate(titleTemplate, { ticket: workingTicket, rule });
      const body = renderTemplate(bodyTemplate, { ticket: workingTicket, rule });

      await insertAppNotifications(
        supabase,
        recipients.map((recipientId) => ({
          userId: recipientId,
          organizationId,
          type: "alert",
          title,
          body,
          entityType: "ticket",
          entityId: workingTicket.id,
        })),
      );

      executedActions.push({
        type: action.type,
        role: action.role,
        recipients: recipients.length,
      });
      continue;
    }

    if (action.type === "add_comment") {
      const message = renderTemplate(action.message, { ticket: workingTicket, rule }).trim();
      if (!message) {
        continue;
      }

      const { error } = await supabase.from("ticket_texts").insert({
        organization_id: organizationId,
        ticket_id: workingTicket.id,
        author_id: systemAuthorId,
        type: "system",
        body: message,
      });

      if (error && !isMissingTableInSchemaCache(error, "ticket_texts")) {
        throw new Error(`Failed to append automation comment: ${error.message}`);
      }

      if (!error) {
        executedActions.push({
          type: action.type,
          message,
        });
      }
    }
  }

  if (Object.keys(ticketPatch).length > 0) {
    const { data: updatedTicket, error: updateError } = await supabase
      .from("tickets")
      .update(ticketPatch)
      .eq("organization_id", organizationId)
      .eq("id", workingTicket.id)
      .select(
        "id, organization_id, customer_id, order_id, title, description, status, priority, assignee_id, created_by, sla_due_at, created_at, updated_at, closed_at",
      )
      .maybeSingle<TicketAutomationRow>();

    if (updateError) {
      if (isMissingTableInSchemaCache(updateError, "tickets")) {
        throw new Error("Automation engine cannot update ticket because table public.tickets is missing");
      }
      throw new Error(`Failed to update ticket from automation rule: ${updateError.message}`);
    }

    if (updatedTicket) {
      workingTicket = updatedTicket;
    }
  }

  return {
    ticket: workingTicket,
    executedActions,
  };
}

export async function runTicketAutomationEngine(params: {
  supabase: SupabaseClient;
  organizationId: string;
  actorUserId?: string | null;
  triggerEvent: AutomationTriggerEvent;
  ticketBefore?: TicketAutomationRow | null;
  ticketAfter: TicketAutomationRow;
}): Promise<{
  ticket: TicketAutomationRow;
  scanned: number;
  matched: number;
  executed: number;
  failed: number;
}> {
  const {
    supabase,
    organizationId,
    actorUserId = null,
    triggerEvent,
    ticketBefore = null,
    ticketAfter,
  } = params;

  const rules = await getAutomationRules(supabase, organizationId, actorUserId);
  if (!rules.length) {
    return {
      ticket: ticketAfter,
      scanned: 0,
      matched: 0,
      executed: 0,
      failed: 0,
    };
  }

  const changedFields = computeChangedFields(ticketBefore, ticketAfter);
  let workingTicket = { ...ticketAfter };
  let matched = 0;
  let executed = 0;
  let failed = 0;

  for (const rule of rules) {
    if (!rule.is_enabled || rule.entity_type !== "ticket" || rule.trigger_event !== triggerEvent) {
      continue;
    }

    const isMatch = matchesRuleCondition({
      rule,
      triggerEvent,
      ticketBefore,
      ticketAfter: workingTicket,
      changedFields,
    });
    if (!isMatch) {
      continue;
    }

    matched += 1;

    try {
      const result = await applyTicketRule({
        supabase,
        organizationId,
        actorUserId,
        rule,
        triggerEvent,
        ticket: workingTicket,
      });

      workingTicket = result.ticket;
      const executedActions = result.executedActions;
      if (executedActions.length === 0) {
        await insertRuleRun({
          supabase,
          organizationId,
          ruleId: rule.id,
          entityId: workingTicket.id,
          triggerEvent,
          status: "skipped",
          details: {
            reason: "matched_without_effect",
          },
        });
        continue;
      }

      executed += 1;

      await insertRuleRun({
        supabase,
        organizationId,
        ruleId: rule.id,
        entityId: workingTicket.id,
        triggerEvent,
        status: "executed",
        details: {
          actions: executedActions,
        },
      });

      await writeAuditLog({
        supabase,
        organizationId,
        actorUserId,
        action: "automation.rule.executed",
        entityType: "ticket",
        entityId: workingTicket.id,
        details: {
          ruleId: rule.id,
          ruleName: rule.name,
          triggerEvent,
          actions: executedActions,
        },
      });
    } catch (error: unknown) {
      failed += 1;
      const message = error instanceof Error ? error.message : "Unknown automation error";

      await insertRuleRun({
        supabase,
        organizationId,
        ruleId: rule.id,
        entityId: workingTicket.id,
        triggerEvent,
        status: "failed",
        details: {
          error: message,
        },
      });

      console.error(`Automation rule failed (${rule.name}): ${message}`);
    }
  }

  return {
    ticket: workingTicket,
    scanned: rules.length,
    matched,
    executed,
    failed,
  };
}
