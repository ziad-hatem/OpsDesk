import { createHash } from "node:crypto";

export function normalizeInviteToken(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const isHex = /^[a-f0-9]{64}$/.test(normalized);
  return isHex ? normalized : null;
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
