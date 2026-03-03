import type { TicketListItem } from "@/lib/tickets/types";
import type { OrderStatus } from "@/lib/orders/types";
import type { IncidentSeverity, IncidentStatus } from "@/lib/incidents/types";

export type CustomerStatus = "active" | "inactive" | "blocked";
export type CustomerCommunicationChannel = "email" | "chat" | "whatsapp" | "sms";
export type CustomerCommunicationDirection = "inbound" | "outbound";

export interface CustomerActivityActor {
  id: string;
  name: string | null;
  email: string;
  avatar_url: string | null;
}

export interface CustomerActivityItem {
  id: string;
  title: string;
  occurred_at: string;
  actor: CustomerActivityActor | null;
  kind?: "ticket" | "order" | "audit" | "communication" | "incident";
  channel?: CustomerCommunicationChannel | null;
  direction?: CustomerCommunicationDirection | null;
  preview?: string | null;
}

export interface CustomerCommunicationItem {
  id: string;
  customer_id: string;
  channel: CustomerCommunicationChannel;
  direction: CustomerCommunicationDirection;
  subject: string | null;
  body: string;
  preview: string;
  provider: string | null;
  provider_message_id: string | null;
  sender_name: string | null;
  sender_email: string | null;
  sender_phone: string | null;
  recipient_name: string | null;
  recipient_email: string | null;
  recipient_phone: string | null;
  actor: CustomerActivityActor | null;
  ticket_id: string | null;
  order_id: string | null;
  incident_id: string | null;
  occurred_at: string;
  created_at: string;
}

export interface CustomerIncidentSummary {
  id: string;
  title: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  is_public: boolean;
  started_at: string;
  resolved_at: string | null;
}

export interface CustomerOrderListItem {
  id: string;
  order_number: string;
  status: OrderStatus;
  currency: string;
  total_amount: number;
  created_at: string;
  placed_at: string | null;
}

export interface CustomerListItem {
  id: string;
  organization_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: CustomerStatus;
  external_id: string | null;
  created_at: string;
  updated_at: string;
  open_tickets_count: number;
  total_tickets_count: number;
  total_orders_count: number;
  total_revenue_amount: number;
}

export interface CustomersListResponse {
  customers: CustomerListItem[];
  activeOrgId: string;
  currentUserId: string;
}

export interface CustomerDetailResponse {
  customer: CustomerListItem;
  tickets: TicketListItem[];
  orders: CustomerOrderListItem[];
  communications: CustomerCommunicationItem[];
  incidents: CustomerIncidentSummary[];
  activity: CustomerActivityItem[];
  activeOrgId: string;
  currentUserId: string;
}
