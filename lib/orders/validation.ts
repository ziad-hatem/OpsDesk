import type { OrderPaymentStatus, OrderStatus } from "./types";

const ORDER_STATUSES: OrderStatus[] = [
  "draft",
  "pending",
  "paid",
  "fulfilled",
  "cancelled",
  "refunded",
];

const ORDER_STATUS_SET = new Set<OrderStatus>(ORDER_STATUSES);

const ORDER_PAYMENT_STATUSES: OrderPaymentStatus[] = [
  "unpaid",
  "payment_link_sent",
  "paid",
  "failed",
  "refunded",
  "expired",
  "cancelled",
];

const ORDER_PAYMENT_STATUS_SET = new Set<OrderPaymentStatus>(ORDER_PAYMENT_STATUSES);

export function isOrderStatus(value: unknown): value is OrderStatus {
  if (typeof value !== "string") {
    return false;
  }
  return ORDER_STATUS_SET.has(value as OrderStatus);
}

export function normalizeOrderStatus(
  value: unknown,
  fallback: OrderStatus = "draft",
): OrderStatus {
  return isOrderStatus(value) ? value : fallback;
}

export function isOrderPaymentStatus(value: unknown): value is OrderPaymentStatus {
  if (typeof value !== "string") {
    return false;
  }
  return ORDER_PAYMENT_STATUS_SET.has(value as OrderPaymentStatus);
}

export function normalizeOrderPaymentStatus(
  value: unknown,
  fallback: OrderPaymentStatus = "unpaid",
): OrderPaymentStatus {
  return isOrderPaymentStatus(value) ? value : fallback;
}

export function derivePaymentStatusFromOrderStatus(
  status: OrderStatus,
): OrderPaymentStatus {
  switch (status) {
    case "paid":
    case "fulfilled":
      return "paid";
    case "refunded":
      return "refunded";
    case "cancelled":
      return "cancelled";
    case "draft":
    case "pending":
    default:
      return "unpaid";
  }
}

export function normalizeCurrencyCode(
  value: unknown,
  fallback = "USD",
): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : fallback;
}
