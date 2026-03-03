import type { OrganizationRole } from "@/lib/topbar/types";
import type { TicketPriority } from "@/lib/tickets/types";

export type SlaPolicyPriority = TicketPriority;

export type SlaEventType =
  | "first_response_warning"
  | "first_response_breached"
  | "resolution_warning"
  | "resolution_breached"
  | "auto_escalated";

export interface SlaPolicy {
  id: string;
  organization_id: string;
  priority: SlaPolicyPriority;
  first_response_minutes: number;
  resolution_minutes: number;
  warning_minutes: number;
  escalation_role: OrganizationRole;
  auto_escalate: boolean;
  created_at: string;
  updated_at: string;
}

export interface SlaPoliciesResponse {
  activeOrgId: string;
  currentUserId: string;
  policies: SlaPolicy[];
}

export interface SlaCompliancePoint {
  label: string;
  resolved: number;
  breaches: number;
  compliance: number;
}

export interface SlaComplianceResponse {
  activeOrgId: string;
  currentUserId: string;
  range: {
    from: string;
    to: string;
  };
  summary: {
    resolved: number;
    breaches: number;
    compliance: number;
  };
  trend: SlaCompliancePoint[];
}

export interface SlaRunEscalationResult {
  activeOrgId: string;
  scanned: number;
  warningsCreated: number;
  breachesCreated: number;
  autoEscalations: number;
}
