import { createSupabaseAdminClient } from "@/lib/supabase-admin";
// tinker.mjs is the existing manual seed-data script (scripts/tinker.mjs) — reused here so the
// hourly demo reset and `npm run tinker` stay backed by the exact same scenario fixtures.
import { buildContext, SCENARIO_RUNNERS, SCENARIO_ORDER } from "@/scripts/tinker.mjs";

type DemoContext = Awaited<ReturnType<typeof buildContext>>;
const scenarioRunners = SCENARIO_RUNNERS as Record<string, (ctx: DemoContext) => Promise<void>>;

export const DEMO_EMAIL = (process.env.NEXT_PUBLIC_DEMO_EMAIL ?? "demo@opsdesk.com").trim().toLowerCase();

// Scenarios to reseed on every reset. "portal" is excluded: it creates a brand-new
// customer-portal user/customer row every run (keyed by a fresh run tag), which would leak
// unbounded rows into `public.users`/`customers` on an hourly job instead of staying idempotent.
const DEMO_SCENARIOS = (SCENARIO_ORDER as string[]).filter((name) => name !== "portal");

// Deleted in dependency order (children before parents) so no FK constraint blocks the wipe.
const ORG_SCOPED_TABLES = [
  "ticket_tag_assignments",
  "ticket_texts",
  "ticket_sla_events",
  "tickets",
  "ticket_tags",
  "order_items",
  "order_status_events",
  "orders",
  "incident_impacts",
  "incident_updates",
  "incidents",
  "status_services",
  "custom_role_permissions",
  "approval_request_decisions",
  "approval_requests",
  "approval_policies",
  "custom_roles",
  "automation_rule_runs",
  "automation_rules",
  "analytics_report_runs",
  "analytics_metric_snapshots",
  "analytics_report_schedules",
  "customer_communications",
  "saved_views",
  "notifications",
  "organization_invites",
  "audit_logs",
  "customers",
  "sla_policies",
];

// Scoped by user_id instead of organization_id (security scenario rows).
const USER_SCOPED_TABLES = ["passkeys", "passkey_challenges", "email_mfa_challenges"];

async function ensureDemoAuthUser(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  email: string,
  password: string,
): Promise<string> {
  const { data: existing } = await supabase
    .from("users")
    .select("id")
    .ilike("email", email)
    .maybeSingle<{ id: string }>();

  if (existing?.id) {
    const { error } = await supabase.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
    });
    if (error) {
      throw new Error(`Failed to reset demo auth user password: ${error.message}`);
    }
    return existing.id;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { first_name: "Demo", last_name: "Account" },
  });
  if (error || !data.user) {
    throw new Error(`Failed to create demo auth user: ${error?.message ?? "unknown error"}`);
  }

  const { error: upsertError } = await supabase.from("users").upsert(
    { id: data.user.id, email, name: "Demo Account" },
    { onConflict: "id" },
  );
  if (upsertError) {
    throw new Error(`Failed to upsert demo public.users row: ${upsertError.message}`);
  }

  return data.user.id;
}

export type DemoResetSummary = {
  demoEmail: string;
  organizationId: string;
  scenariosRun: string[];
};

export async function resetDemoAccount(): Promise<DemoResetSummary> {
  const password = process.env.NEXT_PUBLIC_DEMO_PASSWORD?.trim();
  if (!password) {
    throw new Error("NEXT_PUBLIC_DEMO_PASSWORD is not configured");
  }

  const supabase = createSupabaseAdminClient();
  await ensureDemoAuthUser(supabase, DEMO_EMAIL, password);

  const ctx = await buildContext(supabase, { email: DEMO_EMAIL, createUser: false });

  for (const table of ORG_SCOPED_TABLES) {
    if (await ctx.tableExists(table)) {
      await ctx.supabase.from(table).delete().eq("organization_id", ctx.organization.id);
    }
  }
  for (const table of USER_SCOPED_TABLES) {
    if (await ctx.tableExists(table)) {
      await ctx.supabase.from(table).delete().eq("user_id", ctx.actorUser.id);
    }
  }

  for (const name of DEMO_SCENARIOS) {
    await scenarioRunners[name](ctx);
  }

  return {
    demoEmail: DEMO_EMAIL,
    organizationId: ctx.organization.id,
    scenariosRun: DEMO_SCENARIOS,
  };
}
