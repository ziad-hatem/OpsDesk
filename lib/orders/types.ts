export type OrderStatus =
  | "draft"
  | "pending"
  | "paid"
  | "fulfilled"
  | "cancelled"
  | "refunded";

export type OrderPaymentStatus =
  | "unpaid"
  | "payment_link_sent"
  | "paid"
  | "failed"
  | "refunded"
  | "expired"
  | "cancelled";

export interface OrderUser {
  id: string;
  name: string | null;
  email: string;
  avatar_url: string | null;
}

export interface OrderCustomer {
  id: string;
  name: string;
  email: string | null;
}

export interface OrderListItem {
  id: string;
  organization_id: string;
  customer_id: string;
  order_number: string;
  status: OrderStatus;
  payment_status: OrderPaymentStatus;
  currency: string;
  subtotal_amount: number;
  tax_amount: number;
  discount_amount: number;
  total_amount: number;
  placed_at: string | null;
  paid_at: string | null;
  fulfilled_at: string | null;
  cancelled_at: string | null;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  payment_link_url: string | null;
  payment_link_sent_at: string | null;
  payment_completed_at: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  customer: OrderCustomer | null;
  creator: OrderUser | null;
}

export interface OrderItem {
  id: string;
  organization_id: string;
  order_id: string;
  sku: string | null;
  name: string;
  quantity: number;
  unit_price_amount: number;
  total_amount: number;
  created_at: string;
}

export interface OrderStatusEvent {
  id: string;
  organization_id: string;
  order_id: string;
  from_status: OrderStatus;
  to_status: OrderStatus;
  actor_user_id: string | null;
  reason: string | null;
  created_at: string;
  actor: OrderUser | null;
}

export interface OrderAttachment {
  id: string;
  organization_id: string;
  order_id: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  storage_key: string;
  uploaded_by: string;
  created_at: string;
  uploader: OrderUser | null;
}

export interface OrdersListResponse {
  orders: OrderListItem[];
  activeOrgId: string;
  currentUserId: string;
}

export interface OrderDetailResponse {
  order: OrderListItem;
  items: OrderItem[];
  attachments: OrderAttachment[];
  statusEvents: OrderStatusEvent[];
  activeOrgId: string;
  currentUserId: string;
}
