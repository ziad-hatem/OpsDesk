import type {
  AutomationAction,
  AutomationChangedField,
  AutomationCondition,
  AutomationEntityType,
  AutomationRule,
  AutomationTriggerEvent,
} from "@/lib/automation/types";
import { isOrganizationRole } from "@/lib/team/validation";
import { isTicketPriority, isTicketStatus } from "@/lib/tickets/validation";
import { isMissingTableInSchemaCache } from "@/lib/tickets/errors";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type { OrganizationRole } from "@/lib/topbar/types";
import type { TicketPriority, TicketStatus } from "@/lib/tickets/types";
import {
  derivePaymentStatusFromOrderStatus,
  isOrderPaymentStatus,
  isOrderStatus,
} from "@/lib/orders/validation";
import type { OrderPaymentStatus, OrderStatus } from "@/lib/orders/types";
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

export type OrderAutomationRow = {
  id: string;
  organization_id: string;
  customer_id: string;
  order_number: string;
  status: OrderStatus;
  payment_status: OrderPaymentStatus;
  currency: string;
  subtotal_amount: number;
  tax_amount: number;
  discount_amount: number;
  total_amount: number;
  placed_at: string | null;
  paid_at: string | null;
  fulfilled_at: string | null;
  cancelled_at: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
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
  "order.created",
  "order.updated",
];

const AUTOMATION_CHANGED_FIELDS: AutomationChangedField[] = [
  "status",
  "priority",
  "assignee_id",
  "payment_status",
];

