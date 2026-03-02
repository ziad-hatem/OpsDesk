import { describe, expect, it } from "vitest";
import {
  isTicketPriority,
  isTicketStatus,
  isTicketTextType,
  normalizeTicketPriority,
  normalizeTicketStatus,
} from "@/lib/tickets/validation";

describe("ticket validation helpers", () => {
  it("recognizes valid ticket statuses", () => {
    expect(isTicketStatus("open")).toBe(true);
    expect(isTicketStatus("pending")).toBe(true);
    expect(isTicketStatus("resolved")).toBe(true);
    expect(isTicketStatus("closed")).toBe(true);
    expect(isTicketStatus("in_progress")).toBe(false);
  });

  it("recognizes valid ticket priorities", () => {
    expect(isTicketPriority("low")).toBe(true);
    expect(isTicketPriority("medium")).toBe(true);
    expect(isTicketPriority("high")).toBe(true);
    expect(isTicketPriority("urgent")).toBe(true);
    expect(isTicketPriority("critical")).toBe(false);
  });

  it("recognizes valid ticket text types", () => {
    expect(isTicketTextType("comment")).toBe(true);
    expect(isTicketTextType("internal_note")).toBe(true);
    expect(isTicketTextType("system")).toBe(true);
    expect(isTicketTextType("reply")).toBe(false);
  });

  it("normalizes status and falls back for invalid values", () => {
    expect(normalizeTicketStatus("closed")).toBe("closed");
    expect(normalizeTicketStatus("unknown", "pending")).toBe("pending");
    expect(normalizeTicketStatus(undefined)).toBe("open");
  });

  it("normalizes priority and falls back for invalid values", () => {
    expect(normalizeTicketPriority("high")).toBe("high");
    expect(normalizeTicketPriority("unknown", "low")).toBe("low");
    expect(normalizeTicketPriority(undefined)).toBe("medium");
  });
});
