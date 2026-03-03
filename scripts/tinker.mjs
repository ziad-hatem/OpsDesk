#!/usr/bin/env node

import crypto from "node:crypto";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const SCENARIOS = {
  team: "Team members + invite flow data",
  tickets: "Tickets, texts, mentions, notifications, tags, saved views",
  orders: "Orders, items, payment states, order status events",
  incidents: "Incidents, impacted services, timeline updates",
  sla: "SLA policies + SLA events",
  automation: "Automation rules + rule run history",
  communications: "Omnichannel customer communications",
  rbac: "Custom RBAC + approval requests/decisions",
  portal: "Customer portal identities + login links + sessions",
  analytics: "Executive report schedules, runs, metric snapshots",
  security: "Passkey + MFA challenge demo rows",
};

const SCENARIO_ORDER = [
  "team",
  "tickets",
  "orders",
  "incidents",
  "sla",
  "automation",
  "communications",
  "rbac",
  "portal",
  "analytics",
  "security",
];

function parseArgs(argv) {
  const options = {
    email: null,
    scenario: "all",
    orgId: null,
    orgSlug: null,
    createUser: false,
    listUsers: false,
    listScenarios: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--email" || token === "-e") {
      options.email = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (token === "--scenario" || token === "-s") {
      options.scenario = argv[i + 1] ?? "all";
      i += 1;
      continue;
    }
    if (token === "--org-id") {
      options.orgId = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (token === "--org-slug") {
      options.orgSlug = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (token === "--create-user") {
      options.createUser = true;
      continue;
    }
    if (token === "--list-users") {
      options.listUsers = true;
      continue;
    }
    if (token === "--list-scenarios") {
      options.listScenarios = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      options.help = true;
      continue;
    }
    throw new Error(`Unknown option: ${token}`);
  }

  return options;
}

function printHelp() {
  console.log(`
OpsDesk Tinker Runner

Usage:
  npm run tinker -- --email user@company.com [--scenario all]
  npm run tinker -- --email user@company.com --scenario tickets,orders
  npm run tinker -- --list-users
  npm run tinker -- --list-scenarios

Options:
  -e, --email <email>        Run scenarios as this user email.
  -s, --scenario <list>      all | comma-separated list:
                             ${Object.keys(SCENARIOS).join(", ")}
      --org-id <uuid>        Force a specific organization.
      --org-slug <slug>      Use organization by slug.
      --create-user          Create users.email row when missing.
      --list-users           Print users available in public.users.
      --list-scenarios       Print all scenario names and descriptions.
  -h, --help                 Show this help.
`);
}

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function createSupabaseAdminClient() {
  return createClient(
    getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  );
}

function nowIso() {
  return new Date().toISOString();
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function addHours(date, hours) {
  return addMinutes(date, hours * 60);
}

function addDays(date, days) {
  return addHours(date, days * 24);
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function compactRunTag() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const short = crypto.randomBytes(2).toString("hex");
  return `${stamp}-${short}`;
}

function makeTokenHash() {
  return crypto.randomBytes(32).toString("hex");
}

function makeCodeHash(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function inferNameFromEmail(email) {
  const [local] = email.split("@");
  const cleaned = local.replace(/[._+\-]/g, " ").trim();
  if (!cleaned) return "OpsDesk User";
  return cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function isMissingTableError(error) {
  const message = `${error?.message ?? ""}`.toLowerCase();
  return (
    message.includes("could not find the table") ||
    message.includes("schema cache") ||
    (message.includes("relation") && message.includes("does not exist")) ||
    (message.includes("table") && message.includes("does not exist"))
  );
}

function isMissingColumnError(error, column) {
  const message = `${error?.message ?? ""}`.toLowerCase();
  return message.includes(`column ${column}`) && message.includes("does not exist");
}

function isDuplicateError(error) {
  const message = `${error?.message ?? ""}`.toLowerCase();
  return error?.code === "23505" || message.includes("duplicate key value");
}

function parseScenarioList(value) {
  if (!value || value === "all") return [...SCENARIO_ORDER];
  const requested = value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const invalid = requested.filter((name) => !(name in SCENARIOS));
  if (invalid.length > 0) {
    throw new Error(`Invalid scenario name(s): ${invalid.join(", ")}`);
  }
  return requested;
}

function logger(scope) {
  return {
    info(message) {
      console.log(`[${scope}] ${message}`);
    },
    warn(message) {
      console.warn(`[${scope}] ${message}`);
    },
  };
}

async function listUsers(supabase) {
  const { data, error } = await supabase
    .from("users")
    .select("id,name,email,created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    throw new Error(`Failed to list users: ${error.message}`);
  }

  if (!data || data.length === 0) {
    console.log("No users in public.users");
    return;
  }

  console.log("Users:");
  for (const row of data) {
    console.log(`- ${row.email} (${row.name ?? "No name"}) id=${row.id}`);
  }
}

function createTableChecker(supabase, log) {
  const cache = new Map();
  return async function tableExists(table) {
    if (cache.has(table)) return cache.get(table);
    const { error } = await supabase.from(table).select("*").limit(1);
    if (!error) {
      cache.set(table, true);
      return true;
    }
    if (isMissingTableError(error)) {
      cache.set(table, false);
      log.warn(`Skipping table "${table}" because it is missing.`);
      return false;
    }
    throw new Error(`Failed to check table "${table}": ${error.message}`);
  };
}

async function requireTables(ctx, tableNames) {
  for (const table of tableNames) {
    if (!(await ctx.tableExists(table))) {
      ctx.log.warn(`Scenario "${ctx.currentScenario}" skipped (missing table: ${table}).`);
      return false;
    }
  }
  return true;
}

async function insertRow(ctx, table, payload) {
  if (!(await ctx.tableExists(table))) return null;
  const { data, error } = await ctx.supabase.from(table).insert(payload).select("*").single();
  if (error) throw new Error(`Failed to insert into ${table}: ${error.message}`);
  return data;
}

async function insertRows(ctx, table, payloads) {
  if (!(await ctx.tableExists(table))) return [];
  const { data, error } = await ctx.supabase.from(table).insert(payloads).select("*");
  if (error) throw new Error(`Failed to insert rows into ${table}: ${error.message}`);
  return data ?? [];
}

async function upsertRow(ctx, table, payload, onConflict) {
  if (!(await ctx.tableExists(table))) return null;
  const { data, error } = await ctx.supabase
    .from(table)
    .upsert(payload, { onConflict })
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`Failed to upsert ${table}: ${error.message}`);
  return data;
}

async function ensureUserByEmail(ctx, email, allowCreate) {
  const normalizedEmail = email.trim().toLowerCase();
  const { data, error } = await ctx.supabase
    .from("users")
    .select("id,name,email")
    .ilike("email", normalizedEmail)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to query user "${normalizedEmail}": ${error.message}`);
  }

  if (data) return data;
  if (!allowCreate) {
    throw new Error(
      `User "${normalizedEmail}" was not found in public.users. Use --create-user to create it.`,
    );
  }

  const created = await insertRow(ctx, "users", {
    id: crypto.randomUUID(),
    name: inferNameFromEmail(normalizedEmail),
    email: normalizedEmail,
    created_at: nowIso(),
    updated_at: nowIso(),
  });
  ctx.log.info(`Created user ${normalizedEmail}`);
  return created;
}

async function selectMembershipRows(ctx, userId) {
  const withStatus = await ctx.supabase
    .from("organization_memberships")
    .select("id,organization_id,role,status,joined_at,created_at")
    .eq("user_id", userId);

  if (!withStatus.error) return withStatus.data ?? [];
  if (!isMissingColumnError(withStatus.error, "organization_memberships.status")) {
    throw new Error(`Failed to load memberships: ${withStatus.error.message}`);
  }

  const fallback = await ctx.supabase
    .from("organization_memberships")
    .select("id,organization_id,role,created_at")
    .eq("user_id", userId);
  if (fallback.error) {
    throw new Error(`Failed to load memberships: ${fallback.error.message}`);
  }
  return fallback.data ?? [];
}

async function ensureMembership(ctx, organizationId, userId, role) {
  const { data: existing, error: existingError } = await ctx.supabase
    .from("organization_memberships")
    .select("id,organization_id,user_id,role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Failed to lookup membership: ${existingError.message}`);
  }

  if (existing) return existing;

  const payloadWithStatus = {
    organization_id: organizationId,
    user_id: userId,
    role,
    status: "active",
    joined_at: nowIso(),
    updated_at: nowIso(),
  };

  const withStatusResult = await ctx.supabase
    .from("organization_memberships")
    .insert(payloadWithStatus)
    .select("id,organization_id,user_id,role")
    .maybeSingle();

  if (!withStatusResult.error) return withStatusResult.data;
  if (
    !isMissingColumnError(withStatusResult.error, "organization_memberships.status") &&
    !isMissingColumnError(withStatusResult.error, "organization_memberships.joined_at") &&
    !isMissingColumnError(withStatusResult.error, "organization_memberships.updated_at")
  ) {
    throw new Error(`Failed to insert membership: ${withStatusResult.error.message}`);
  }

  const fallbackResult = await ctx.supabase
    .from("organization_memberships")
    .insert({
      organization_id: organizationId,
      user_id: userId,
      role,
    })
    .select("id,organization_id,user_id,role")
    .single();

  if (fallbackResult.error) {
    throw new Error(`Failed to insert membership fallback: ${fallbackResult.error.message}`);
  }
  return fallbackResult.data;
}

async function createOrganization(ctx, email) {
  const localPart = email.split("@")[0] ?? "opsdesk";
  const baseSlug = slugify(`${localPart}-workspace`) || "opsdesk-workspace";
  const name = `${inferNameFromEmail(email)} Workspace`;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt}`;
    const { data, error } = await ctx.supabase
      .from("organizations")
      .insert({ id: crypto.randomUUID(), name, slug })
      .select("id,name,slug")
      .single();

    if (!error) return data;
    if (!isDuplicateError(error)) {
      throw new Error(`Failed to create organization: ${error.message}`);
    }
  }

  throw new Error("Unable to create organization slug after multiple attempts.");
}

async function resolveOrganization(ctx, actorUser, options) {
  if (options.orgId) {
    const { data, error } = await ctx.supabase
      .from("organizations")
      .select("id,name,slug")
      .eq("id", options.orgId)
      .maybeSingle();
    if (error) throw new Error(`Failed to load organization by id: ${error.message}`);
    if (!data) throw new Error(`Organization id not found: ${options.orgId}`);
    await ensureMembership(ctx, data.id, actorUser.id, "admin");
    return data;
  }

  if (options.orgSlug) {
    const { data, error } = await ctx.supabase
      .from("organizations")
      .select("id,name,slug")
      .eq("slug", options.orgSlug)
      .maybeSingle();
    if (error) throw new Error(`Failed to load organization by slug: ${error.message}`);
    if (!data) throw new Error(`Organization slug not found: ${options.orgSlug}`);
    await ensureMembership(ctx, data.id, actorUser.id, "admin");
    return data;
  }

  const memberships = await selectMembershipRows(ctx, actorUser.id);
  if (memberships.length > 0) {
    const preferred = memberships[0];
    const { data, error } = await ctx.supabase
      .from("organizations")
      .select("id,name,slug")
      .eq("id", preferred.organization_id)
      .maybeSingle();
    if (error) throw new Error(`Failed to resolve membership organization: ${error.message}`);
    if (data) return data;
  }

  const createdOrg = await createOrganization(ctx, actorUser.email);
  await ensureMembership(ctx, createdOrg.id, actorUser.id, "admin");
  ctx.log.info(`Created organization ${createdOrg.slug}`);
  return createdOrg;
}

async function ensureDemoTeam(ctx) {
  if (ctx.runtime.teamReady) return;

  const suffix = ctx.organization.id.replace(/-/g, "").slice(0, 8);
  const template = [
    { key: "manager", role: "manager", email: `manager+${suffix}@opsdesk.demo`, name: "Manager Demo" },
    { key: "support", role: "support", email: `support+${suffix}@opsdesk.demo`, name: "Support Demo" },
    { key: "readOnly", role: "read_only", email: `readonly+${suffix}@opsdesk.demo`, name: "Read Only Demo" },
  ];

  ctx.runtime.users.actor = ctx.actorUser;
  for (const item of template) {
    const user = await ensureUserByEmail(ctx, item.email, true);
    if (!user.name) {
      await ctx.supabase.from("users").update({ name: item.name }).eq("id", user.id);
      user.name = item.name;
    }
    await ensureMembership(ctx, ctx.organization.id, user.id, item.role);
    ctx.runtime.users[item.key] = user;
  }

  ctx.runtime.teamReady = true;
}

async function writeAuditLog(ctx, payload) {
  if (!(await ctx.tableExists("audit_logs"))) return null;

  const fullPayload = {
    organization_id: ctx.organization.id,
    actor_user_id: payload.actorUserId ?? ctx.actorUser.id,
    action: payload.action,
    entity_type: payload.entityType ?? null,
    entity_id: payload.entityId ?? null,
    source: payload.source ?? "tinker",
    target_user_id: payload.targetUserId ?? null,
    details: payload.details ?? null,
    created_at: nowIso(),
  };

  const first = await ctx.supabase.from("audit_logs").insert(fullPayload).select("*").maybeSingle();
  if (!first.error) return first.data;

  const fallbackPayload = {
    organization_id: fullPayload.organization_id,
    actor_user_id: fullPayload.actor_user_id,
    action: fullPayload.action,
    entity_type: fullPayload.entity_type,
    entity_id: fullPayload.entity_id,
    created_at: fullPayload.created_at,
  };
  const second = await ctx.supabase
    .from("audit_logs")
    .insert(fallbackPayload)
    .select("*")
    .maybeSingle();
  if (second.error) {
    throw new Error(`Failed to write audit log: ${second.error.message}`);
  }
  return second.data;
}

async function createNotification(ctx, payload) {
  if (!(await ctx.tableExists("notifications"))) return null;
  const row = await insertRow(ctx, "notifications", {
    user_id: payload.userId,
    organization_id: ctx.organization.id,
    type: payload.type,
    title: payload.title,
    body: payload.body ?? null,
    entity_type: payload.entityType ?? null,
    entity_id: payload.entityId ?? null,
    created_at: nowIso(),
  });
  return row;
}

async function createCustomer(ctx, label = "Customer") {
  if (!(await requireTables(ctx, ["customers"]))) return null;
  const run = ctx.runtime.runTag;
  const row = await insertRow(ctx, "customers", {
    organization_id: ctx.organization.id,
    name: `${label} ${run}`,
    email: `${slugify(label)}.${run}@example.com`,
    phone: "+12025550123",
    status: "active",
    external_id: `ext-${run}`,
    created_at: nowIso(),
    updated_at: nowIso(),
  });
  ctx.runtime.customers.push(row);
  return row;
}

async function scenarioTeam(ctx) {
  ctx.currentScenario = "team";
  if (!(await requireTables(ctx, ["users", "organization_memberships"]))) return;
  await ensureDemoTeam(ctx);

  if (await ctx.tableExists("organization_invites")) {
    const inviteEmail = `new.agent+${ctx.runtime.runTag}@example.com`;
    const invite = await insertRow(ctx, "organization_invites", {
      organization_id: ctx.organization.id,
      email: inviteEmail,
      role: "support",
      token_hash: makeTokenHash(),
      expires_at: addDays(new Date(), 3).toISOString(),
      invited_by: ctx.actorUser.id,
      created_at: nowIso(),
    });
    ctx.runtime.invites.push(invite);
  }

  await writeAuditLog(ctx, {
    action: "team.seeded",
    entityType: "organization",
    entityId: ctx.organization.id,
    details: {
      runTag: ctx.runtime.runTag,
      members: Object.values(ctx.runtime.users).map((u) => u.email),
    },
  });

  ctx.runtime.completed.team = true;
  ctx.log.info("Scenario team complete.");
}

async function scenarioTickets(ctx) {
  ctx.currentScenario = "tickets";
  if (!(await requireTables(ctx, ["customers", "tickets", "ticket_texts"]))) return;
  await ensureDemoTeam(ctx);

  const customer = (ctx.runtime.customers[0] ?? (await createCustomer(ctx, "Ticket Customer")));
  if (!customer) return;

  const supportUser = ctx.runtime.users.support;
  const managerUser = ctx.runtime.users.manager;

  const ticketOpen = await insertRow(ctx, "tickets", {
    organization_id: ctx.organization.id,
    customer_id: customer.id,
    title: `Login issue ${ctx.runtime.runTag}`,
    description: "Customer cannot sign in after password reset.",
    status: "open",
    priority: "high",
    assignee_id: supportUser.id,
    created_by: ctx.actorUser.id,
    created_at: nowIso(),
    updated_at: nowIso(),
  });

  const ticketPending = await insertRow(ctx, "tickets", {
    organization_id: ctx.organization.id,
    customer_id: customer.id,
    title: `Billing mismatch ${ctx.runtime.runTag}`,
    description: "Invoice total does not match expected amount.",
    status: "pending",
    priority: "urgent",
    assignee_id: managerUser.id,
    created_by: ctx.actorUser.id,
    created_at: nowIso(),
    updated_at: nowIso(),
  });

  const resolvedAt = addHours(new Date(), -4).toISOString();
  const ticketResolved = await insertRow(ctx, "tickets", {
    organization_id: ctx.organization.id,
    customer_id: customer.id,
    title: `API timeout ${ctx.runtime.runTag}`,
    description: "Intermittent API timeouts during peak traffic.",
    status: "resolved",
    priority: "medium",
    assignee_id: supportUser.id,
    created_by: ctx.actorUser.id,
    closed_at: resolvedAt,
    created_at: addHours(new Date(), -12).toISOString(),
    updated_at: resolvedAt,
  });

  ctx.runtime.tickets.push(ticketOpen, ticketPending, ticketResolved);

  await insertRows(ctx, "ticket_texts", [
    {
      organization_id: ctx.organization.id,
      ticket_id: ticketOpen.id,
      author_id: ctx.actorUser.id,
      type: "comment",
      body: `Assigned for triage to @${(supportUser.name ?? "support").replace(/\s+/g, "")}.`,
      created_at: nowIso(),
    },
    {
      organization_id: ctx.organization.id,
      ticket_id: ticketPending.id,
      author_id: supportUser.id,
      type: "internal_note",
      body: `Escalating to @${(managerUser.name ?? "manager").replace(/\s+/g, "")} for approval.`,
      created_at: nowIso(),
    },
  ]);

  await createNotification(ctx, {
    userId: supportUser.id,
    type: "ticket",
    title: "New ticket assigned",
    body: `Ticket ${ticketOpen.title} was assigned to you.`,
    entityType: "ticket",
    entityId: ticketOpen.id,
  });

  await createNotification(ctx, {
    userId: managerUser.id,
    type: "comment",
    title: "You were mentioned in a ticket",
    body: `Mentioned in ${ticketPending.title}.`,
    entityType: "ticket",
    entityId: ticketPending.id,
  });

  if (await ctx.tableExists("ticket_tags")) {
    const tags = await insertRows(ctx, "ticket_tags", [
      {
        organization_id: ctx.organization.id,
        name: `vip-${ctx.runtime.runTag}`,
        color: "amber",
        created_by: ctx.actorUser.id,
        created_at: nowIso(),
      },
      {
        organization_id: ctx.organization.id,
        name: `bug-${ctx.runtime.runTag}`,
        color: "red",
        created_by: ctx.actorUser.id,
        created_at: nowIso(),
      },
    ]);

    if (tags[0] && tags[1] && (await ctx.tableExists("ticket_tag_assignments"))) {
      await insertRows(ctx, "ticket_tag_assignments", [
        {
          organization_id: ctx.organization.id,
          ticket_id: ticketOpen.id,
          tag_id: tags[0].id,
          created_at: nowIso(),
        },
        {
          organization_id: ctx.organization.id,
          ticket_id: ticketPending.id,
          tag_id: tags[1].id,
          created_at: nowIso(),
        },
      ]);
    }
  }

  if (await ctx.tableExists("saved_views")) {
    await upsertRow(
      ctx,
      "saved_views",
      {
        organization_id: ctx.organization.id,
        user_id: ctx.actorUser.id,
        entity_type: "tickets",
        scope: "personal",
        name: `Urgent Open ${ctx.runtime.runTag}`,
        filters: {
          status: ["open", "pending"],
          priority: ["urgent", "high"],
          assigneeId: supportUser.id,
        },
        is_favorite: true,
      },
      "organization_id,user_id,entity_type,name",
    );
  }

  await writeAuditLog(ctx, {
    action: "tickets.seeded",
    entityType: "ticket",
    entityId: ticketOpen.id,
    details: { ticketIds: ctx.runtime.tickets.map((ticket) => ticket.id) },
  });

  ctx.runtime.completed.tickets = true;
  ctx.log.info("Scenario tickets complete.");
}

async function scenarioOrders(ctx) {
  ctx.currentScenario = "orders";
  if (!(await requireTables(ctx, ["orders", "order_items"]))) return;

  const customer = (ctx.runtime.customers[0] ?? (await createCustomer(ctx, "Order Customer")));
  if (!customer) return;

  const run = ctx.runtime.runTag;
  const now = new Date();
  const pendingOrder = await insertRow(ctx, "orders", {
    organization_id: ctx.organization.id,
    customer_id: customer.id,
    order_number: `ORD-${run}-01`,
    status: "pending",
    payment_status: "payment_link_sent",
    currency: "USD",
    subtotal_amount: 12000,
    tax_amount: 900,
    discount_amount: 300,
    total_amount: 12600,
    placed_at: addHours(now, -6).toISOString(),
    payment_link_url: `https://pay.opsdesk.demo/${run}`,
    payment_link_sent_at: addHours(now, -5).toISOString(),
    notes: "Seeded by tinker",
    created_by: ctx.actorUser.id,
    created_at: addHours(now, -6).toISOString(),
    updated_at: nowIso(),
  });

  const paidAt = addHours(now, -2).toISOString();
  const paidOrder = await insertRow(ctx, "orders", {
    organization_id: ctx.organization.id,
    customer_id: customer.id,
    order_number: `ORD-${run}-02`,
    status: "paid",
    payment_status: "paid",
    currency: "USD",
    subtotal_amount: 5000,
    tax_amount: 350,
    discount_amount: 0,
    total_amount: 5350,
    placed_at: addHours(now, -8).toISOString(),
    paid_at: paidAt,
    payment_completed_at: paidAt,
    stripe_payment_intent_id: `pi_${run}`,
    created_by: ctx.actorUser.id,
    created_at: addHours(now, -8).toISOString(),
    updated_at: paidAt,
  });

  ctx.runtime.orders.push(pendingOrder, paidOrder);

  await insertRows(ctx, "order_items", [
    {
      organization_id: ctx.organization.id,
      order_id: pendingOrder.id,
      sku: "PRO-PLAN",
      name: "Professional Plan",
      quantity: 1,
      unit_price_amount: 10000,
      total_amount: 10000,
      created_at: nowIso(),
    },
    {
      organization_id: ctx.organization.id,
      order_id: pendingOrder.id,
      sku: "ONBOARDING",
      name: "Onboarding Package",
      quantity: 1,
      unit_price_amount: 2000,
      total_amount: 2000,
      created_at: nowIso(),
    },
  ]);

  if (await ctx.tableExists("order_status_events")) {
    await insertRows(ctx, "order_status_events", [
      {
        organization_id: ctx.organization.id,
        order_id: pendingOrder.id,
        from_status: "draft",
        to_status: "pending",
        actor_user_id: ctx.actorUser.id,
        reason: "Checkout initiated",
        created_at: addHours(now, -6).toISOString(),
      },
      {
        organization_id: ctx.organization.id,
        order_id: paidOrder.id,
        from_status: "pending",
        to_status: "paid",
        actor_user_id: ctx.actorUser.id,
        reason: "Stripe webhook payment success",
        created_at: paidAt,
      },
    ]);
  }

  await createNotification(ctx, {
    userId: ctx.actorUser.id,
    type: "order",
    title: "Order payment completed",
    body: `Order ${paidOrder.order_number} is now paid.`,
    entityType: "order",
    entityId: paidOrder.id,
  });

  await writeAuditLog(ctx, {
    action: "orders.seeded",
    entityType: "order",
    entityId: pendingOrder.id,
    details: { orderIds: ctx.runtime.orders.map((order) => order.id) },
  });

  ctx.runtime.completed.orders = true;
  ctx.log.info("Scenario orders complete.");
}

