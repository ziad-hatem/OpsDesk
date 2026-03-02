import { describe, expect, it } from "vitest";
import { getPasswordMismatchError } from "@/app/(auth)/register/register-flow";

describe("register-flow helpers", () => {
  it("returns null when passwords match", () => {
    expect(getPasswordMismatchError("secret123", "secret123")).toBeNull();
  });

  it("returns mismatch message when passwords differ", () => {
    expect(getPasswordMismatchError("secret123", "secret321")).toBe(
      "Passwords do not match",
    );
  });
});
