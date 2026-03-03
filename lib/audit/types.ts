export interface AuditLogUser {
  id: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
}

export interface AuditLogItem {
  id: string;
  organization_id: string;
  actor_user_id: string | null;
  action: string;
  action_label: string;
  entity_type: string | null;
  entity_id: string | null;
  target_user_id: string | null;
  source: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
  actor: AuditLogUser | null;
  target: AuditLogUser | null;
}

export interface AuditLogsResponse {
  activeOrgId: string;
  items: AuditLogItem[];
  availableActions: string[];
  availableActors: AuditLogUser[];
  total: number;
  page: number;
  limit: number;
}