async function scenarioIncidents(ctx) {
  ctx.currentScenario = "incidents";
  if (!(await requireTables(ctx, ["status_services", "incidents", "incident_updates"]))) return;

  const serviceA = await insertRow(ctx, "status_services", {
    organization_id: ctx.organization.id,
    name: `API Gateway ${ctx.runtime.runTag}`,
    slug: `api-gateway-${ctx.runtime.runTag}`,
    description: "Core API traffic routing",
    current_status: "degraded",
    is_public: true,
    display_order: 1,
    created_by: ctx.actorUser.id,
    created_at: nowIso(),
    updated_at: nowIso(),
  });

  const serviceB = await insertRow(ctx, "status_services", {
    organization_id: ctx.organization.id,
    name: `Billing Service ${ctx.runtime.runTag}`,
    slug: `billing-service-${ctx.runtime.runTag}`,
    description: "Payment and invoice processing",
    current_status: "operational",
    is_public: true,
    display_order: 2,
    created_by: ctx.actorUser.id,
    created_at: nowIso(),
    updated_at: nowIso(),
  });

  ctx.runtime.services.push(serviceA, serviceB);

  const incident = await insertRow(ctx, "incidents", {
    organization_id: ctx.organization.id,
    title: `Partial API disruption ${ctx.runtime.runTag}`,
    summary: "Increased latency for API requests in one region.",
    status: "monitoring",
    severity: "high",
    is_public: true,
    started_at: addHours(new Date(), -3).toISOString(),
    created_by: ctx.actorUser.id,
    created_at: addHours(new Date(), -3).toISOString(),
    updated_at: nowIso(),
  });

  ctx.runtime.incidents.push(incident);

  if (await ctx.tableExists("incident_impacts")) {
    await insertRows(ctx, "incident_impacts", [
      {
        organization_id: ctx.organization.id,
        incident_id: incident.id,
        service_id: serviceA.id,
        impact_level: "degraded",
        created_at: addHours(new Date(), -3).toISOString(),
      },
    ]);
  }

  await insertRows(ctx, "incident_updates", [
    {
      organization_id: ctx.organization.id,
      incident_id: incident.id,
      message: "We are investigating elevated response times.",
      status: "investigating",
      is_public: true,
      created_by: ctx.actorUser.id,
      created_at: addHours(new Date(), -3).toISOString(),
    },
    {
      organization_id: ctx.organization.id,
      incident_id: incident.id,
      message: "Fix deployed, monitoring system stability.",
      status: "monitoring",
      is_public: true,
      created_by: ctx.actorUser.id,
      created_at: nowIso(),
    },
  ]);

  await createNotification(ctx, {
    userId: ctx.runtime.users.manager?.id ?? ctx.actorUser.id,
    type: "alert",
    title: "Incident update posted",
    body: incident.title,
    entityType: "incident",
    entityId: incident.id,
  });

  await writeAuditLog(ctx, {
    action: "incidents.seeded",
    entityType: "incident",
    entityId: incident.id,
    details: { serviceIds: ctx.runtime.services.map((service) => service.id) },
  });

  ctx.runtime.completed.incidents = true;
  ctx.log.info("Scenario incidents complete.");
}

