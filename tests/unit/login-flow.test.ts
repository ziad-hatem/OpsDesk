import { describe, expect, it } from "vitest";
import { hasVerifiedQuery, mapLoginError } from "@/app/(auth)/login/login-flow";

describe("login-flow helpers", () => {
  describe("hasVerifiedQuery", () => {
    it("returns true when verified=true is present", () => {
      expect(hasVerifiedQuery("?verified=true")).toBe(true);
      expect(hasVerifiedQuery("?foo=bar&verified=true")).toBe(true);
    });

    it("returns false for any non-true value", () => {
      expect(hasVerifiedQuery("?verified=false")).toBe(false);
      expect(hasVerifiedQuery("?verified=1")).toBe(false);
      expect(hasVerifiedQuery("")).toBe(false);
    });
  });

  describe("mapLoginError", () => {
    it("maps account_suspended code to a user-facing message", () => {
      expect(mapLoginError("CredentialsSignin", "account_suspended")).toBe(
        "Your account is suspended. Contact your organization admin.",
      );
    });

    it("maps invalid_passkey_assertion code to a passkey retry message", () => {
      expect(mapLoginError("CredentialsSignin", "invalid_passkey_assertion")).toBe(
        "Passkey verification expired. Try signing in with passkey again.",
      );
    });

    it("maps CredentialsSignin to a user-facing message", () => {
      expect(mapLoginError("CredentialsSignin")).toBe(
        "Invalid email or password",
      );
    });

    it("maps Configuration to a setup message", () => {
      expect(mapLoginError("Configuration")).toBe(
        "Server configuration error - missing environment variables",
      );
    });

    it("returns unknown errors unchanged", () => {
      expect(mapLoginError("SomeOtherError")).toBe("SomeOtherError");
    });
  });
});