const DEFAULT_TICKET_AUTOMATION_RULES: Array<{
  name: string;
  description: string;
  entity_type: AutomationEntityType;
  trigger_event: AutomationTriggerEvent;
  conditions: AutomationCondition;
  actions: AutomationAction[];
}> = [
  {
    name: "Urgent Unassigned Auto-Assign",
    description:
      "When an urgent ticket is created without an assignee, assign the first active manager and notify manager role.",
    entity_type: "ticket",
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

const DEFAULT_ORDER_AUTOMATION_RULES: Array<{
  name: string;
  description: string;
  entity_type: AutomationEntityType;
  trigger_event: AutomationTriggerEvent;
  conditions: AutomationCondition;
  actions: AutomationAction[];
}> = [
  {
    name: "Pending Order Manager Alert",
    description:
      "When an order is created as pending, notify managers for manual review.",
    entity_type: "order",
    trigger_event: "order.created",
    conditions: {
      statuses: ["pending"],
    },
    actions: [
      {
        type: "notify_role",
        role: "manager",
        title: "Pending order created",
        body: 'Order "{{title}}" requires manager review.',
      },
    ],
  },
];

function getDefaultRulesByEntityType(entityType: AutomationEntityType) {
  if (entityType === "order") {
    return DEFAULT_ORDER_AUTOMATION_RULES;
  }
  return DEFAULT_TICKET_AUTOMATION_RULES;
}

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
    ? raw.statuses.filter(
        (entry): entry is TicketStatus | OrderStatus =>
          isTicketStatus(entry) || isOrderStatus(entry),
      )
    : [];

  const paymentStatuses = Array.isArray(raw.paymentStatuses)
    ? raw.paymentStatuses.filter((entry): entry is OrderPaymentStatus =>
        isOrderPaymentStatus(entry),
      )
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
  if (paymentStatuses.length > 0) {
    result.paymentStatuses = Array.from(new Set(paymentStatuses));
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
      (isTicketStatus(raw.status) || isOrderStatus(raw.status))
    ) {
      actions.push({
        type,
        status: raw.status as TicketStatus | OrderStatus,
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
      continue;
    }

    if (
      type === "set_payment_status" &&
      typeof raw.paymentStatus === "string" &&
      isOrderPaymentStatus(raw.paymentStatus)
    ) {
      actions.push({
        type,
        paymentStatus: raw.paymentStatus,
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
    entityType: AutomationEntityType;
    row: TicketAutomationRow | OrderAutomationRow;
    rule: AutomationRule;
  },
): string {
  const { entityType, row, rule } = params;
  const ticketRow = row as TicketAutomationRow;
  const orderRow = row as OrderAutomationRow;
  const title = entityType === "ticket" ? ticketRow.title : orderRow.order_number;
  const status = row.status;
  const priority = entityType === "ticket" ? ticketRow.priority : "";
  const paymentStatus = entityType === "order" ? orderRow.payment_status : "";
  const assigneeId = entityType === "ticket" ? (ticketRow.assignee_id ?? "unassigned") : "";
  return input
    .replaceAll("{{ticketId}}", row.id)
    .replaceAll("{{orderId}}", row.id)
    .replaceAll("{{title}}", title)
    .replaceAll("{{status}}", status)
    .replaceAll("{{priority}}", priority)
    .replaceAll("{{paymentStatus}}", paymentStatus)
    .replaceAll("{{assigneeId}}", assigneeId)
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
  entityType: AutomationEntityType;
  entityId: string;
  triggerEvent: AutomationTriggerEvent;
  status: "executed" | "skipped" | "failed";
  details?: Record<string, unknown> | null;
}): Promise<void> {
  const {
    supabase,
    organizationId,
    ruleId,
    entityType,
    entityId,
    triggerEvent,
    status,
    details = null,
  } =
    params;

  const { error } = await supabase.from("automation_rule_runs").insert({
    organization_id: organizationId,
    rule_id: ruleId,
    entity_type: entityType,
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
  entityType: AutomationEntityType,
  createdBy: string | null = null,
): Promise<void> {
  const defaults = getDefaultRulesByEntityType(entityType);

  const { data, error } = await supabase
    .from("automation_rules")
    .select("id, name")
    .eq("organization_id", organizationId)
    .eq("entity_type", entityType)
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
  const rowsToInsert = defaults.filter(
    (rule) => !existingNames.has(rule.name),
  ).map((rule) => ({
    organization_id: organizationId,
    entity_type: rule.entity_type,
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
  entityType: AutomationEntityType,
  seedUserId: string | null = null,
  options: { includeArchived?: boolean } = {},
): Promise<AutomationRule[]> {
  await ensureDefaultAutomationRules(supabase, organizationId, entityType, seedUserId);

  let query = supabase
    .from("automation_rules")
    .select(
      "id, organization_id, entity_type, name, description, trigger_event, conditions, actions, is_enabled, archived_at, created_by, created_at, updated_at",
    )
    .eq("organization_id", organizationId)
    .eq("entity_type", entityType);

  if (!options.includeArchived) {
    query = query.is("archived_at", null);
  }

  const { data, error } = await query
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

  if (conditions.paymentStatuses && conditions.paymentStatuses.length > 0) {
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
      if (!isTicketStatus(action.status)) {
        continue;
      }
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

      const title = renderTemplate(titleTemplate, {
        entityType: "ticket",
        row: workingTicket,
        rule,
      });
      const body = renderTemplate(bodyTemplate, {
        entityType: "ticket",
        row: workingTicket,
        rule,
      });

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
      const message = renderTemplate(action.message, {
        entityType: "ticket",
        row: workingTicket,
        rule,
      }).trim();
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

  const rules = await getAutomationRules(
    supabase,
    organizationId,
    "ticket",
    actorUserId,
  );
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
          entityType: "ticket",
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
        entityType: "ticket",
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
        entityType: "ticket",
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

function matchesOrderRuleCondition(params: {
  rule: AutomationRule;
  triggerEvent: AutomationTriggerEvent;
  orderBefore: OrderAutomationRow | null;
  orderAfter: OrderAutomationRow;
  changedFields: Set<AutomationChangedField>;
}): boolean {
  const { rule, triggerEvent, orderBefore, orderAfter, changedFields } = params;
  const conditions = rule.conditions;

  if (
    conditions.statuses &&
    conditions.statuses.length > 0 &&
    !conditions.statuses.includes(orderAfter.status)
  ) {
    return false;
  }

  if (
    conditions.paymentStatuses &&
    conditions.paymentStatuses.length > 0 &&
    !conditions.paymentStatuses.includes(orderAfter.payment_status)
  ) {
    return false;
  }

  if (conditions.priorities && conditions.priorities.length > 0) {
    return false;
  }

  if (conditions.assigneeState && conditions.assigneeState !== "any") {
    return false;
  }

  if (
    triggerEvent === "order.updated" &&
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

  if (!orderBefore && triggerEvent === "order.updated") {
    return false;
  }

  return true;
}

function computeOrderChangedFields(
  orderBefore: OrderAutomationRow | null,
  orderAfter: OrderAutomationRow,
): Set<AutomationChangedField> {
  const changedFields = new Set<AutomationChangedField>();
  if (!orderBefore) {
    return changedFields;
  }

  if (orderBefore.status !== orderAfter.status) {
    changedFields.add("status");
  }
  if (orderBefore.payment_status !== orderAfter.payment_status) {
    changedFields.add("payment_status");
  }

  return changedFields;
}

async function applyOrderRule(params: {
  supabase: SupabaseClient;
  organizationId: string;
  actorUserId: string | null;
  rule: AutomationRule;
  triggerEvent: AutomationTriggerEvent;
  order: OrderAutomationRow;
}): Promise<{
  order: OrderAutomationRow;
  executedActions: Array<Record<string, unknown>>;
}> {
  const { supabase, organizationId, actorUserId, rule, triggerEvent } = params;
  let workingOrder = { ...params.order };
  const orderPatch: Partial<OrderAutomationRow> = {};
  const executedActions: Array<Record<string, unknown>> = [];

  for (const action of rule.actions) {
    if (action.type === "set_status") {
      if (!isOrderStatus(action.status)) {
        continue;
      }
      if (workingOrder.status === action.status) {
        continue;
      }
      const fromStatus = workingOrder.status;
      orderPatch.status = action.status;
      orderPatch.payment_status = derivePaymentStatusFromOrderStatus(action.status);
      workingOrder.status = action.status;
      workingOrder.payment_status = derivePaymentStatusFromOrderStatus(action.status);

      const { error: statusEventError } = await supabase.from("order_status_events").insert({
        organization_id: organizationId,
        order_id: workingOrder.id,
        from_status: fromStatus,
        to_status: action.status,
        actor_user_id: actorUserId,
        reason: `Automation rule: ${rule.name}`,
      });

      if (statusEventError && !isMissingTableInSchemaCache(statusEventError, "order_status_events")) {
        throw new Error(`Failed to write automation order status event: ${statusEventError.message}`);
      }

      executedActions.push({
        type: action.type,
        status: action.status,
      });
      continue;
    }

    if (action.type === "set_payment_status") {
      if (workingOrder.payment_status === action.paymentStatus) {
        continue;
      }
      orderPatch.payment_status = action.paymentStatus;
      workingOrder.payment_status = action.paymentStatus;
      executedActions.push({
        type: action.type,
        paymentStatus: action.paymentStatus,
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
        `Order "{{title}}" matched automation rule "{{ruleName}}" on ${triggerEvent}.`;

      const title = renderTemplate(titleTemplate, {
        entityType: "order",
        row: workingOrder,
        rule,
      });
      const body = renderTemplate(bodyTemplate, {
        entityType: "order",
        row: workingOrder,
        rule,
      });

      await insertAppNotifications(
        supabase,
        recipients.map((recipientId) => ({
          userId: recipientId,
          organizationId,
          type: "alert",
          title,
          body,
          entityType: "order",
          entityId: workingOrder.id,
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
      const rendered = renderTemplate(action.message, {
        entityType: "order",
        row: workingOrder,
        rule,
      }).trim();
      if (!rendered) {
        continue;
      }

      const prefix = workingOrder.notes ? `${workingOrder.notes}\n` : "";
      const nextNotes = `${prefix}[Automation] ${rendered}`.slice(0, 4000);
      orderPatch.notes = nextNotes;
      workingOrder.notes = nextNotes;

      executedActions.push({
        type: action.type,
        message: rendered,
      });
      continue;
    }
  }

  if (Object.keys(orderPatch).length > 0) {
    const { data: updatedOrder, error: updateError } = await supabase
      .from("orders")
      .update(orderPatch)
      .eq("organization_id", organizationId)
      .eq("id", workingOrder.id)
      .select(
        "id, organization_id, customer_id, order_number, status, payment_status, currency, subtotal_amount, tax_amount, discount_amount, total_amount, placed_at, paid_at, fulfilled_at, cancelled_at, notes, created_by, created_at, updated_at",
      )
      .maybeSingle<OrderAutomationRow>();

    if (updateError) {
      if (isMissingTableInSchemaCache(updateError, "orders")) {
        throw new Error("Automation engine cannot update order because table public.orders is missing");
      }
      throw new Error(`Failed to update order from automation rule: ${updateError.message}`);
    }

    if (updatedOrder) {
      workingOrder = updatedOrder;
    }
  }

  return {
    order: workingOrder,
    executedActions,
  };
}

export async function runOrderAutomationEngine(params: {
  supabase: SupabaseClient;
  organizationId: string;
  actorUserId?: string | null;
  triggerEvent: "order.created" | "order.updated";
  orderBefore?: OrderAutomationRow | null;
  orderAfter: OrderAutomationRow;
}): Promise<{
  order: OrderAutomationRow;
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
    orderBefore = null,
    orderAfter,
  } = params;

  const rules = await getAutomationRules(
    supabase,
    organizationId,
    "order",
    actorUserId,
  );
  if (!rules.length) {
    return {
      order: orderAfter,
      scanned: 0,
      matched: 0,
      executed: 0,
      failed: 0,
    };
  }

  const changedFields = computeOrderChangedFields(orderBefore, orderAfter);
  let workingOrder = { ...orderAfter };
  let matched = 0;
  let executed = 0;
  let failed = 0;

  for (const rule of rules) {
    if (!rule.is_enabled || rule.entity_type !== "order" || rule.trigger_event !== triggerEvent) {
      continue;
    }

    const isMatch = matchesOrderRuleCondition({
      rule,
      triggerEvent,
      orderBefore,
      orderAfter: workingOrder,
      changedFields,
    });
    if (!isMatch) {
      continue;
    }

    matched += 1;

    try {
      const result = await applyOrderRule({
        supabase,
        organizationId,
        actorUserId,
        rule,
        triggerEvent,
        order: workingOrder,
      });

      workingOrder = result.order;
      const executedActions = result.executedActions;
      if (executedActions.length === 0) {
        await insertRuleRun({
          supabase,
          organizationId,
          ruleId: rule.id,
          entityType: "order",
          entityId: workingOrder.id,
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
        entityType: "order",
        entityId: workingOrder.id,
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
        entityType: "order",
        entityId: workingOrder.id,
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
        entityType: "order",
        entityId: workingOrder.id,
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
    order: workingOrder,
    scanned: rules.length,
    matched,
    executed,
    failed,
  };
}