async function scenarioSla(ctx) {
  ctx.currentScenario = "sla";
  if (!(await requireTables(ctx, ["sla_policies", "ticket_sla_events"]))) return;

  const policyRows = [
    { priority: "low", first_response_minutes: 240, resolution_minutes: 2880, warning_minutes: 180 },
    { priority: "medium", first_response_minutes: 120, resolution_minutes: 1440, warning_minutes: 90 },
    { priority: "high", first_response_minutes: 60, resolution_minutes: 720, warning_minutes: 45 },
    { priority: "urgent", first_response_minutes: 30, resolution_minutes: 240, warning_minutes: 20 },
  ];

  for (const row of policyRows) {
    await upsertRow(
      ctx,
      "sla_policies",
      {
        organization_id: ctx.organization.id,
        priority: row.priority,
        first_response_minutes: row.first_response_minutes,
        resolution_minutes: row.resolution_minutes,
        warning_minutes: row.warning_minutes,
        escalation_role: "manager",
        auto_escalate: true,
        updated_at: nowIso(),
      },
      "organization_id,priority",
    );
  }

  let ticketForSla = ctx.runtime.tickets[0];
  if (!ticketForSla && (await ctx.tableExists("tickets"))) {
    await scenarioTickets(ctx);
    ticketForSla = ctx.runtime.tickets[0];
  }
  if (!ticketForSla) return;

  await insertRows(ctx, "ticket_sla_events", [
    {
      organization_id: ctx.organization.id,
      ticket_id: ticketForSla.id,
      event_type: "first_response_warning",
      due_at: addMinutes(new Date(), 15).toISOString(),
      metadata: { seeded: true, runTag: ctx.runtime.runTag },
      created_at: nowIso(),
    },
    {
      organization_id: ctx.organization.id,
      ticket_id: ticketForSla.id,
      event_type: "resolution_breached",
      due_at: addMinutes(new Date(), -30).toISOString(),
      metadata: { seeded: true, runTag: ctx.runtime.runTag },
      created_at: nowIso(),
    },
  ]);

  await writeAuditLog(ctx, {
    action: "sla.seeded",
    entityType: "ticket",
    entityId: ticketForSla.id,
  });

  ctx.runtime.completed.sla = true;
  ctx.log.info("Scenario sla complete.");
}

