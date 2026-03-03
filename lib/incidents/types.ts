import type { OrganizationRole } from "@/lib/topbar/types";

export type IncidentServiceHealth =
  | "operational"
  | "degraded"
  | "partial_outage"
  | "major_outage"
  | "maintenance";

export type IncidentStatus =
  | "investigating"
  | "identified"
  | "monitoring"
  | "resolved";

export type IncidentSeverity = "critical" | "high" | "medium" | "low";

export interface IncidentActor {
  id: string;
  name: string | null;
  email: string;
  avatar_url: string | null;
}

export interface IncidentService {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  description: string | null;
  current_status: IncidentServiceHealth;
  is_public: boolean;
  display_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface IncidentImpact {
  id: string;
  organization_id: string;
  incident_id: string;
  service_id: string;
  impact_level: IncidentServiceHealth;
  created_at: string;
  service: IncidentService | null;
}

export interface IncidentUpdate {
  id: string;
  organization_id: string;
  incident_id: string;
  message: string;
  status: IncidentStatus | null;
  is_public: boolean;
  created_by: string | null;
  created_at: string;
  actor: IncidentActor | null;
}

export interface IncidentItem {
  id: string;
  organization_id: string;
  title: string;
  summary: string | null;
  status: IncidentStatus;
  severity: IncidentSeverity;
  is_public: boolean;
  started_at: string;
  resolved_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  creator: IncidentActor | null;
  impacts: IncidentImpact[];
  updates: IncidentUpdate[];
}

export interface IncidentsResponse {
  activeOrgId: string;
  organizationSlug?: string | null;
  organizationName?: string | null;
  currentUserId: string;
  currentUserRole: OrganizationRole | null;
  services: IncidentService[];
  incidents: IncidentItem[];
}

export interface PublicStatusIncident {
  id: string;
  title: string;
  summary: string | null;
  status: IncidentStatus;
  severity: IncidentSeverity;
  started_at: string;
  resolved_at: string | null;
  impacts: Array<{
    service_id: string;
    service_name: string;
    impact_level: IncidentServiceHealth;
  }>;
  updates: Array<{
    id: string;
    message: string;
    status: IncidentStatus | null;
    created_at: string;
  }>;
}

export interface PublicStatusService {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  current_status: IncidentServiceHealth;
}

export interface PublicStatusResponse {
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  generated_at: string;
  overall_status: IncidentServiceHealth;
  services: PublicStatusService[];
  incidents: PublicStatusIncident[];
}
