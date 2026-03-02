import type { OrderStatus } from "./types";

const ORDER_STATUSES: OrderStatus[] = [
  "draft",
  "pending",
  "paid",
  "fulfilled",
  "cancelled",
  "refunded",
];

const ORDER_STATUS_SET = new Set<OrderStatus>(ORDER_STATUSES);

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