async function scenarioAutomation(ctx) {
  ctx.currentScenario = "automation";
  if (!(await requireTables(ctx, ["automation_rules", "automation_rule_runs"]))) return;

  const runTag = ctx.runtime.runTag;
  const createdRule = await insertRow(ctx, "automation_rules", {
    organization_id: ctx.organization.id,
    entity_type: "ticket",
    name: `Auto assign urgent ${runTag}`,
    description: "Assign urgent tickets to manager and notify.",
    trigger_event: "ticket.created",
    conditions: { priority: ["urgent"] },
    actions: [{ type: "assign", target: "manager" }, { type: "notify", target: "manager" }],
    is_enabled: true,
    created_by: ctx.actorUser.id,
    created_at: nowIso(),
    updated_at: nowIso(),
  });

  const archivedRule = await insertRow(ctx, "automation_rules", {
    organization_id: ctx.organization.id,
    entity_type: "order",
    name: `Archive me ${runTag}`,
    description: "Example archived rule",
    trigger_event: "order.updated",
    conditions: { payment_status: ["failed"] },
    actions: [{ type: "notify", target: "manager" }],
    is_enabled: false,
    archived_at: nowIso(),
    created_by: ctx.actorUser.id,
    created_at: nowIso(),
    updated_at: nowIso(),
  });

  const ticketId = ctx.runtime.tickets[0]?.id ?? crypto.randomUUID();
  const orderId = ctx.runtime.orders[0]?.id ?? crypto.randomUUID();
  const incidentId = ctx.runtime.incidents[0]?.id ?? crypto.randomUUID();

  await insertRows(ctx, "automation_rule_runs", [
    {
      organization_id: ctx.organization.id,
      rule_id: createdRule.id,
      entity_type: "ticket",
      entity_id: ticketId,
      trigger_event: "ticket.created",
      status: "executed",
      details: { seeded: true },
      created_at: nowIso(),
    },
    {
      organization_id: ctx.organization.id,
      rule_id: archivedRule.id,
      entity_type: "order",
      entity_id: orderId,
      trigger_event: "order.updated",
      status: "skipped",
      details: { reason: "rule archived" },
      created_at: nowIso(),
    },
    {
      organization_id: ctx.organization.id,
      rule_id: null,
      entity_type: "incident",
      entity_id: incidentId,
      trigger_event: "incident.updated",
      status: "failed",
      details: { reason: "example failure log" },
      created_at: nowIso(),
    },
  ]);

  await writeAuditLog(ctx, {
    action: "automation.seeded",
    entityType: "automation_rule",
    entityId: createdRule.id,
  });

  ctx.runtime.completed.automation = true;
  ctx.log.info("Scenario automation complete.");
}

