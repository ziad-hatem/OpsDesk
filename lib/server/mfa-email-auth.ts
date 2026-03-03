import { createHash, randomInt, timingSafeEqual } from "crypto";

export const MFA_EMAIL_CODE_TTL_MINUTES = 10;
export const MFA_EMAIL_CODE_COOLDOWN_SECONDS = 45;
export const MFA_EMAIL_CODE_MAX_ATTEMPTS = 5;

function getMfaEmailCodeSecret(): string {
  const secret =
    process.env.MFA_EMAIL_CODE_SECRET ??
    process.env.NEXTAUTH_SECRET;

  if (!secret) {
    throw new Error(
      "Missing MFA email code secret. Set MFA_EMAIL_CODE_SECRET or NEXTAUTH_SECRET.",
    );
  }

  return secret;
}

export function isMultiStepAuthEnabled(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") {
    return false;
  }

  return (metadata as Record<string, unknown>).multi_step_auth_enabled === true;
}

export function createEmailMfaCode(): string {
  const value = randomInt(0, 1_000_000);
  return value.toString().padStart(6, "0");
}

export function isValidEmailMfaCode(code: unknown): code is string {
  return typeof code === "string" && /^\d{6}$/.test(code.trim());
}

export function hashEmailMfaCode(code: string): string {
  return createHash("sha256")
    .update(`${code}:${getMfaEmailCodeSecret()}`)
    .digest("hex");
}

export function compareEmailMfaCode(code: string, expectedHash: string): boolean {
  const computed = hashEmailMfaCode(code);
  const expectedBuffer = Buffer.from(expectedHash, "utf8");
  const computedBuffer = Buffer.from(computed, "utf8");

  if (expectedBuffer.length !== computedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, computedBuffer);
}
