import { describe, expect, it } from "vitest";
import {
  isOrderStatus,
  normalizeCurrencyCode,
  normalizeOrderStatus,
} from "@/lib/orders/validation";

describe("order validation helpers", () => {
  it("recognizes valid order statuses", () => {
    expect(isOrderStatus("draft")).toBe(true);
    expect(isOrderStatus("pending")).toBe(true);
    expect(isOrderStatus("paid")).toBe(true);
    expect(isOrderStatus("fulfilled")).toBe(true);
    expect(isOrderStatus("cancelled")).toBe(true);
    expect(isOrderStatus("refunded")).toBe(true);
    expect(isOrderStatus("completed")).toBe(false);
  });

  it("normalizes order status with fallback", () => {
    expect(normalizeOrderStatus("paid")).toBe("paid");
    expect(normalizeOrderStatus("invalid", "cancelled")).toBe("cancelled");
    expect(normalizeOrderStatus(undefined)).toBe("draft");
  });

  it("normalizes currency codes", () => {
    expect(normalizeCurrencyCode("usd")).toBe("USD");
    expect(normalizeCurrencyCode(" eur ")).toBe("EUR");
    expect(normalizeCurrencyCode("US")).toBe("USD");
    expect(normalizeCurrencyCode("USDT")).toBe("USD");
    expect(normalizeCurrencyCode(undefined, "EUR")).toBe("EUR");
  });
});
