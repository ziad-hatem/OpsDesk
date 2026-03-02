import { describe, expect, it } from "vitest";
import {
  isVerificationCodeValid,
  normalizeVerificationCode,
} from "@/app/(auth)/verify/verify-flow";

describe("verify-flow helpers", () => {
  it("normalizes whitespace around code", () => {
    expect(normalizeVerificationCode(" 123456 ")).toBe("123456");
  });

  it("returns true when codes match", () => {
    expect(isVerificationCodeValid("123456", "123456")).toBe(true);
  });

  it("returns false when provided code is wrong", () => {
    expect(isVerificationCodeValid("000000", "123456")).toBe(false);
  });

  it("returns false when expected code is missing", () => {
    expect(isVerificationCodeValid("123456", "")).toBe(false);
  });
});