async function scenarioCommunications(ctx) {
  ctx.currentScenario = "communications";
  if (!(await requireTables(ctx, ["customer_communications"]))) return;

  const customer = (ctx.runtime.customers[0] ?? (await createCustomer(ctx, "Comms Customer")));
  if (!customer) return;

  const ticketId = ctx.runtime.tickets[0]?.id ?? null;
  const orderId = ctx.runtime.orders[0]?.id ?? null;
  const incidentId = ctx.runtime.incidents[0]?.id ?? null;

  await insertRows(ctx, "customer_communications", [
    {
      organization_id: ctx.organization.id,
      customer_id: customer.id,
      channel: "email",
      direction: "inbound",
      provider: "resend",
      provider_message_id: `msg-${ctx.runtime.runTag}-1`,
      thread_key: `thread-${ctx.runtime.runTag}`,
      subject: "Need an update",
      body: "Can you share the latest status on my ticket?",
      sender_name: customer.name,
      sender_email: customer.email,
      recipient_email: "support@opsdesk.demo",
      actor_user_id: null,
      ticket_id: ticketId,
      order_id: null,
      incident_id: null,
      metadata: { seeded: true },
      occurred_at: nowIso(),
      created_at: nowIso(),
    },
    {
      organization_id: ctx.organization.id,
      customer_id: customer.id,
      channel: "chat",
      direction: "outbound",
      provider: "internal",
      provider_message_id: `msg-${ctx.runtime.runTag}-2`,
      thread_key: `thread-${ctx.runtime.runTag}`,
      subject: null,
      body: "Thanks for the report, we are actively investigating.",
      sender_name: ctx.actorUser.name,
      sender_email: ctx.actorUser.email,
      recipient_name: customer.name,
      recipient_email: customer.email,
      actor_user_id: ctx.actorUser.id,
      ticket_id: ticketId,
      order_id: orderId,
      incident_id: incidentId,
      metadata: { seeded: true },
      occurred_at: nowIso(),
      created_at: nowIso(),
    },
    {
      organization_id: ctx.organization.id,
      customer_id: customer.id,
      channel: "whatsapp",
      direction: "inbound",
      provider: "twilio",
      provider_message_id: `msg-${ctx.runtime.runTag}-3`,
      body: "Payment received, thank you.",
      sender_phone: "+12025550999",
      recipient_phone: "+12025550123",
      actor_user_id: null,
      ticket_id: null,
      order_id: orderId,
      incident_id: null,
      metadata: { seeded: true },
      occurred_at: nowIso(),
      created_at: nowIso(),
    },
  ]);

  await writeAuditLog(ctx, {
    action: "communications.seeded",
    entityType: "customer",
    entityId: customer.id,
  });

  ctx.runtime.completed.communications = true;
  ctx.log.info("Scenario communications complete.");
}

