export type TicketStatus = "open" | "pending" | "resolved" | "closed";
export type TicketPriority = "low" | "medium" | "high" | "urgent";
export type TicketTextType = "comment" | "internal_note" | "system";

export interface TicketUser {
  id: string;
  name: string | null;
  email: string;
  avatar_url: string | null;
}

export interface TicketCustomer {
  id: string;
  name: string;
  email: string | null;
}

export interface TicketListItem {
  id: string;
  organization_id: string;
  customer_id: string | null;
  order_id: string | null;
  title: string;
  description: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  assignee_id: string | null;
  created_by: string;
  sla_due_at: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  assignee: TicketUser | null;
  creator: TicketUser | null;
  customer: TicketCustomer | null;
}

export interface TicketText {
  id: string;
  organization_id: string;
  ticket_id: string;
  author_id: string;
  type: TicketTextType;
  body: string;
  created_at: string;
  updated_at: string | null;
  author: TicketUser | null;
}

export interface TicketAttachment {
  id: string;
  organization_id: string;
  ticket_id: string;
  ticket_text_id: string | null;
  file_name: string;
  file_size: number;
  mime_type: string;
  storage_key: string;
  uploaded_by: string;
  created_at: string;
  uploader: TicketUser | null;
}

export interface TicketTextWithAttachments extends TicketText {
  attachments: TicketAttachment[];
}

export interface TicketsListResponse {
  tickets: TicketListItem[];
  assignees: TicketUser[];
  activeOrgId: string;
  currentUserId: string;
}

export interface TicketDetailResponse {
  ticket: TicketListItem;
  texts: TicketTextWithAttachments[];
  attachments: TicketAttachment[];
  assignees: TicketUser[];
  activeOrgId: string;
  currentUserId: string;
}
