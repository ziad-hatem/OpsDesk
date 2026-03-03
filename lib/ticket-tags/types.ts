export interface TicketTag {
  id: string;
  organization_id: string;
  name: string;
  color: string | null;
  created_by: string;
  created_at: string;
}

export interface TicketTagsResponse {
  activeOrgId: string;
  currentUserId: string;
  tags: TicketTag[];
}