async function scenarioRbac(ctx) {
  ctx.currentScenario = "rbac";
  if (!(await requireTables(ctx, ["custom_roles", "custom_role_permissions", "approval_policies", "approval_requests"]))) {
    return;
  }
  await ensureDemoTeam(ctx);

  const runTag = ctx.runtime.runTag;
  const customRole = await insertRow(ctx, "custom_roles", {
    organization_id: ctx.organization.id,
    name: `Billing Approver ${runTag}`,
    description: "Can approve high-risk billing actions",
    is_system: false,
    created_by: ctx.actorUser.id,
    created_at: nowIso(),
    updated_at: nowIso(),
  });

  await insertRows(ctx, "custom_role_permissions", [
    {
      organization_id: ctx.organization.id,
      role_id: customRole.id,
      permission_key: "action.billing.refund",
      effect: "allow",
      created_at: nowIso(),
    },
    {
      organization_id: ctx.organization.id,
      role_id: customRole.id,
      permission_key: "action.orders.update",
      effect: "allow",
      created_at: nowIso(),
    },
  ]);

  const managerMembership = await ctx.supabase
    .from("organization_memberships")
    .select("id")
    .eq("organization_id", ctx.organization.id)
    .eq("user_id", ctx.runtime.users.manager.id)
    .maybeSingle();
  if (managerMembership.error) {
    throw new Error(`Failed to load manager membership: ${managerMembership.error.message}`);
  }
  if (managerMembership.data) {
    await ctx.supabase
      .from("organization_memberships")
      .update({ custom_role_id: customRole.id })
      .eq("id", managerMembership.data.id);
  }

  const policy = await upsertRow(
    ctx,
    "approval_policies",
    {
      organization_id: ctx.organization.id,
      permission_key: "action.orders.refund",
      enabled: true,
      min_approvals: 1,
      approver_roles: ["admin", "manager"],
      approver_custom_role_ids: [customRole.id],
      created_by: ctx.actorUser.id,
      updated_at: nowIso(),
    },
    "organization_id,permission_key",
  );

  const request = await insertRow(ctx, "approval_requests", {
    organization_id: ctx.organization.id,
    permission_key: "action.orders.refund",
    action_label: "Refund large payment",
    entity_type: "order",
    entity_id: ctx.runtime.orders[0]?.id ?? null,
    payload: { amount: 5350, currency: "USD" },
    status: "approved",
    requested_by: ctx.actorUser.id,
    policy_id: policy?.id ?? null,
    required_approvals: 1,
    approved_count: 1,
    approver_roles: ["admin", "manager"],
    approver_custom_role_ids: [customRole.id],
    used_at: nowIso(),
    used_by: ctx.runtime.users.manager.id,
    created_at: nowIso(),
    updated_at: nowIso(),
  });

  if (await ctx.tableExists("approval_request_decisions")) {
    await insertRow(ctx, "approval_request_decisions", {
      organization_id: ctx.organization.id,
      request_id: request.id,
      decided_by: ctx.runtime.users.manager.id,
      decision: "approved",
      comment: "Looks good from finance side.",
      created_at: nowIso(),
    });
  }

  await writeAuditLog(ctx, {
    action: "rbac.seeded",
    entityType: "approval_request",
    entityId: request.id,
  });

  ctx.runtime.completed.rbac = true;
  ctx.log.info("Scenario rbac complete.");
}

