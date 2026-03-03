import type { OrganizationRole } from "@/lib/topbar/types";
import type { TicketPriority, TicketStatus } from "@/lib/tickets/types";
import type { OrderPaymentStatus, OrderStatus } from "@/lib/orders/types";
import type { CustomerStatus } from "@/lib/customers/types";
import type { IncidentSeverity, IncidentStatus } from "@/lib/incidents/types";

export const AUTOMATION_ENTITY_TYPES = [
  "ticket",
  "order",
  "customer",
  "incident",
  "portal",
] as const;

export type AutomationEntityType = (typeof AUTOMATION_ENTITY_TYPES)[number];

export const AUTOMATION_ENTITY_TRIGGER_EVENTS = {
  ticket: ["ticket.created", "ticket.updated"],
  order: ["order.created", "order.updated"],
  customer: ["customer.created", "customer.updated"],
  incident: ["incident.created", "incident.updated"],
  portal: [
    "portal.auth_link_requested",
    "portal.auth_verified",
    "portal.ticket_replied",
    "portal.order_payment_started",
  ],
} as const satisfies Record<AutomationEntityType, readonly string[]>;

export type AutomationTriggerEventMap =
  typeof AUTOMATION_ENTITY_TRIGGER_EVENTS;

export type AutomationTriggerEvent =
  AutomationTriggerEventMap[keyof AutomationTriggerEventMap][number];

export function isAutomationEntityType(value: unknown): value is AutomationEntityType {
  return (
    typeof value === "string" &&
    (AUTOMATION_ENTITY_TYPES as readonly string[]).includes(value)
  );
}

export function isAutomationTriggerCompatibleWithEntityType(
  entityType: AutomationEntityType,
  triggerEvent: string,
): triggerEvent is AutomationTriggerEvent {
  return (
    AUTOMATION_ENTITY_TRIGGER_EVENTS[entityType] as readonly string[]
  ).includes(triggerEvent);
}

export type AutomationAssigneeState = "any" | "assigned" | "unassigned";
export type AutomationChangedField =
  | "status"
  | "priority"
  | "assignee_id"
  | "payment_status"
  | "name"
  | "email"
  | "phone"
  | "external_id"
  | "title"
  | "summary"
  | "severity"
  | "is_public";

export type AutomationCondition = {
  priorities?: TicketPriority[];
  statuses?: Array<TicketStatus | OrderStatus | CustomerStatus | IncidentStatus>;
  paymentStatuses?: OrderPaymentStatus[];
  severities?: IncidentSeverity[];
  assigneeState?: AutomationAssigneeState;
  changedFields?: AutomationChangedField[];
};

export type AutomationAction =
  | {
      type: "assign_role";
      role: OrganizationRole;
    }
  | {
      type: "notify_role";
      role: OrganizationRole;
      title?: string | null;
      body?: string | null;
    }
  | {
      type: "add_comment";
      message: string;
    }
  | {
      type: "set_status";
      status: TicketStatus | OrderStatus | CustomerStatus | IncidentStatus;
    }
  | {
      type: "set_priority";
      priority: TicketPriority;
    }
  | {
      type: "set_payment_status";
      paymentStatus: OrderPaymentStatus;
    }
  | {
      type: "set_severity";
      severity: IncidentSeverity;
    };

export interface AutomationRule {
  id: string;
  organization_id: string;
  entity_type: AutomationEntityType;
  name: string;
  description: string | null;
  trigger_event: AutomationTriggerEvent;
  conditions: AutomationCondition;
  actions: AutomationAction[];
  is_enabled: boolean;
  archived_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AutomationRuleRun {
  id: string;
  organization_id: string;
  rule_id: string | null;
  entity_type: AutomationEntityType;
  entity_id: string;
  trigger_event: AutomationTriggerEvent;
  status: "executed" | "skipped" | "failed";
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface AutomationRulesResponse {
  activeOrgId: string;
  currentUserId: string;
  rules: AutomationRule[];
}
