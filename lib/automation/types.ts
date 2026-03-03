import type { OrganizationRole } from "@/lib/topbar/types";
import type { TicketPriority, TicketStatus } from "@/lib/tickets/types";
import type { OrderPaymentStatus, OrderStatus } from "@/lib/orders/types";

export type AutomationEntityType = "ticket" | "order";
export type AutomationTriggerEvent =
  | "ticket.created"
  | "ticket.updated"
  | "order.created"
  | "order.updated";
export type AutomationAssigneeState = "any" | "assigned" | "unassigned";
export type AutomationChangedField =
  | "status"
  | "priority"
  | "assignee_id"
  | "payment_status";

export type AutomationCondition = {
  priorities?: TicketPriority[];
  statuses?: Array<TicketStatus | OrderStatus>;
  paymentStatuses?: OrderPaymentStatus[];
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
      status: TicketStatus | OrderStatus;
    }
  | {
      type: "set_priority";
      priority: TicketPriority;
    }
  | {
      type: "set_payment_status";
      paymentStatus: OrderPaymentStatus;
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