async function scenarioPortal(ctx) {
  ctx.currentScenario = "portal";
  if (!(await requireTables(ctx, ["customer_portal_identities", "customer_portal_login_links", "customer_portal_sessions"]))) {
    return;
  }

  const customer = (ctx.runtime.customers[0] ?? (await createCustomer(ctx, "Portal Customer")));
  if (!customer) return;

  const portalUserEmail = `portal.${ctx.runtime.runTag}@example.com`;
  const portalUser = await ensureUserByEmail(ctx, portalUserEmail, true);

  const identity = await upsertRow(
    ctx,
    "customer_portal_identities",
    {
      customer_id: customer.id,
      organization_id: ctx.organization.id,
      user_id: portalUser.id,
      created_at: nowIso(),
    },
    "customer_id",
  );

  await insertRow(ctx, "customer_portal_login_links", {
    organization_id: ctx.organization.id,
    customer_id: customer.id,
    email: customer.email ?? portalUser.email,
    token_hash: makeTokenHash(),
    expires_at: addMinutes(new Date(), 30).toISOString(),
    requested_ip: "127.0.0.1",
    user_agent: "OpsDesk Tinker",
    created_at: nowIso(),
  });

  await insertRow(ctx, "customer_portal_sessions", {
    organization_id: ctx.organization.id,
    customer_id: customer.id,
    email: customer.email ?? portalUser.email,
    token_hash: makeTokenHash(),
    expires_at: addDays(new Date(), 7).toISOString(),
    last_seen_at: nowIso(),
    created_at: nowIso(),
  });

  await writeAuditLog(ctx, {
    action: "portal.seeded",
    entityType: "customer_portal_identity",
    entityId: identity?.customer_id ?? customer.id,
  });

  ctx.runtime.completed.portal = true;
  ctx.log.info("Scenario portal complete.");
}

async function scenarioAnalytics(ctx) {
  ctx.currentScenario = "analytics";
  if (!(await requireTables(ctx, ["analytics_report_schedules", "analytics_report_runs", "analytics_metric_snapshots"]))) {
    return;
  }

  const runTag = ctx.runtime.runTag;
  const now = new Date();
  const from = addDays(now, -30).toISOString();
  const to = now.toISOString();

  const schedule = await insertRow(ctx, "analytics_report_schedules", {
    organization_id: ctx.organization.id,
    name: `Executive Weekly ${runTag}`,
    frequency: "weekly",
    compare_with: "previous",
    range_days: 30,
    timezone: "UTC",
    recipients: [ctx.actorUser.email],
    is_enabled: true,
    next_run_at: addDays(now, 7).toISOString(),
    last_run_at: nowIso(),
    last_status: "success",
    created_by: ctx.actorUser.id,
    created_at: nowIso(),
    updated_at: nowIso(),
  });

  const runSuccess = await insertRow(ctx, "analytics_report_runs", {
    organization_id: ctx.organization.id,
    schedule_id: schedule.id,
    status: "success",
    recipients: [ctx.actorUser.email],
    report_from: from,
    report_to: to,
    delivered_at: nowIso(),
    created_at: nowIso(),
  });

  await insertRow(ctx, "analytics_report_runs", {
    organization_id: ctx.organization.id,
    schedule_id: schedule.id,
    status: "failed",
    recipients: [ctx.actorUser.email],
    report_from: addDays(now, -60).toISOString(),
    report_to: addDays(now, -30).toISOString(),
    error_message: "SMTP timeout during send",
    created_at: addDays(now, -29).toISOString(),
  });

  await insertRows(ctx, "analytics_metric_snapshots", [
    {
      organization_id: ctx.organization.id,
      metric_key: "sla_compliance",
      metric_scope: "current",
      metric_value: 92.4,
      period_from: from,
      period_to: to,
      source: "tinker",
      schedule_id: schedule.id,
      report_run_id: runSuccess.id,
      created_at: nowIso(),
    },
    {
      organization_id: ctx.organization.id,
      metric_key: "csat",
      metric_scope: "current",
      metric_value: 4.6,
      period_from: from,
      period_to: to,
      source: "tinker",
      schedule_id: schedule.id,
      report_run_id: runSuccess.id,
      created_at: nowIso(),
    },
    {
      organization_id: ctx.organization.id,
      metric_key: "revenue",
      metric_scope: "current",
      metric_value: 17950,
      period_from: from,
      period_to: to,
      source: "tinker",
      schedule_id: schedule.id,
      report_run_id: runSuccess.id,
      created_at: nowIso(),
    },
    {
      organization_id: ctx.organization.id,
      metric_key: "resolution_time_hours",
      metric_scope: "current",
      metric_value: 6.2,
      period_from: from,
      period_to: to,
      source: "tinker",
      schedule_id: schedule.id,
      report_run_id: runSuccess.id,
      created_at: nowIso(),
    },
    {
      organization_id: ctx.organization.id,
      metric_key: "incident_mttr_minutes",
      metric_scope: "current",
      metric_value: 44,
      period_from: from,
      period_to: to,
      source: "tinker",
      schedule_id: schedule.id,
      report_run_id: runSuccess.id,
      created_at: nowIso(),
    },
  ]);

  await writeAuditLog(ctx, {
    action: "analytics.seeded",
    entityType: "analytics_report_schedule",
    entityId: schedule.id,
  });

  ctx.runtime.completed.analytics = true;
  ctx.log.info("Scenario analytics complete.");
}

