import { describe, expect, it } from "vitest";
import {
  FORGOT_PASSWORD_SUCCESS_MESSAGE,
  normalizeEmail,
} from "@/app/(auth)/forgot-password/forgot-password-flow";

describe("forgot-password-flow helpers", () => {
  it("normalizes email by trimming and lowercasing", () => {
    expect(normalizeEmail("  John.Doe@Acme.COM ")).toBe("john.doe@acme.com");
  });

  it("exports the generic success message", () => {
    expect(FORGOT_PASSWORD_SUCCESS_MESSAGE).toBe(
      "If an account exists for that email, a password reset link has been sent.",
    );
  });
});
