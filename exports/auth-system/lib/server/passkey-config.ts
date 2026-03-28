import type { ServerOptions } from "next-passkey-webauthn/types";
import { SupabaseAdapter } from "next-passkey-webauthn/adapters";
import { SupabaseStore } from "next-passkey-webauthn/store";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

function getBaseUrl(): string {
  const value =
    process.env.NEXTAUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000";
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function getExpectedOrigin(): string | string[] {
  return process.env.PASSKEY_EXPECTED_ORIGIN ?? getBaseUrl();
}

function getRpId(expectedOrigin: string | string[]): string {
  if (process.env.PASSKEY_RP_ID) {
    return process.env.PASSKEY_RP_ID;
  }

  const origin = Array.isArray(expectedOrigin)
    ? expectedOrigin[0]
    : expectedOrigin;
  try {
    return new URL(origin).hostname;
  } catch {
    return "localhost";
  }
}

export function createPasskeyServerOptions(): ServerOptions {
  const supabase = createSupabaseAdminClient();
  const expectedOrigin = getExpectedOrigin();

  return {
    adapter: new SupabaseAdapter(supabase, "passkeys"),
    store: new SupabaseStore(supabase, "passkey_challenges"),
    rpConfig: {
      rpID: getRpId(expectedOrigin),
      rpName: process.env.PASSKEY_RP_NAME ?? "OpsDesk",
      expectedOrigin,
    },
  };
}