async function scenarioSecurity(ctx) {
  ctx.currentScenario = "security";

  if (await ctx.tableExists("passkeys")) {
    await insertRow(ctx, "passkeys", {
      user_id: ctx.actorUser.id,
      credential_id: `cred-${ctx.runtime.runTag}-${crypto.randomBytes(4).toString("hex")}`,
      public_key: crypto.randomBytes(32).toString("base64"),
      counter: 0,
      transports: ["internal"],
      user_name: ctx.actorUser.email,
      user_display_name: ctx.actorUser.name ?? ctx.actorUser.email,
      authenticator_attachment: "platform",
      device_info: { seeded: true, runTag: ctx.runtime.runTag },
      backup_eligible: true,
      backup_state: false,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
  }

  if (await ctx.tableExists("passkey_challenges")) {
    await insertRow(ctx, "passkey_challenges", {
      id: crypto.randomUUID(),
      user_id: ctx.actorUser.id,
      flow: "authenticate",
      challenge: crypto.randomBytes(32).toString("base64url"),
      expires_at: addMinutes(new Date(), 5).toISOString(),
      created_at: nowIso(),
    });
  }

  if (await ctx.tableExists("email_mfa_challenges")) {
    await upsertRow(
      ctx,
      "email_mfa_challenges",
      {
        user_id: ctx.actorUser.id,
        code_hash: makeCodeHash(`123456:${ctx.runtime.runTag}`),
        attempt_count: 0,
        expires_at: addMinutes(new Date(), 10).toISOString(),
        last_sent_at: nowIso(),
        created_at: nowIso(),
        updated_at: nowIso(),
      },
      "user_id",
    );
  }

  await writeAuditLog(ctx, {
    action: "security.seeded",
    entityType: "user",
    entityId: ctx.actorUser.id,
  });

  ctx.runtime.completed.security = true;
  ctx.log.info("Scenario security complete.");
}

const SCENARIO_RUNNERS = {
  team: scenarioTeam,
  tickets: scenarioTickets,
  orders: scenarioOrders,
  incidents: scenarioIncidents,
  sla: scenarioSla,
  automation: scenarioAutomation,
  communications: scenarioCommunications,
  rbac: scenarioRbac,
  portal: scenarioPortal,
  analytics: scenarioAnalytics,
  security: scenarioSecurity,
};

async function buildContext(supabase, options) {
  const log = logger("tinker");
  const tableExists = createTableChecker(supabase, log);
  const baseCtx = {
    supabase,
    tableExists,
    log,
    currentScenario: "setup",
    runtime: {
      runTag: compactRunTag(),
      users: {},
      customers: [],
      tickets: [],
      orders: [],
      services: [],
      incidents: [],
      invites: [],
      completed: {},
      teamReady: false,
    },
  };

  if (!(await tableExists("users"))) {
    throw new Error('Table "users" is required. Run db/topbar-schema.sql first.');
  }
  if (!(await tableExists("organizations"))) {
    throw new Error('Table "organizations" is required. Run db/topbar-schema.sql first.');
  }
  if (!(await tableExists("organization_memberships"))) {
    throw new Error('Table "organization_memberships" is required. Run db/topbar-schema.sql first.');
  }

  const actorUser = await ensureUserByEmail(baseCtx, options.email, options.createUser);
  const organization = await resolveOrganization(baseCtx, actorUser, options);

  return {
    ...baseCtx,
    actorUser,
    organization,
  };
}

function printScenarios() {
  console.log("Available scenarios:");
  for (const name of SCENARIO_ORDER) {
    console.log(`- ${name}: ${SCENARIOS[name]}`);
  }
}

function printSummary(ctx, scenarioNames) {
  console.log("");
  console.log("Tinker run complete.");
  console.log(`- User: ${ctx.actorUser.email} (${ctx.actorUser.id})`);
  console.log(`- Organization: ${ctx.organization.name} (${ctx.organization.slug})`);
  console.log(`- Run tag: ${ctx.runtime.runTag}`);
  console.log(`- Requested scenarios: ${scenarioNames.join(", ")}`);
  console.log(
    `- Completed scenarios: ${Object.keys(ctx.runtime.completed)
      .filter((key) => ctx.runtime.completed[key])
      .join(", ") || "none"}`,
  );
  console.log(
    `- Seeded entities: users=${Object.keys(ctx.runtime.users).length}, customers=${ctx.runtime.customers.length}, tickets=${ctx.runtime.tickets.length}, orders=${ctx.runtime.orders.length}, incidents=${ctx.runtime.incidents.length}`,
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }
  if (options.listScenarios) {
    printScenarios();
    return;
  }

  const supabase = createSupabaseAdminClient();

  if (options.listUsers) {
    await listUsers(supabase);
    return;
  }

  if (!options.email) {
    throw new Error('Missing --email. Use --email user@company.com or run with --list-users first.');
  }

  const scenarioNames = parseScenarioList(options.scenario);
  const ctx = await buildContext(supabase, options);

  ctx.log.info(`Running scenarios for ${ctx.actorUser.email} in org ${ctx.organization.slug}`);
  for (const name of scenarioNames) {
    const runner = SCENARIO_RUNNERS[name];
    if (!runner) {
      ctx.log.warn(`Scenario runner missing: ${name}`);
      continue;
    }
    await runner(ctx);
  }

  printSummary(ctx, scenarioNames);
}

main().catch((error) => {
  console.error(`[tinker] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
