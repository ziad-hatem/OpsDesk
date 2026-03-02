import { describe, expect, it } from "vitest";
import {
  isCustomerStatus,
  normalizeCustomerStatus,
} from "@/lib/customers/validation";

describe("customer validation helpers", () => {
  it("recognizes valid customer statuses", () => {
    expect(isCustomerStatus("active")).toBe(true);
    expect(isCustomerStatus("inactive")).toBe(true);
    expect(isCustomerStatus("blocked")).toBe(true);
    expect(isCustomerStatus("archived")).toBe(false);
  });

  it("normalizes customer status with fallback", () => {
    expect(normalizeCustomerStatus("inactive")).toBe("inactive");
    expect(normalizeCustomerStatus("invalid", "blocked")).toBe("blocked");
    expect(normalizeCustomerStatus(undefined)).toBe("active");
  });
});
