import type { OrderPaymentStatus, OrderStatus } from "@/lib/orders/types";
import type { TicketAttachment, TicketPriority, TicketStatus, TicketTextWithAttachments } from "@/lib/tickets/types";

export interface PortalCustomer {
  id: string;
  organization_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: "active" | "inactive" | "blocked";
}

export interface PortalOrganization {
  id: string;
  name: string;
}

export interface PortalTicketSummary {
  id: string;
  organization_id: string;
  customer_id: string | null;
  order_id: string | null;
  title: string;
  description: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  latest_message_at: string | null;
  attachments_count: number;
}

export interface PortalOrderSummary {
  id: string;
  organization_id: string;
  customer_id: string;
  order_number: string;
  status: OrderStatus;
  payment_status: OrderPaymentStatus;
  currency: string;
  total_amount: number;
  created_at: string;
  paid_at: string | null;
  payment_link_url: string | null;
}

export interface PortalOverviewResponse {
  organization: PortalOrganization;
  customer: PortalCustomer;
  tickets: PortalTicketSummary[];
  orders: PortalOrderSummary[];
}

export interface PortalTicketDetail {
  ticket: PortalTicketSummary;
  texts: TicketTextWithAttachments[];
  attachments: TicketAttachment[];
}

