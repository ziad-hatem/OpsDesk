import type { CustomerStatus } from "@/lib/customers/types";

export const CUSTOMER_STATUSES: CustomerStatus[] = [
  "active",
  "inactive",
  "blocked",
];

export function isCustomerStatus(value: string): value is CustomerStatus {
  return CUSTOMER_STATUSES.includes(value as CustomerStatus);
}

export function normalizeCustomerStatus(
  value: string | null | undefined,
  fallback: CustomerStatus = "active",
): CustomerStatus {
  if (!value) {
    return fallback;
  }
  return isCustomerStatus(value) ? value : fallback;
}
