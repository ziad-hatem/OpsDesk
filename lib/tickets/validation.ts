import type { TicketPriority, TicketStatus, TicketTextType } from "@/lib/tickets/types";

export const TICKET_STATUSES: TicketStatus[] = [
  "open",
  "pending",
  "resolved",
  "closed",
];

export const TICKET_PRIORITIES: TicketPriority[] = [
  "low",
  "medium",
  "high",
  "urgent",
];

export const TICKET_TEXT_TYPES: TicketTextType[] = [
  "comment",
  "internal_note",
  "system",
];

export function isTicketStatus(value: string): value is TicketStatus {
  return TICKET_STATUSES.includes(value as TicketStatus);
}

export function isTicketPriority(value: string): value is TicketPriority {
  return TICKET_PRIORITIES.includes(value as TicketPriority);
}

export function isTicketTextType(value: string): value is TicketTextType {
  return TICKET_TEXT_TYPES.includes(value as TicketTextType);
}

export function normalizeTicketStatus(
  value: string | null | undefined,
  fallback: TicketStatus = "open",
): TicketStatus {
  if (!value) {
    return fallback;
  }
  return isTicketStatus(value) ? value : fallback;
}

export function normalizeTicketPriority(
  value: string | null | undefined,
  fallback: TicketPriority = "medium",
): TicketPriority {
  if (!value) {
    return fallback;
  }
  return isTicketPriority(value) ? value : fallback;
}
