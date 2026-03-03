import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  buildCustomerPortalVerifyLink,
  generatePortalToken,
  getPortalLoginLinkExpiresAt,
  hashPortalToken,
  isMissingCustomerPortalSchema,
  normalizePortalEmail,
} from "@/lib/server/customer-portal-auth";
import { sendCustomerPortalAccessEmail } from "@/lib/server/customer-portal-email";
import { runPortalEventAutomationEngine } from "@/lib/server/automation-engine";
import { missingTableMessageWithMigration } from "@/lib/tickets/errors";

export const runtime = "nodejs";

type RequestBody = {
  email?: string;
};

type CustomerRow = {
  id: string;
  organization_id: string;
  name: string;
  email: string | null;
  status: "active" | "inactive" | "blocked";
};

type OrganizationRow = {
  id: string;
  name: string;
};

const SUCCESS_MESSAGE =
  "If this email has portal access, a secure sign-in link has been sent.";

export async function POST(req: Request) {
  let body: RequestBody = {};
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    body = {};
  }

  const email = normalizePortalEmail(body.email);
  if (!email) {
    return NextResponse.json(
      { error: "A valid email is required" },
      { status: 400 },
    );
  }

  const supabase = createSupabaseAdminClient();
  const rateLimitWindowIso = new Date(Date.now() - 60 * 1000).toISOString();
  const { count: recentCount } = await supabase
    .from("customer_portal_login_links")
    .select("id", { count: "exact", head: true })
    .eq("email", email)
    .gte("created_at", rateLimitWindowIso);

  if ((recentCount ?? 0) >= 3) {
    return NextResponse.json({ message: SUCCESS_MESSAGE }, { status: 200 });
  }

  const { data: customers, error: customersError } = await supabase
    .from("customers")
    .select("id, organization_id, name, email, status")
    .ilike("email", email)
    .in("status", ["active", "inactive"])
    .limit(10)
    .returns<CustomerRow[]>();

  if (customersError) {
    if (isMissingCustomerPortalSchema(customersError, "customer_portal_login_links")) {
      return NextResponse.json(
        {
          error: missingTableMessageWithMigration(
            "customer_portal_login_links",
            "db/customer-portal-schema.sql",
          ),
        },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { error: `Failed to verify customer portal access: ${customersError.message}` },
      { status: 500 },
    );
  }

  const matchedCustomers = (customers ?? []).filter(
    (customer) => normalizePortalEmail(customer.email) === email,
  );
  if (matchedCustomers.length === 0) {
    return NextResponse.json({ message: SUCCESS_MESSAGE }, { status: 200 });
  }

  const organizationIds = Array.from(
    new Set(matchedCustomers.map((customer) => customer.organization_id)),
  );
  const { data: organizations, error: organizationsError } = await supabase
    .from("organizations")
    .select("id, name")
    .in("id", organizationIds)
    .returns<OrganizationRow[]>();

  if (organizationsError) {
    return NextResponse.json(
      { error: `Failed to load organizations for portal access: ${organizationsError.message}` },
      { status: 500 },
    );
  }

  const organizationsById = new Map(
    (organizations ?? []).map((organization) => [organization.id, organization.name]),
  );

  const requestedIp =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = req.headers.get("user-agent")?.trim() || null;

  for (const customer of matchedCustomers) {
    const token = generatePortalToken();
    const tokenHash = hashPortalToken(token);
    const expiresAt = getPortalLoginLinkExpiresAt();

    const { error: insertError } = await supabase.from("customer_portal_login_links").insert({
      organization_id: customer.organization_id,
      customer_id: customer.id,
      email,
      token_hash: tokenHash,
      expires_at: expiresAt,
      requested_ip: requestedIp,
      user_agent: userAgent,
    });

    if (insertError) {
      if (isMissingCustomerPortalSchema(insertError, "customer_portal_login_links")) {
        return NextResponse.json(
          {
            error: missingTableMessageWithMigration(
              "customer_portal_login_links",
              "db/customer-portal-schema.sql",
            ),
          },
          { status: 500 },
        );
      }

      return NextResponse.json(
        { error: `Failed to create customer portal login link: ${insertError.message}` },
        { status: 500 },
      );
    }

    await runPortalEventAutomationEngine({
      supabase,
      organizationId: customer.organization_id,
      triggerEvent: "portal.auth_link_requested",
      portalEvent: {
        id: tokenHash,
        organization_id: customer.organization_id,
        event_name: "portal.auth_link_requested",
        entity_type: "customer",
        entity_id: customer.id,
        title: customer.name,
        status: customer.status,
        customer_id: customer.id,
        email,
        metadata: {
          requestedIp,
          userAgent,
          expiresAt,
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });

    try {
      await sendCustomerPortalAccessEmail({
        toEmail: email,
        customerName: customer.name,
        organizationName:
          organizationsById.get(customer.organization_id) ?? "OpsDesk",
        accessLink: buildCustomerPortalVerifyLink(token),
        expiresAt,
      });
    } catch (sendError: unknown) {
      const message =
        sendError instanceof Error
          ? sendError.message
          : "Failed to send customer portal email";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  return NextResponse.json({ message: SUCCESS_MESSAGE }, { status: 200 });
}
