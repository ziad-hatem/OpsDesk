import type { OrderStatus } from "@/lib/orders/types";
import type { TicketPriority, TicketStatus } from "@/lib/tickets/types";

export interface DashboardKpis {
  totalRevenueAmount: number;
  openTicketsCount: number;
  slaBreachesCount: number;
}

export interface DashboardChartPoint {
  date: string;
  current: number;
  previous: number;
}

export interface DashboardRecentOrder {
  id: string;
  order_number: string;
  customer_name: string | null;
  total_amount: number;
  currency: string;
  status: OrderStatus;
  created_at: string;
}

export interface DashboardHighPriorityTicket {
  id: string;
  title: string;
  customer_name: string | null;
  priority: TicketPriority;
  status: TicketStatus;
  created_at: string;
}

export interface DashboardResponse {
  kpis: DashboardKpis;
  chart: DashboardChartPoint[];
  recentOrders: DashboardRecentOrder[];
  highPriorityTickets: DashboardHighPriorityTicket[];
  activeOrgId: string;
  currentUserId: string;
  range: {
    from: string;
    to: string;
    previousFrom: string;
    previousTo: string;
  };
}
