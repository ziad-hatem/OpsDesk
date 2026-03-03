import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  clearCustomerPortalSessionCookie,
  CUSTOMER_PORTAL_SESSION_COOKIE,
  hashPortalToken,
} from "@/lib/server/customer-portal-auth";

export async function POST() {
  const cookieStore = await cookies();
  const response = NextResponse.json({ success: true }, { status: 200 });
  const sessionToken =
    cookieStore.get(CUSTOMER_PORTAL_SESSION_COOKIE)?.value?.trim() ?? "";

  if (sessionToken) {
    const supabase = createSupabaseAdminClient();
    await supabase
      .from("customer_portal_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("token_hash", hashPortalToken(sessionToken));
  }

  clearCustomerPortalSessionCookie(response);
  return response;
}
