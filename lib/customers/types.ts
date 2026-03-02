import type { TicketListItem } from "@/lib/tickets/types";
import type { OrderStatus } from "@/lib/orders/types";

export type CustomerStatus = "active" | "inactive" | "blocked";

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
  activity: CustomerActivityItem[];
  activeOrgId: string;
  currentUserId: string;
}
