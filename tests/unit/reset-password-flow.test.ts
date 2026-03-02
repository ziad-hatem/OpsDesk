import { describe, expect, it } from "vitest";
import {
  getResetPasswordMismatchError,
  parseRecoveryTokens,
} from "@/app/(auth)/reset-password/reset-password-flow";

describe("reset-password-flow helpers", () => {
  describe("parseRecoveryTokens", () => {
    it("reads access and refresh token from URL hash", () => {
      expect(
        parseRecoveryTokens(
          "",
          "#type=recovery&access_token=access-123&refresh_token=refresh-123",
        ),
      ).toEqual({
        accessToken: "access-123",
        refreshToken: "refresh-123",
      });
    });

    it("reads access and refresh token from query string", () => {
      expect(
        parseRecoveryTokens(
          "?type=recovery&access_token=access-321&refresh_token=refresh-321",
          "",
        ),
      ).toEqual({
        accessToken: "access-321",
        refreshToken: "refresh-321",
      });
    });

    it("returns null when token pair is missing", () => {
      expect(parseRecoveryTokens("?type=recovery&access_token=only-one", "")).toBeNull();
    });

    it("returns null when type is not recovery", () => {
      expect(
        parseRecoveryTokens(
          "?type=magiclink&access_token=a&refresh_token=b",
          "",
        ),
      ).toBeNull();
    });
  });

  describe("getResetPasswordMismatchError", () => {
    it("returns null when passwords match", () => {
      expect(getResetPasswordMismatchError("secret123", "secret123")).toBeNull();
    });

    it("returns an error when passwords differ", () => {
      expect(getResetPasswordMismatchError("secret123", "secret321")).toBe(
        "Passwords do not match",
      );
    });
  });
});
