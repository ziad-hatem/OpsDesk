# OpsDesk Database Schema

This document describes the full Postgres/Supabase schema for OpsDesk, as defined by the 19 SQL files under `db/`. It was produced by reading every file in that directory in full and cross-checking against the application code that queries these tables.

## Scope and how the schema is applied

There is no migration-tracking table (no `schema_migrations`, no Prisma/Drizzle/node-pg-migrate) and no committed CI step that applies these files. Each `db/*.sql` file is a standalone, idempotent script meant to be pasted into the Supabase SQL Editor by hand. Idempotency is achieved throughout via `create table if not exists`, `add column if not exists`, `create index if not exists`, and `do $$ ... exception when duplicate_object then null; end $$;` blocks around `create type` statements — so re-running any file against a database that already has it applied is safe.

Every file begins with `create extension if not exists pgcrypto;` (needed for `gen_random_uuid()`), except `mfa-email-schema.sql` and `notifications-realtime.sql`, which don't default any column to a generated UUID.

Because there's no schema-cache-invalidation hook, dozens of API routes across the app detect a "table missing" or "column missing" Postgres/PostgREST error at runtime and respond with a message of the form: *"Run `db/<file>.sql` in Supabase SQL Editor, then run: `NOTIFY pgrst, 'reload schema';`"*. That `NOTIFY` step is the de facto second half of the deployment runbook — Supabase's PostgREST layer caches the schema and won't see new tables/columns until it's told to reload.

## Multi-tenancy model

`organization_id uuid not null references public.organizations(id) on delete cascade` is present on essentially every domain table (tickets, orders, customers, incidents, automation, SLA, RBAC, communications, saved views, reports, invites, notifications, audit logs, customer portal). This column is how a single Postgres database serves every tenant — every query the application issues filters by it.

**Row-Level Security (RLS) is enabled on exactly 3 of the ~44 tables in this schema, and none of them are gated by `organization_id`:**

| Table | File | RLS keyed by |
|---|---|---|
| `public.passkeys` | `passkeys-schema.sql` | `user_id` (text, matched to `auth.uid()`) |
| `public.passkey_challenges` | `passkeys-schema.sql` | `user_id` (text, matched to `auth.uid()`) |
| `public.email_mfa_challenges` | `mfa-email-schema.sql` | `user_id` (text, matched to `auth.uid()`) |

Every other table — including `tickets`, `orders`, `customers`, `incidents`, `automation_rules`, `sla_policies`, `custom_roles`, `approval_requests`, `audit_logs`, `customer_communications`, and all the rest — has **no RLS policy at all**. No `alter table ... enable row level security` statement referencing `organization_id` exists anywhere in `db/`. Tenant isolation for the entire business-data surface is enforced **exclusively at the application layer**: every server-side query goes through `createSupabaseAdminClient()` (the Supabase service-role client, which bypasses RLS unconditionally) and is manually scoped with `.eq("organization_id", activeOrgId)`. If a route handler ever omitted that filter, Postgres itself would not stop a cross-tenant read or write — there is no database-level backstop. Treat this as a verified architectural characteristic of the current schema, not a guess: it was confirmed by reading all 19 files for `enable row level security`/`create policy` statements.

The 3 tables that do have RLS are all keyed on `user_id text` rather than `organization_id`, and that `user_id` column is **not** a foreign key to `public.users(id)` — it's a plain `text` column expected to hold the same UUID as Supabase Auth's `auth.uid()`. The policies exist as defense-in-depth for a hypothetical direct client-side query using a user's own Supabase session; in the code paths actually documented for this repo, all reads/writes to these three tables also go through the service-role client (bypassing RLS via the "service role" policy below), so the "self-access" policy is not the primary enforcement mechanism in practice — it is a second line of defense.

Each of those 3 tables carries the identical two-policy pattern:
- **Self-access** — a user can read/write only their own row. SQL: `for all using (auth.uid()::text = user_id)`. In plain English: any row where the currently-authenticated Supabase user's ID (cast to text) matches the row's `user_id` column is visible/writable to that user; nothing else is.
- **Service-role bypass** — the backend's service-role key can do anything. SQL: `for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role')`. In plain English: a connection authenticated as the Supabase service role (which is what `createSupabaseAdminClient()` uses) is exempt from the self-access restriction in both directions.

`public.users.id` is a `uuid primary key` with **no default value** — the application supplies it explicitly, always using the corresponding Supabase Auth user's ID. This is an application-level convention (every NextAuth/Supabase sign-in flow ends by upserting `public.users` keyed on the Supabase Auth UID), not a database constraint — there is no foreign key from `public.users.id` to Supabase's internal `auth.users` table (that table lives in a different schema, owned by Supabase, and is not part of this repo's migrations).

## Schema apply order

The files declare their own prerequisites via a header comment, quoted verbatim below (the wording varies file to file, but the intent is consistent). Where a file's stated prerequisite is not backed by an actual foreign key in that file, this is called out explicitly — the comment describes a *feature* dependency, not a *schema* dependency, in those cases.

| Order | File | Header comment (verbatim) | Adds |
|---|---|---|---|
| 1 | `topbar-schema.sql` | "Apply this once in your DB migration pipeline." | `organization_role` enum, `users`, `organizations`, `organization_memberships` (base), `notifications`, `notification_preferences`, `audit_logs` (base) |
| 2 | `team-schema.sql` | "Apply after db/topbar-schema.sql" | `organization_membership_status` enum, extends `organization_memberships`, `organization_invites` |
| 3 | `customers-schema.sql` | "Apply this after db/topbar-schema.sql and before/with db/tickets-schema.sql." | `customers`, `customer_contacts`, `customer_addresses`, `customer_metadata` |
| 4 | `tickets-schema.sql` | No stated predecessor ("Compatible with Supabase Postgres") — functionally requires `topbar-schema.sql` for `public.users` | `ticket_status`/`ticket_priority`/`ticket_text_type` enums, `tickets`, `ticket_texts`, `ticket_attachments` |
| 5 | `orders-schema.sql` | "Apply this after db/topbar-schema.sql and db/customers-schema.sql." | `order_status`/`order_payment_status` enums, `orders`, `order_items`, `order_status_events`, `order_attachments` |
| 6 | `orders-payments-schema.sql` | "Run this for existing databases that already have public.orders." | Patch: adds Stripe columns to `orders` if `orders-schema.sql` was applied before those columns existed. Has a hard runtime guard — `raise exception` if `public.orders` doesn't exist. |
| 7 | `sla-schema.sql` | "Apply this after db/topbar-schema.sql and db/tickets-schema.sql." | `sla_policies`, `ticket_sla_events` |
| 8 | `ticket-tags-schema.sql` | "Apply this after db/topbar-schema.sql and db/tickets-schema.sql." | `ticket_tags`, `ticket_tag_assignments` |
| 9 | `saved-views-schema.sql` | "Apply this after db/topbar-schema.sql." | `saved_views` |
| 10 | `automation-schema.sql` | "Apply this after db/topbar-schema.sql and db/tickets-schema.sql." | `automation_rules`, `automation_rule_runs` |
| 11 | `communications-schema.sql` | "Apply this after db/topbar-schema.sql, db/customers-schema.sql, and db/tickets-schema.sql." | `communication_channel`/`communication_direction` enums, `customer_communications` |
| 12 | `incidents-schema.sql` | "Apply this after db/topbar-schema.sql." | `incident_service_health`/`incident_status`/`incident_severity` enums, `status_services`, `incidents`, `incident_impacts`, `incident_updates` |
| 13 | `rbac-approvals-schema.sql` | "Apply this after db/topbar-schema.sql and db/team-schema.sql." | RBAC enums, `custom_roles`, `custom_role_permissions`, extends `organization_memberships`, `approval_policies`, `approval_requests`, `approval_request_decisions` |
| 14 | `audit-logs-schema.sql` | "Apply this after db/topbar-schema.sql." | Extends `audit_logs` (`target_user_id`, `source`, `details`) + indexes |
| 15 | `executive-analytics-schema.sql` | "Apply this after db/topbar-schema.sql, db/tickets-schema.sql, db/orders-schema.sql, and db/incidents-schema.sql." — **no actual FK to `tickets`, `orders`, or `incidents` exists in this file**; the stated dependency is about the *data* the reports summarize, not the schema | Analytics enums, `analytics_report_schedules`, `analytics_report_runs`, `analytics_metric_snapshots` |
| 16 | `mfa-email-schema.sql` | No stated predecessor | `email_mfa_challenges` (+ RLS) |
| 17 | `passkeys-schema.sql` | No stated predecessor | `passkeys`, `passkey_challenges` (+ RLS) |
| 18 | `customer-portal-schema.sql` | "Apply this after db/topbar-schema.sql, db/customers-schema.sql, db/tickets-schema.sql, and db/orders-schema.sql." — **no actual FK to `tickets` or `orders` exists in this file either**, same caveat as above | `customer_portal_login_links`, `customer_portal_sessions`, `customer_portal_identities` |
| 19 | `notifications-realtime.sql` | "Run this once in Supabase SQL Editor... then NOTIFY pgrst, 'reload schema';" | No new tables — re-enables the Supabase Realtime publication for `notifications` (duplicate of a block already in `topbar-schema.sql`) |

A real dependency graph, inferred from actual foreign keys rather than comments: `topbar-schema.sql` must run first (it creates `organizations`, `users`, `organization_memberships`, and the `organization_role` enum that nearly everything else's `escalation_role`/`approver_roles`/invite `role` columns reference). After that, `team-schema.sql` (extends `organization_memberships` with `status`, which `rbac-approvals-schema.sql` and many app-level fallback checks depend on), then `customers-schema.sql`, then `tickets-schema.sql` and `orders-schema.sql` (which cross-reference each other defensively — see below), then everything else.

**Conditional cross-file foreign keys.** Several tables declare `customer_id`, `order_id`, `ticket_id`, or `incident_id` columns as plain `uuid null` with no inline `references` clause, because the referenced table might not exist yet when that file is first run. Each such column gets its foreign key added later by a `do $$ ... if to_regclass('public.<target>') is not null ... end $$;` block, guarded by a `pg_constraint` existence check so it's safe to run from multiple files:

- `tickets.customer_id` → `customers.id` — added conditionally by both `customers-schema.sql` (lines 64-77) and `tickets-schema.sql` (lines 69-82), targeting the identical constraint name `tickets_customer_id_fkey`. Whichever file runs second simply no-ops.
- `tickets.order_id` → `orders.id` — added conditionally by both `orders-schema.sql` (lines 140-153) and `tickets-schema.sql` (lines 83-93), constraint name `tickets_order_id_fkey`.
- `customer_communications.ticket_id` / `.order_id` / `.incident_id` — each added conditionally by `communications-schema.sql` (lines 46-85), only if the respective target table already exists.

This means it is possible to have a live `tickets` or `customer_communications` row whose `customer_id`/`order_id`/`ticket_id`/etc. is populated but which is **not yet FK-constrained** by Postgres, if the referenced schema file hasn't been applied yet in that environment.

## Entity-relationship diagram

Legend: `||--o{` = required (NOT NULL) foreign key, one-to-many. `|o--o{` = optional (nullable) foreign key, zero-or-one-to-many. `||--||` = one-to-one. Only primary keys and foreign keys are shown as attributes — full column lists are in the per-domain sections below. `passkeys`, `passkey_challenges`, and `email_mfa_challenges` are deliberately drawn with no relationship lines to `USERS`: their `user_id` column is plain `text`, matched against Supabase Auth's `auth.uid()` at query time, and is not a foreign key to `public.users.id`.

```mermaid
erDiagram
    ORGANIZATIONS {
        uuid id PK
        text name
        text slug UK
    }
    USERS {
        uuid id PK
        text email UK
    }
    ORGANIZATION_MEMBERSHIPS {
        uuid id PK
        uuid user_id FK
        uuid organization_id FK
        uuid custom_role_id FK
        organization_role role
        organization_membership_status status
    }
    ORGANIZATION_INVITES {
        uuid id PK
        uuid organization_id FK
        uuid invited_by FK
        text email
        organization_role role
    }
    NOTIFICATIONS {
        uuid id PK
        uuid user_id FK
        uuid organization_id FK
        text type
    }
    NOTIFICATION_PREFERENCES {
        uuid user_id PK_FK
        text type PK
    }
    AUDIT_LOGS {
        uuid id PK
        uuid organization_id FK
        uuid actor_user_id FK
        uuid target_user_id FK
        text action
    }
    CUSTOMERS {
        uuid id PK
        uuid organization_id FK
        text name
        customer_status status
    }
    CUSTOMER_CONTACTS {
        uuid id PK
        uuid customer_id FK
    }
    CUSTOMER_ADDRESSES {
        uuid id PK
        uuid customer_id FK
    }
    CUSTOMER_METADATA {
        uuid customer_id PK_FK
        text key PK
    }
    TICKETS {
        uuid id PK
        uuid organization_id FK
        uuid customer_id FK
        uuid order_id FK
        uuid assignee_id FK
        uuid created_by FK
        ticket_status status
        ticket_priority priority
    }
    TICKET_TEXTS {
        uuid id PK
        uuid ticket_id FK
        uuid author_id FK
        ticket_text_type type
    }
    TICKET_ATTACHMENTS {
        uuid id PK
        uuid ticket_id FK
        uuid ticket_text_id FK
        uuid uploaded_by FK
    }
    TICKET_TAGS {
        uuid id PK
        uuid organization_id FK
        text name
    }
    TICKET_TAG_ASSIGNMENTS {
        uuid id PK
        uuid ticket_id FK
        uuid tag_id FK
    }
    ORDERS {
        uuid id PK
        uuid organization_id FK
        uuid customer_id FK
        text order_number
        order_status status
        order_payment_status payment_status
    }
    ORDER_ITEMS {
        uuid id PK
        uuid order_id FK
    }
    ORDER_STATUS_EVENTS {
        uuid id PK
        uuid order_id FK
        uuid actor_user_id FK
    }
    ORDER_ATTACHMENTS {
        uuid id PK
        uuid order_id FK
        uuid uploaded_by FK
    }
    SLA_POLICIES {
        uuid id PK
        uuid organization_id FK
        ticket_priority priority
    }
    TICKET_SLA_EVENTS {
        uuid id PK
        uuid ticket_id FK
        text event_type
    }
    AUTOMATION_RULES {
        uuid id PK
        uuid organization_id FK
        text entity_type
        text trigger_event
    }
    AUTOMATION_RULE_RUNS {
        uuid id PK
        uuid organization_id FK
        uuid rule_id FK
        text status
    }
    CUSTOMER_COMMUNICATIONS {
        uuid id PK
        uuid organization_id FK
        uuid customer_id FK
        uuid ticket_id FK
        uuid order_id FK
        uuid incident_id FK
        communication_channel channel
    }
    STATUS_SERVICES {
        uuid id PK
        uuid organization_id FK
        text slug
        incident_service_health current_status
    }
    INCIDENTS {
        uuid id PK
        uuid organization_id FK
        incident_status status
        incident_severity severity
    }
    INCIDENT_IMPACTS {
        uuid id PK
        uuid incident_id FK
        uuid service_id FK
    }
    INCIDENT_UPDATES {
        uuid id PK
        uuid incident_id FK
    }
    CUSTOM_ROLES {
        uuid id PK
        uuid organization_id FK
        text name
    }
    CUSTOM_ROLE_PERMISSIONS {
        uuid id PK
        uuid role_id FK
        text permission_key
    }
    APPROVAL_POLICIES {
        uuid id PK
        uuid organization_id FK
        text permission_key
    }
    APPROVAL_REQUESTS {
        uuid id PK
        uuid organization_id FK
        uuid policy_id FK
        uuid requested_by FK
        approval_request_status status
    }
    APPROVAL_REQUEST_DECISIONS {
        uuid id PK
        uuid request_id FK
        uuid decided_by FK
    }
    ANALYTICS_REPORT_SCHEDULES {
        uuid id PK
        uuid organization_id FK
        text name
    }
    ANALYTICS_REPORT_RUNS {
        uuid id PK
        uuid organization_id FK
        uuid schedule_id FK
        text status
    }
    ANALYTICS_METRIC_SNAPSHOTS {
        uuid id PK
        uuid organization_id FK
        uuid schedule_id FK
        uuid report_run_id FK
        text metric_key
    }
    SAVED_VIEWS {
        uuid id PK
        uuid organization_id FK
        uuid user_id FK
        text entity_type
    }
    CUSTOMER_PORTAL_LOGIN_LINKS {
        uuid id PK
        uuid organization_id FK
        uuid customer_id FK
    }
    CUSTOMER_PORTAL_SESSIONS {
        uuid id PK
        uuid organization_id FK
        uuid customer_id FK
    }
    CUSTOMER_PORTAL_IDENTITIES {
        uuid customer_id PK_FK
        uuid organization_id FK
        uuid user_id FK_UK
    }
    PASSKEYS {
        uuid id PK
        text user_id "no FK, matches auth.uid()"
        text credential_id UK
    }
    PASSKEY_CHALLENGES {
        text id PK
        text user_id "no FK, matches auth.uid()"
    }
    EMAIL_MFA_CHALLENGES {
        text user_id PK "no FK, matches auth.uid()"
    }

    ORGANIZATIONS ||--o{ ORGANIZATION_MEMBERSHIPS : "has"
    USERS ||--o{ ORGANIZATION_MEMBERSHIPS : "holds"
    CUSTOM_ROLES |o--o{ ORGANIZATION_MEMBERSHIPS : "optionally assigns"
    ORGANIZATIONS ||--o{ ORGANIZATION_INVITES : "has"
    USERS ||--o{ ORGANIZATION_INVITES : "invited_by"
    ORGANIZATIONS ||--o{ NOTIFICATIONS : "scopes"
    USERS ||--o{ NOTIFICATIONS : "recipient"
    USERS ||--o{ NOTIFICATION_PREFERENCES : "sets"
    ORGANIZATIONS ||--o{ AUDIT_LOGS : "scopes"
    USERS |o--o{ AUDIT_LOGS : "actor/target"
    ORGANIZATIONS ||--o{ CUSTOMERS : "owns"
    CUSTOMERS ||--o{ CUSTOMER_CONTACTS : "has"
    CUSTOMERS ||--o{ CUSTOMER_ADDRESSES : "has"
    CUSTOMERS ||--o{ CUSTOMER_METADATA : "has"
    ORGANIZATIONS ||--o{ TICKETS : "owns"
    CUSTOMERS |o--o{ TICKETS : "optionally links"
    ORDERS |o--o{ TICKETS : "optionally links"
    USERS |o--o{ TICKETS : "assignee/creator"
    TICKETS ||--o{ TICKET_TEXTS : "has"
    TICKETS ||--o{ TICKET_ATTACHMENTS : "has"
    TICKET_TEXTS |o--o{ TICKET_ATTACHMENTS : "optionally links"
    ORGANIZATIONS ||--o{ TICKET_TAGS : "owns"
    TICKETS ||--o{ TICKET_TAG_ASSIGNMENTS : "tagged"
    TICKET_TAGS ||--o{ TICKET_TAG_ASSIGNMENTS : "applied"
    ORGANIZATIONS ||--o{ ORDERS : "owns"
    CUSTOMERS ||--o{ ORDERS : "places"
    ORDERS ||--o{ ORDER_ITEMS : "has"
    ORDERS ||--o{ ORDER_STATUS_EVENTS : "has"
    ORDERS ||--o{ ORDER_ATTACHMENTS : "has"
    ORGANIZATIONS ||--o{ SLA_POLICIES : "sets"
    TICKETS ||--o{ TICKET_SLA_EVENTS : "has"
    ORGANIZATIONS ||--o{ AUTOMATION_RULES : "owns"
    AUTOMATION_RULES |o--o{ AUTOMATION_RULE_RUNS : "executes"
    ORGANIZATIONS ||--o{ CUSTOMER_COMMUNICATIONS : "logs"
    CUSTOMERS ||--o{ CUSTOMER_COMMUNICATIONS : "communicates"
    TICKETS |o--o{ CUSTOMER_COMMUNICATIONS : "optionally links"
    ORDERS |o--o{ CUSTOMER_COMMUNICATIONS : "optionally links"
    INCIDENTS |o--o{ CUSTOMER_COMMUNICATIONS : "optionally links"
    ORGANIZATIONS ||--o{ STATUS_SERVICES : "owns"
    ORGANIZATIONS ||--o{ INCIDENTS : "owns"
    INCIDENTS ||--o{ INCIDENT_IMPACTS : "has"
    STATUS_SERVICES ||--o{ INCIDENT_IMPACTS : "impacted"
    INCIDENTS ||--o{ INCIDENT_UPDATES : "has"
    ORGANIZATIONS ||--o{ CUSTOM_ROLES : "owns"
    CUSTOM_ROLES ||--o{ CUSTOM_ROLE_PERMISSIONS : "grants"
    ORGANIZATIONS ||--o{ APPROVAL_POLICIES : "owns"
    ORGANIZATIONS ||--o{ APPROVAL_REQUESTS : "owns"
    APPROVAL_POLICIES |o--o{ APPROVAL_REQUESTS : "governs"
    USERS ||--o{ APPROVAL_REQUESTS : "requests"
    APPROVAL_REQUESTS ||--o{ APPROVAL_REQUEST_DECISIONS : "decided"
    ORGANIZATIONS ||--o{ ANALYTICS_REPORT_SCHEDULES : "owns"
    ANALYTICS_REPORT_SCHEDULES |o--o{ ANALYTICS_REPORT_RUNS : "runs"
    ANALYTICS_REPORT_SCHEDULES |o--o{ ANALYTICS_METRIC_SNAPSHOTS : "tags"
    ANALYTICS_REPORT_RUNS |o--o{ ANALYTICS_METRIC_SNAPSHOTS : "tags"
    ORGANIZATIONS ||--o{ SAVED_VIEWS : "owns"
    USERS ||--o{ SAVED_VIEWS : "owns"
    ORGANIZATIONS ||--o{ CUSTOMER_PORTAL_LOGIN_LINKS : "owns"
    CUSTOMERS ||--o{ CUSTOMER_PORTAL_LOGIN_LINKS : "requests"
    ORGANIZATIONS ||--o{ CUSTOMER_PORTAL_SESSIONS : "owns"
    CUSTOMERS ||--o{ CUSTOMER_PORTAL_SESSIONS : "authenticates"
    CUSTOMERS ||--|| CUSTOMER_PORTAL_IDENTITIES : "mapped to"
    USERS ||--|| CUSTOMER_PORTAL_IDENTITIES : "synthetic user"
```

## Enum types reference

Every enum in the schema, its values in declaration order, and the file that first defines it. Postgres enums have an implicit ordinal order from their declaration — note the `incident_service_health` caveat below, since application code does not consistently treat that ordinal order as the severity ordering (see the Incidents section).

| Enum | Values (declaration order) | Defined in |
|---|---|---|
| `organization_role` | `admin`, `manager`, `support`, `read_only` | `topbar-schema.sql` |
| `organization_membership_status` | `active`, `suspended` | `team-schema.sql` |
| `customer_status` | `active`, `inactive`, `blocked` | `customers-schema.sql` |
| `customer_address_type` | `billing`, `shipping` | `customers-schema.sql` |
| `ticket_status` | `open`, `pending`, `resolved`, `closed` | `tickets-schema.sql` |
| `ticket_priority` | `low`, `medium`, `high`, `urgent` | `tickets-schema.sql` |
| `ticket_text_type` | `comment`, `internal_note`, `system` | `tickets-schema.sql` |
| `order_status` | `draft`, `pending`, `paid`, `fulfilled`, `cancelled`, `refunded` | `orders-schema.sql` |
| `order_payment_status` | `unpaid`, `payment_link_sent`, `paid`, `failed`, `refunded`, `expired`, `cancelled` | `orders-schema.sql` **and independently redeclared in** `orders-payments-schema.sql` (identical value list, each wrapped in its own idempotent `duplicate_object` handler — the two declarations must be kept in sync by hand if the value list ever changes) |
| `communication_channel` | `email`, `chat`, `whatsapp`, `sms` | `communications-schema.sql` |
| `communication_direction` | `inbound`, `outbound` | `communications-schema.sql` |
| `incident_service_health` | `operational`, `degraded`, `partial_outage`, `major_outage`, `maintenance` | `incidents-schema.sql` |
| `incident_status` | `investigating`, `identified`, `monitoring`, `resolved` | `incidents-schema.sql` |
| `incident_severity` | `critical`, `high`, `medium`, `low` | `incidents-schema.sql` |
| `rbac_permission_effect` | `allow`, `deny` | `rbac-approvals-schema.sql` |
| `approval_request_status` | `pending`, `approved`, `rejected`, `cancelled`, `expired` | `rbac-approvals-schema.sql` |
| `approval_decision` | `approved`, `rejected` | `rbac-approvals-schema.sql` |
| `analytics_schedule_frequency` | `daily`, `weekly`, `monthly` | `executive-analytics-schema.sql` |
| `analytics_report_run_status` | `success`, `failed` | `executive-analytics-schema.sql` |
| `analytics_metric_scope` | `current`, `previous`, `year` | `executive-analytics-schema.sql` |

`organization_role` is reused (not redeclared) by `organization_invites.role` (`team-schema.sql`), `sla_policies.escalation_role` (`sla-schema.sql`), and `approval_policies.approver_roles`/`approval_requests.approver_roles` (both `organization_role[]` arrays, `rbac-approvals-schema.sql`). `ticket_priority` is reused by `sla_policies.priority`. All other enums are used only within the file that defines them.

`entity_type` on `automation_rules`/`automation_rule_runs`, and `trigger_event` on the same two tables, and `event_type` on `ticket_sla_events`, and `status` on `automation_rule_runs`, and `entity_type`/`scope` on `saved_views` are **not** Postgres enum types — they are `text` columns constrained by inline `check (... in (...))` clauses. This is a deliberate difference in strictness from the true enum columns (`ticket_status`, `order_status`, etc.): a `check` constraint's allowed-value list can be altered in place with `alter table ... drop constraint ... add constraint ...` (which is exactly what `automation-schema.sql` and `executive-analytics-schema.sql` do in their upgrade blocks), whereas widening a real Postgres enum requires `alter type ... add value`.

---

## Domain: Topbar (`db/topbar-schema.sql`)

The foundation file. Creates the tenancy root (`organizations`), the user table, the base membership table, and the app-wide notifications/audit-log tables that every other domain writes into. This is the one file every other file transitively depends on.

### `public.users`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | primary key, no default — caller supplies it (the Supabase Auth user id, by application convention) |
| `name` | `text` | nullable |
| `email` | `text` | not null, unique |
| `password_hash` | `text` | nullable |
| `avatar_url` | `text` | nullable |
| `email_verified_at` | `timestamptz` | nullable |
| `created_at` | `timestamptz` | not null, default `now()` |
| `updated_at` | `timestamptz` | not null, default `now()` |

**Primary key**: `id`. No foreign keys out. No `updated_at` trigger exists for this table (nothing keeps `updated_at` current on writes).

### `public.organizations`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `name` | `text` | not null |
| `slug` | `text` | not null, unique |
| `logo_url` | `text` | nullable |
| `created_at` | `timestamptz` | not null, default `now()` |
| `updated_at` | `timestamptz` | not null, default `now()` |

**Primary key**: `id`. This is the tenancy root every domain table's `organization_id` points at. No `updated_at` trigger.

### `public.organization_memberships` (base definition — extended by `team-schema.sql` and `rbac-approvals-schema.sql`)

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `user_id` | `uuid` | not null, FK → `users(id)` on delete cascade |
| `organization_id` | `uuid` | not null, FK → `organizations(id)` on delete cascade |
| `role` | `organization_role` | not null |
| `created_at` | `timestamptz` | not null, default `now()` |

**Primary key**: `id`. **Unique constraint**: `(user_id, organization_id)` — a user can hold only one membership row per organization. See `team-schema.sql` for the `status`/`joined_at`/`updated_at` columns added later, and `rbac-approvals-schema.sql` for `custom_role_id`.

### `public.notifications`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `user_id` | `uuid` | not null, FK → `users(id)` on delete cascade |
| `organization_id` | `uuid` | not null, FK → `organizations(id)` on delete cascade |
| `type` | `text` | not null |
| `title` | `text` | not null |
| `body` | `text` | nullable |
| `entity_type` | `text` | nullable |
| `entity_id` | `text` | nullable |
| `read_at` | `timestamptz` | nullable — `null` means unread |
| `created_at` | `timestamptz` | not null, default `now()` |

**Primary key**: `id`. **Indexes**: `notifications_user_read_idx (user_id, read_at)`, `notifications_user_org_idx (user_id, organization_id)`. **Realtime**: `replica identity full` is set on this table, and it is conditionally added to the `supabase_realtime` Postgres publication (only if not already present). See the standalone `notifications-realtime.sql` script below, which duplicates this exact block.

### `public.notification_preferences`

| Column | Type | Constraints |
|---|---|---|
| `user_id` | `uuid` | not null, FK → `users(id)` on delete cascade, part of PK |
| `type` | `text` | not null, part of PK |
| `enabled` | `boolean` | not null, default `true` |

**Primary key**: `(user_id, type)`.

### `public.audit_logs` (base definition — extended by `audit-logs-schema.sql`)

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `organization_id` | `uuid` | not null, FK → `organizations(id)` on delete cascade |
| `actor_user_id` | `uuid` | nullable, FK → `users(id)` on delete set null |
| `action` | `text` | not null |
| `entity_type` | `text` | nullable |
| `entity_id` | `text` | nullable |
| `created_at` | `timestamptz` | not null, default `now()` |

**Primary key**: `id`. No `updated_at` column — audit logs are append-only. See `audit-logs-schema.sql` below for the `target_user_id`/`source`/`details` columns and full index set added on top of this base definition.

---

## Domain: Team & Invites (`db/team-schema.sql`)

Extends the base membership table with a suspension/active `status`, and adds the email-invite table that backs the "invite a teammate" flow.

### `public.organization_memberships` — additions

| Column added | Type | Constraints |
|---|---|---|
| `status` | `organization_membership_status` | not null, default `'active'` |
| `joined_at` | `timestamptz` | nullable |
| `updated_at` | `timestamptz` | not null, default `now()` |

**Indexes added**: unique `organization_memberships_org_user_uidx (organization_id, user_id)`; `organization_memberships_org_idx (organization_id)`; `organization_memberships_org_role_idx (organization_id, role)`; `organization_memberships_org_status_idx (organization_id, status)`.

This `status` column is the enforcement point for account suspension across the whole app — login gating (`auth.ts`), every `getOrganizationActorContext`/`getTicketRequestContext` call, and every RBAC check treats `status !== 'active'` as "no access." No `updated_at` trigger exists for `organization_memberships` despite the column being added here (unlike most other tables in this schema, which do get a trigger for their `updated_at` column).

### `public.organization_invites`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `organization_id` | `uuid` | not null, FK → `organizations(id)` on delete cascade |
| `email` | `varchar(255)` | not null |
| `role` | `organization_role` | not null |
| `token_hash` | `varchar(255)` | not null — **no unique constraint** (see caveat below) |
| `expires_at` | `timestamptz` | not null |
| `invited_by` | `uuid` | not null, FK → `users(id)` on delete restrict |
| `accepted_at` | `timestamptz` | nullable |
| `revoked_at` | `timestamptz` | nullable |
| `created_at` | `timestamptz` | not null, default `now()` |

**Primary key**: `id`. **Indexes**: `organization_invites_org_idx (organization_id)`, `organization_invites_org_email_idx (organization_id, email)`, `organization_invites_expires_idx (expires_at)`. No `updated_at` column/trigger.

**Note on `token_hash`**: unlike `customer_portal_login_links.token_hash` and `customer_portal_sessions.token_hash` (both `unique`, see the Customer Portal section), this column has no uniqueness constraint. The application relies solely on the token's 256 bits of randomness (`randomBytes(32)`) to avoid collisions — this is a real, verified structural inconsistency between two otherwise-similar token tables, not a guess.

---

## Domain: Customers (`db/customers-schema.sql`)

The customer/contact/address book. Only `public.customers` itself is referenced by the API routes documented for this app — `customer_contacts`, `customer_addresses`, and `customer_metadata` exist in the schema but no route reading/writing them was found in the application code reviewed.

### `public.customers`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `organization_id` | `uuid` | not null, FK → `organizations(id)` on delete cascade |
| `name` | `varchar(255)` | not null |
| `email` | `varchar(255)` | nullable |
| `phone` | `varchar(50)` | nullable |
| `status` | `customer_status` | not null, default `'active'` |
| `external_id` | `varchar(255)` | nullable |
| `created_at` | `timestamptz` | not null, default `now()` |
| `updated_at` | `timestamptz` | not null, default `now()` |

**Primary key**: `id`. **Trigger**: `customers_set_updated_at` (before update) → `set_customers_updated_at()`. **Conditional FK from `tickets`**: this file adds `tickets_customer_id_fkey` (`tickets.customer_id → customers.id on delete set null`) if `public.tickets` already exists. **Indexes**: `idx_customers_org (organization_id)`, `idx_customers_org_status (organization_id, status)`, `idx_customers_org_name (organization_id, name)`, `idx_customers_org_email (organization_id, email)`.

### `public.customer_contacts`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `organization_id` | `uuid` | not null, FK → `organizations(id)` on delete cascade |
| `customer_id` | `uuid` | not null, FK → `customers(id)` on delete cascade |
| `name` | `varchar(255)` | not null |
| `email` | `varchar(255)` | nullable |
| `phone` | `varchar(50)` | nullable |
| `role` | `varchar(100)` | nullable |
| `created_at` | `timestamptz` | not null, default `now()` |

**Primary key**: `id`. **Index**: `idx_customer_contacts_org_customer (organization_id, customer_id)`. No `updated_at` column/trigger.

### `public.customer_addresses`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `organization_id` | `uuid` | not null, FK → `organizations(id)` on delete cascade |
| `customer_id` | `uuid` | not null, FK → `customers(id)` on delete cascade |
| `type` | `customer_address_type` | not null (`billing` or `shipping`) |
| `line1` | `text` | not null |
| `line2` | `text` | nullable |
| `city` | `text` | nullable |
| `state` | `text` | nullable |
| `postal_code` | `text` | nullable |
| `country` | `text` | nullable |
| `created_at` | `timestamptz` | not null, default `now()` |

**Primary key**: `id`. **Index**: `idx_customer_addresses_org_customer (organization_id, customer_id)`.

### `public.customer_metadata`

| Column | Type | Constraints |
|---|---|---|
| `customer_id` | `uuid` | not null, FK → `customers(id)` on delete cascade, part of PK |
| `key` | `text` | not null, part of PK |
| `value` | `text` | nullable |

**Primary key**: `(customer_id, key)`. A generic key/value store per customer; no index beyond the PK.

---

## Domain: Tickets (`db/tickets-schema.sql`)

The core support-ticket domain: tickets, their message/comment/system-note timeline, and file attachments.

### `public.tickets`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `organization_id` | `uuid` | not null, FK → `organizations(id)` on delete cascade |
| `customer_id` | `uuid` | nullable — **no inline FK**; added conditionally (see cross-file FK note above) |
| `order_id` | `uuid` | nullable — **no inline FK**; added conditionally |
| `title` | `varchar(255)` | not null |
| `description` | `text` | nullable |
| `status` | `ticket_status` | not null, default `'open'` |
| `priority` | `ticket_priority` | not null, default `'medium'` |
| `assignee_id` | `uuid` | nullable, FK → `users(id)` on delete set null |
| `created_by` | `uuid` | not null, FK → `users(id)` on delete restrict |
| `sla_due_at` | `timestamptz` | nullable |
| `created_at` | `timestamptz` | not null, default `now()` |
| `updated_at` | `timestamptz` | not null, default `now()` |
| `closed_at` | `timestamptz` | nullable |

**Primary key**: `id`. **Foreign keys**: `assignee_id`, `created_by` (inline); `customer_id` → `customers.id` on delete set null, `order_id` → `orders.id` on delete set null (both added conditionally, this file and the customers/orders files defensively add the same two constraints). **Trigger**: `tickets_set_updated_at` (before update) → `set_tickets_updated_at()`. **Indexes**: `idx_tickets_org (organization_id)`, `idx_tickets_org_status (organization_id, status)`, `idx_tickets_org_assignee (organization_id, assignee_id)`, `idx_tickets_org_created_at (organization_id, created_at desc)`.

### `public.ticket_texts`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `organization_id` | `uuid` | not null, FK → `organizations(id)` on delete cascade |
| `ticket_id` | `uuid` | not null, FK → `tickets(id)` on delete cascade |
| `author_id` | `uuid` | not null, FK → `users(id)` on delete restrict |
| `type` | `ticket_text_type` | not null, default `'comment'` (`comment` \| `internal_note` \| `system`) |
| `body` | `text` | not null |
| `created_at` | `timestamptz` | not null, default `now()` |
| `updated_at` | `timestamptz` | nullable |

**Primary key**: `id`. **Trigger**: `ticket_texts_set_updated_at` (before update) — reuses the same `set_tickets_updated_at()` function as the `tickets` table. **Indexes**: `idx_ticket_texts_ticket_created_at (ticket_id, created_at)`, `idx_ticket_texts_org (organization_id)`.

### `public.ticket_attachments`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `organization_id` | `uuid` | not null, FK → `organizations(id)` on delete cascade |
| `ticket_id` | `uuid` | not null, FK → `tickets(id)` on delete cascade |
| `ticket_text_id` | `uuid` | nullable, FK → `ticket_texts(id)` on delete set null |
| `file_name` | `varchar(255)` | not null |
| `file_size` | `bigint` | not null, default `0` |
| `mime_type` | `varchar(150)` | not null |
| `storage_key` | `varchar(255)` | not null, unique |
| `uploaded_by` | `uuid` | not null, FK → `users(id)` on delete restrict |
| `created_at` | `timestamptz` | not null, default `now()` |

**Primary key**: `id`. **Indexes**: `idx_ticket_attachments_ticket (ticket_id, created_at)`, `idx_ticket_attachments_org (organization_id)`.

---

## Domain: Orders (`db/orders-schema.sql`)

Orders and their line items, status-transition history, and attachments. This file already contains the Stripe payment-tracking columns inline; `orders-payments-schema.sql` (next section) exists only to backfill those columns onto a database that ran an older version of this file.

### `public.orders`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `organization_id` | `uuid` | not null, FK → `organizations(id)` on delete cascade |
| `customer_id` | `uuid` | not null, FK → `customers(id)` on delete restrict |
| `order_number` | `varchar(50)` | not null |
| `status` | `order_status` | not null, default `'draft'` |
| `payment_status` | `order_payment_status` | not null, default `'unpaid'` |
| `currency` | `char(3)` | not null |
| `subtotal_amount` | `bigint` | not null, default `0`, check `>= 0` |
| `tax_amount` | `bigint` | not null, default `0`, check `>= 0` |
| `discount_amount` | `bigint` | not null, default `0`, check `>= 0` |
| `total_amount` | `bigint` | not null, default `0`, check `>= 0` |
| `placed_at` | `timestamptz` | nullable |
| `paid_at` | `timestamptz` | nullable |
| `fulfilled_at` | `timestamptz` | nullable |
| `cancelled_at` | `timestamptz` | nullable |
| `stripe_checkout_session_id` | `varchar(255)` | nullable |
| `stripe_payment_intent_id` | `varchar(255)` | nullable |
| `payment_link_url` | `text` | nullable |
| `payment_link_sent_at` | `timestamptz` | nullable |
| `payment_completed_at` | `timestamptz` | nullable |
| `notes` | `text` | nullable |
| `created_by` | `uuid` | not null, FK → `users(id)` on delete restrict |
| `created_at` | `timestamptz` | not null, default `now()` |
| `updated_at` | `timestamptz` | not null, default `now()` |

All monetary amounts (`subtotal_amount`, `tax_amount`, `discount_amount`, `total_amount`) are stored as non-negative integers in the currency's minor unit (cents).

**Primary key**: `id`. **Table-level constraints**: `orders_org_order_number_unique` — unique `(organization_id, order_number)`; `orders_totals_consistency_check` — `check (total_amount = subtotal_amount + tax_amount - discount_amount)`. **Trigger**: `orders_set_updated_at` (before update) → `set_orders_updated_at()`. **Conditional FK to `tickets`**: this file adds `tickets_order_id_fkey` if `public.tickets` already exists. **Indexes**: `idx_orders_org (organization_id)`, `idx_orders_org_customer (organization_id, customer_id)`, `idx_orders_org_status (organization_id, status)`, `idx_orders_org_payment_status (organization_id, payment_status)`, `idx_orders_org_created_at (organization_id, created_at desc)`, unique `idx_orders_stripe_checkout_session_id_unique (stripe_checkout_session_id) where stripe_checkout_session_id is not null`, `idx_orders_stripe_payment_intent_id (stripe_payment_intent_id) where ... is not null`, `idx_orders_org_payment_completed_at (organization_id, payment_completed_at desc)`.

### `public.order_items`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `organization_id` | `uuid` | not null, FK → `organizations(id)` on delete cascade |
| `order_id` | `uuid` | not null, FK → `orders(id)` on delete cascade |
| `sku` | `varchar(100)` | nullable |
| `name` | `varchar(255)` | not null |
| `quantity` | `integer` | not null, check `> 0` |
| `unit_price_amount` | `bigint` | not null, check `>= 0` |
| `total_amount` | `bigint` | not null, check `>= 0` |
| `created_at` | `timestamptz` | not null, default `now()` |

**Primary key**: `id`. **Indexes**: `idx_order_items_order (order_id)`, `idx_order_items_org_order (organization_id, order_id)`.

### `public.order_status_events`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `organization_id` | `uuid` | not null, FK → `organizations(id)` on delete cascade |
| `order_id` | `uuid` | not null, FK → `orders(id)` on delete cascade |
| `from_status` | `order_status` | not null |
| `to_status` | `order_status` | not null |
| `actor_user_id` | `uuid` | nullable, FK → `users(id)` on delete set null |
| `reason` | `text` | nullable |
| `created_at` | `timestamptz` | not null, default `now()` |

**Primary key**: `id`. Append-only audit trail of order status transitions; `actor_user_id` is `null` for system-originated transitions (e.g. the Stripe webhook). **Index**: `idx_order_status_events_order_created_at (order_id, created_at desc)`.

### `public.order_attachments`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `organization_id` | `uuid` | not null, FK → `organizations(id)` on delete cascade |
| `order_id` | `uuid` | not null, FK → `orders(id)` on delete cascade |
| `file_name` | `varchar(255)` | not null |
| `file_size` | `bigint` | not null, default `0`, check `>= 0` |
| `mime_type` | `varchar(150)` | not null |
| `storage_key` | `varchar(255)` | not null, unique |
| `uploaded_by` | `uuid` | not null, FK → `users(id)` on delete restrict |
| `created_at` | `timestamptz` | not null, default `now()` |

**Primary key**: `id`. **Indexes**: `idx_order_attachments_order_created_at (order_id, created_at desc)`, `idx_order_attachments_org (organization_id)`.

---

## Domain: Orders Payment Extension (`db/orders-payments-schema.sql`)

A patch file, not a fresh-create file. It exists for a database that already ran an older copy of `orders-schema.sql` predating the Stripe columns. It does not create any table; it only ensures the Stripe-related columns and their indexes exist on `public.orders`.

It contains a hard runtime guard — `if to_regclass('public.orders') is null then raise exception 'public.orders table is missing. Run db/orders-schema.sql first.';` — so running this file against a database that never ran `orders-schema.sql` fails loudly rather than silently.

Columns ensured on `public.orders` (all `add column if not exists`): `payment_status public.order_payment_status not null default 'unpaid'`, `stripe_checkout_session_id varchar(255)`, `stripe_payment_intent_id varchar(255)`, `payment_link_url text`, `payment_link_sent_at timestamptz`, `payment_completed_at timestamptz`. Indexes ensured: `idx_orders_org_payment_status`, unique `idx_orders_stripe_checkout_session_id_unique`, `idx_orders_stripe_payment_intent_id`, `idx_orders_org_payment_completed_at` — identical to the ones already declared inline in `orders-schema.sql`. Because the `order_payment_status` enum is independently (re)declared here as well (see the Enum reference table above), the two files' enum definitions must be kept in sync by hand if the value list ever changes.

---

## Domain: SLA Engine (`db/sla-schema.sql`)

Per-priority response/resolution time targets, and a log of every warning/breach/escalation event raised against a ticket.

### `public.sla_policies`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `organization_id` | `uuid` | not null, FK → `organizations(id)` on delete cascade |
| `priority` | `ticket_priority` | not null |
| `first_response_minutes` | `integer` | not null, check `> 0` |
| `resolution_minutes` | `integer` | not null, check `> 0` |
| `warning_minutes` | `integer` | not null, default `60`, check `>= 0` |
| `escalation_role` | `organization_role` | not null, default `'manager'` |
| `auto_escalate` | `boolean` | not null, default `true` |
| `created_at` | `timestamptz` | not null, default `now()` |
| `updated_at` | `timestamptz` | not null, default `now()` |

**Primary key**: `id`. **Unique constraint**: `sla_policies_org_priority_unique (organization_id, priority)` — exactly one policy row per priority per org; this is what the app's `PATCH /api/sla/policies` upsert relies on. **Trigger**: `sla_policies_set_updated_at` (before update) → `set_sla_policies_updated_at()`. **Indexes**: `idx_sla_policies_org (organization_id)`, `idx_sla_policies_org_priority (organization_id, priority)`.

### `public.ticket_sla_events`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `organization_id` | `uuid` | not null, FK → `organizations(id)` on delete cascade |
| `ticket_id` | `uuid` | not null, FK → `tickets(id)` on delete cascade |
| `event_type` | `text` | not null, check `in ('first_response_warning', 'first_response_breached', 'resolution_warning', 'resolution_breached', 'auto_escalated')` |
| `due_at` | `timestamptz` | nullable |
| `metadata` | `jsonb` | nullable |
| `created_at` | `timestamptz` | not null, default `now()` |

**Primary key**: `id`. **Dedup mechanism**: unique index `idx_ticket_sla_events_dedupe` on `(organization_id, ticket_id, event_type, coalesce(due_at, '1970-01-01 00:00:00+00'))` — this is a database-level idempotency guarantee: the same event type for the same ticket at the same due-at timestamp can only be recorded once, which is what lets the application-level SLA sweep be re-run safely without double-counting. **Other indexes**: `idx_ticket_sla_events_org_created_at (organization_id, created_at desc)`, `idx_ticket_sla_events_org_ticket_created_at (organization_id, ticket_id, created_at desc)`, `idx_ticket_sla_events_org_event_created_at (organization_id, event_type, created_at desc)`.

---

## Domain: Ticket Tags (`db/ticket-tags-schema.sql`)

Org-scoped tag catalog and a many-to-many join to tickets.

### `public.ticket_tags`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `organization_id` | `uuid` | not null, FK → `organizations(id)` on delete cascade |
| `name` | `varchar(50)` | not null |
| `color` | `varchar(20)` | nullable |
| `created_by` | `uuid` | not null, FK → `users(id)` on delete restrict |
| `created_at` | `timestamptz` | not null, default `now()` |

**Primary key**: `id`. **Unique constraint**: `ticket_tags_org_name_unique (organization_id, name)`. **Indexes**: `idx_ticket_tags_org (organization_id)`, `idx_ticket_tags_org_name (organization_id, name)`.

### `public.ticket_tag_assignments`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `organization_id` | `uuid` | not null, FK → `organizations(id)` on delete cascade |
| `ticket_id` | `uuid` | not null, FK → `tickets(id)` on delete cascade |
| `tag_id` | `uuid` | not null, FK → `ticket_tags(id)` on delete cascade |
| `created_at` | `timestamptz` | not null, default `now()` |

**Primary key**: `id`. **Unique constraint**: `ticket_tag_assignments_unique (ticket_id, tag_id)` — a tag can only be applied once per ticket. **Indexes**: `idx_ticket_tag_assignments_org (organization_id)`, `idx_ticket_tag_assignments_org_ticket (organization_id, ticket_id)`, `idx_ticket_tag_assignments_org_tag (organization_id, tag_id)`.

---

## Domain: Saved Views (`db/saved-views-schema.sql`)

Per-user (or per-team) saved filter presets for the tickets/orders/customers list pages.

### `public.saved_views`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `organization_id` | `uuid` | not null, FK → `organizations(id)` on delete cascade |
| `user_id` | `uuid` | not null, FK → `users(id)` on delete cascade |
| `entity_type` | `text` | not null, check `in ('tickets', 'orders', 'customers')` |
| `scope` | `text` | not null, default `'personal'`, check `in ('personal', 'team')` |
| `name` | `varchar(80)` | not null |
| `filters` | `jsonb` | not null, default `'{}'` |
| `is_favorite` | `boolean` | not null, default `false` |
| `created_at` | `timestamptz` | not null, default `now()` |
| `updated_at` | `timestamptz` | not null, default `now()` |

**Primary key**: `id`. **Unique constraint**: `saved_views_unique_name_per_entity (organization_id, user_id, entity_type, name)`. **Trigger**: `saved_views_set_updated_at` (before update) → `set_saved_views_updated_at()`. **Indexes**: `idx_saved_views_org_user_entity (organization_id, user_id, entity_type)`, `idx_saved_views_org_user_entity_created_at (organization_id, user_id, entity_type, created_at desc)`, `idx_saved_views_org_entity_scope (organization_id, entity_type, scope, created_at desc)`.

The `scope` column and its `check` constraint are declared inline in the `create table` statement, and then **redundantly re-added** a second time via a defensive `add column if not exists` + a separate `add constraint ... exception when duplicate_object` block immediately below. This inline-plus-defensive-patch pattern recurs across several files in this schema (see `orders-schema.sql`'s Stripe columns and `automation-schema.sql`'s check-constraint refresh block) — it looks like each file evolved over time and later additions were appended below the original `create table` rather than the file being rewritten, so the same column ends up declared twice in one file. This is an observed pattern in the source, not a confirmed design choice.

---

## Domain: Automation Rules (`db/automation-schema.sql`)

Configurable trigger → condition → action rules per organization, and an execution log.

### `public.automation_rules`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `organization_id` | `uuid` | not null, FK → `organizations(id)` on delete cascade |
| `entity_type` | `text` | not null, check `in ('ticket', 'order', 'customer', 'incident', 'portal')` |
| `name` | `varchar(100)` | not null |
| `description` | `text` | nullable |
| `trigger_event` | `text` | not null, check `in (` 12 literal event strings, see below `)` |
| `conditions` | `jsonb` | not null, default `'{}'` |
| `actions` | `jsonb` | not null, default `'[]'` |
| `is_enabled` | `boolean` | not null, default `true` |
| `archived_at` | `timestamptz` | nullable |
| `created_by` | `uuid` | nullable, FK → `users(id)` on delete set null |
| `created_at` | `timestamptz` | not null, default `now()` |
| `updated_at` | `timestamptz` | not null, default `now()` |

The 12 allowed `trigger_event` values: `ticket.created`, `ticket.updated`, `order.created`, `order.updated`, `customer.created`, `customer.updated`, `incident.created`, `incident.updated`, `portal.auth_link_requested`, `portal.auth_verified`, `portal.ticket_replied`, `portal.order_payment_started`.

**Primary key**: `id`. **Unique constraint**: `automation_rules_org_entity_name_unique (organization_id, entity_type, name)` — this is what makes the application's default-rule seeding idempotent (rules are matched by name). **Trigger**: `automation_rules_set_updated_at` (before update) → `set_automation_rules_updated_at()`. **Indexes**: `idx_automation_rules_org (organization_id)`, `idx_automation_rules_org_entity_event_enabled (organization_id, entity_type, trigger_event, is_enabled)`, `idx_automation_rules_org_created_at (organization_id, created_at desc)`, `idx_automation_rules_org_archived_at (organization_id, archived_at)`.

### `public.automation_rule_runs`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `organization_id` | `uuid` | not null, FK → `organizations(id)` on delete cascade |
| `rule_id` | `uuid` | nullable, FK → `automation_rules(id)` on delete set null |
| `entity_type` | `text` | not null, same 5-value check as above |
| `entity_id` | `text` | not null |
| `trigger_event` | `text` | not null, same 12-value check as above |
| `status` | `text` | not null, check `in ('executed', 'skipped', 'failed')` |
| `details` | `jsonb` | nullable |
| `created_at` | `timestamptz` | not null, default `now()` |

**Primary key**: `id`. No FK from `entity_id`/`entity_type` to the actual ticket/order/customer/incident tables — this is a polymorphic reference by convention only, not enforced by the database. **Indexes**: `idx_automation_rule_runs_org_created_at (organization_id, created_at desc)`, `idx_automation_rule_runs_org_rule_created_at (organization_id, rule_id, created_at desc)`, `idx_automation_rule_runs_org_entity_created_at (organization_id, entity_type, entity_id, created_at desc)`, `idx_automation_rule_runs_org_status_created_at (organization_id, status, created_at desc)`.

This file also contains a `do $$` block that drops and re-adds the `entity_type`/`trigger_event` check constraints on both tables (each wrapped in its own `duplicate_object`-tolerant sub-block). This is the upgrade mechanism for widening the allowed-value lists on an existing database (e.g., adding `'portal'`/`'incident'` support later) without a full table rebuild — since these are `text` + `check`, not true enums, this `drop constraint` / `add constraint` pattern works. It also re-adds `archived_at` via `add column if not exists`, redundant with the inline `create table` definition (same pattern noted in Saved Views above).

---

## Domain: Communications (`db/communications-schema.sql`)

A single append-only log of every inbound/outbound customer-facing message (email, chat, WhatsApp, SMS), independent of the internal `notifications` table.

### `public.customer_communications`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `organization_id` | `uuid` | not null, FK → `organizations(id)` on delete cascade |
| `customer_id` | `uuid` | not null, FK → `customers(id)` on delete cascade |
| `channel` | `communication_channel` | not null |
| `direction` | `communication_direction` | not null |
| `provider` | `varchar(80)` | nullable |
| `provider_message_id` | `varchar(255)` | nullable |
| `thread_key` | `varchar(255)` | nullable |
| `subject` | `text` | nullable |
| `body` | `text` | not null |
| `sender_name` | `varchar(255)` | nullable |
| `sender_email` | `varchar(255)` | nullable |
| `sender_phone` | `varchar(50)` | nullable |
| `recipient_name` | `varchar(255)` | nullable |
| `recipient_email` | `varchar(255)` | nullable |
| `recipient_phone` | `varchar(50)` | nullable |
| `actor_user_id` | `uuid` | nullable, FK → `users(id)` on delete set null |
| `ticket_id` | `uuid` | nullable — **no inline FK**; added conditionally |
| `order_id` | `uuid` | nullable — **no inline FK**; added conditionally |
| `incident_id` | `uuid` | nullable — **no inline FK**; added conditionally |
| `metadata` | `jsonb` | nullable |
| `occurred_at` | `timestamptz` | not null, default `now()` |
| `created_at` | `timestamptz` | not null, default `now()` |

**Primary key**: `id`. **Conditional foreign keys**: `customer_communications_ticket_id_fkey` (→ `tickets.id` on delete set null), `customer_communications_order_id_fkey` (→ `orders.id` on delete set null), `customer_communications_incident_id_fkey` (→ `incidents.id` on delete set null) — each added only if the target table already exists at the time this file runs. **Dedup mechanism**: unique partial index `idx_customer_communications_org_provider_message_unique (organization_id, provider, provider_message_id) where provider is not null and provider_message_id is not null` — this is what makes inbound webhook delivery idempotent (a redelivered provider message with the same `provider`+`provider_message_id` collides, and the application treats that as "already recorded" rather than an error). **Other indexes**: `idx_customer_communications_org_created_at (organization_id, created_at desc)`, `idx_customer_communications_org_customer_occurred_at (organization_id, customer_id, occurred_at desc)`, `idx_customer_communications_org_channel_occurred_at (organization_id, channel, occurred_at desc)`, `idx_customer_communications_org_ticket_occurred_at (organization_id, ticket_id, occurred_at desc)`, `idx_customer_communications_org_order_occurred_at (organization_id, order_id, occurred_at desc)`, `idx_customer_communications_org_incident_occurred_at (organization_id, incident_id, occurred_at desc)`. No `updated_at` column — append-only.

---

## Domain: Incidents & Public Status Page (`db/incidents-schema.sql`)

Internal incident management plus the "services" a public status page displays.

### `public.status_services`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `organization_id` | `uuid` | not null, FK → `organizations(id)` on delete cascade |
| `name` | `varchar(120)` | not null |
| `slug` | `varchar(140)` | not null |
| `description` | `text` | nullable |
| `current_status` | `incident_service_health` | not null, default `'operational'` |
| `is_public` | `boolean` | not null, default `true` |
| `display_order` | `integer` | not null, default `0` |
| `created_by` | `uuid` | nullable, FK → `users(id)` on delete set null |
| `created_at` | `timestamptz` | not null, default `now()` |
| `updated_at` | `timestamptz` | not null, default `now()` |

**Primary key**: `id`. **Unique constraint**: `status_services_org_slug_unique (organization_id, slug)`. **Trigger**: `status_services_set_updated_at` (before update) → `set_status_services_updated_at()`. **Indexes**: `idx_status_services_org_display_order (organization_id, display_order, name)`, `idx_status_services_org_status (organization_id, current_status)`, `idx_status_services_org_public (organization_id, is_public)`.

### `public.incidents`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `organization_id` | `uuid` | not null, FK → `organizations(id)` on delete cascade |
| `title` | `varchar(200)` | not null |
| `summary` | `text` | nullable |
| `status` | `incident_status` | not null, default `'investigating'` |
| `severity` | `incident_severity` | not null, default `'medium'` |
| `is_public` | `boolean` | not null, default `true` |
| `started_at` | `timestamptz` | not null, default `now()` |
| `resolved_at` | `timestamptz` | nullable |
| `created_by` | `uuid` | nullable, FK → `users(id)` on delete set null |
| `created_at` | `timestamptz` | not null, default `now()` |
| `updated_at` | `timestamptz` | not null, default `now()` |

**Primary key**: `id`. **No `customer_id` column** — an incident is not linked to any specific customer at the database level; there is no foreign key from this table to `customers` at all. **Trigger**: `incidents_set_updated_at` (before update) → `set_incidents_updated_at()`. **Indexes**: `idx_incidents_org_started_at (organization_id, started_at desc)`, `idx_incidents_org_status (organization_id, status, severity, started_at desc)`, `idx_incidents_org_public (organization_id, is_public, started_at desc)`.

### `public.incident_impacts`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `organization_id` | `uuid` | not null, FK → `organizations(id)` on delete cascade |
| `incident_id` | `uuid` | not null, FK → `incidents(id)` on delete cascade |
| `service_id` | `uuid` | not null, FK → `status_services(id)` on delete cascade |
| `impact_level` | `incident_service_health` | not null, default `'degraded'` |
| `created_at` | `timestamptz` | not null, default `now()` |

**Primary key**: `id`. **Unique constraint**: `incident_impacts_incident_service_unique (incident_id, service_id)` — one impact row per service per incident. **Indexes**: `idx_incident_impacts_org_incident (organization_id, incident_id)`, `idx_incident_impacts_org_service (organization_id, service_id)`.

### `public.incident_updates`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `organization_id` | `uuid` | not null, FK → `organizations(id)` on delete cascade |
| `incident_id` | `uuid` | not null, FK → `incidents(id)` on delete cascade |
| `message` | `text` | not null |
| `status` | `incident_status` | nullable |
| `is_public` | `boolean` | not null, default `true` |
| `created_by` | `uuid` | nullable, FK → `users(id)` on delete set null |
| `created_at` | `timestamptz` | not null, default `now()` |

**Primary key**: `id`. **Indexes**: `idx_incident_updates_org_incident_created_at (organization_id, incident_id, created_at asc)` (one of only two ascending-order indexes in the entire schema — the other is `idx_approval_request_decisions_org_request_created_at` on `approval_request_decisions`; every other timestamp index in this schema is `desc`), `idx_incident_updates_org_public_created_at (organization_id, is_public, created_at desc)`.

**Severity-ordering caveat**: `incident_service_health`'s declaration order (`operational`, `degraded`, `partial_outage`, `major_outage`, `maintenance`) does not correspond to any single canonical "worst to best" ranking used consistently by the application. Application code independently defines two different numeric rankings of this same enum for two different purposes (one treats `maintenance` as the most severe state, the other treats it as only slightly worse than `operational`) — this is an application-layer inconsistency, not a schema-level one, but it means the enum's declaration order should not be read as an implied severity order.

---

## Domain: RBAC & Approvals (`db/rbac-approvals-schema.sql`)

Org-defined custom roles with allow/deny permission overrides, and an approval-request workflow that can gate specific permitted actions behind a second sign-off.

### `public.custom_roles`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `organization_id` | `uuid` | not null, FK → `organizations(id)` on delete cascade |
| `name` | `varchar(80)` | not null |
| `description` | `text` | nullable |
| `is_system` | `boolean` | not null, default `false` |
| `created_by` | `uuid` | nullable, FK → `users(id)` on delete set null |
| `created_at` | `timestamptz` | not null, default `now()` |
| `updated_at` | `timestamptz` | not null, default `now()` |

**Primary key**: `id`. **Unique constraint**: `custom_roles_org_name_unique (organization_id, name)`. **Trigger**: `custom_roles_set_updated_at` (before update) → `set_custom_roles_updated_at()`. **Index**: `idx_custom_roles_org_created_at (organization_id, created_at desc)`.

### `public.custom_role_permissions`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `organization_id` | `uuid` | not null, FK → `organizations(id)` on delete cascade |
| `role_id` | `uuid` | not null, FK → `custom_roles(id)` on delete cascade |
| `permission_key` | `varchar(160)` | not null |
| `effect` | `rbac_permission_effect` | not null, default `'allow'` |
| `created_at` | `timestamptz` | not null, default `now()` |

**Primary key**: `id`. **Unique constraint**: `custom_role_permissions_unique (role_id, permission_key, effect)` — a given permission key can appear at most once per allow/deny effect for a role (in principle a role could have both an `allow` and a `deny` row for the same key, though the application's evaluation order treats deny as authoritative). **Indexes**: `idx_custom_role_permissions_org_role (organization_id, role_id)`, `idx_custom_role_permissions_org_permission (organization_id, permission_key)`.

### `public.organization_memberships` — addition

| Column added | Type | Constraints |
|---|---|---|
| `custom_role_id` | `uuid` | nullable, FK → `custom_roles(id)` on delete set null |

**Index added**: `idx_org_memberships_org_custom_role (organization_id, custom_role_id)`. This is what optionally attaches a custom role's permission overrides to a membership, on top of its required system `role`.

### `public.approval_policies`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `organization_id` | `uuid` | not null, FK → `organizations(id)` on delete cascade |
| `permission_key` | `varchar(160)` | not null |
| `enabled` | `boolean` | not null, default `true` |
| `min_approvals` | `integer` | not null, default `1`, check `> 0 and <= 10` |
| `approver_roles` | `organization_role[]` | not null, default `{admin}` |
| `approver_custom_role_ids` | `uuid[]` | not null, default `{}` |
| `created_by` | `uuid` | nullable, FK → `users(id)` on delete set null |
| `created_at` | `timestamptz` | not null, default `now()` |
| `updated_at` | `timestamptz` | not null, default `now()` |

**Primary key**: `id`. **Unique constraint**: `approval_policies_org_permission_unique (organization_id, permission_key)` — at most one policy per permission key per org. **Trigger**: `approval_policies_set_updated_at` (before update) → `set_approval_policies_updated_at()`. **Indexes**: `idx_approval_policies_org_permission (organization_id, permission_key)`, `idx_approval_policies_org_enabled (organization_id, enabled)`.

### `public.approval_requests`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `organization_id` | `uuid` | not null, FK → `organizations(id)` on delete cascade |
| `permission_key` | `varchar(160)` | not null |
| `action_label` | `varchar(180)` | not null |
| `entity_type` | `varchar(80)` | nullable |
| `entity_id` | `varchar(120)` | nullable |
| `payload` | `jsonb` | nullable |
| `status` | `approval_request_status` | not null, default `'pending'` |
| `requested_by` | `uuid` | not null, FK → `users(id)` on delete cascade |
| `policy_id` | `uuid` | nullable, FK → `approval_policies(id)` on delete set null |
| `required_approvals` | `integer` | not null, default `1`, check `> 0 and <= 10` |
| `approved_count` | `integer` | not null, default `0`, check `>= 0` |
| `approver_roles` | `organization_role[]` | not null, default `{admin}` |
| `approver_custom_role_ids` | `uuid[]` | not null, default `{}` |
| `expires_at` | `timestamptz` | nullable |
| `used_at` | `timestamptz` | nullable |
| `used_by` | `uuid` | nullable, FK → `users(id)` on delete set null |
| `created_at` | `timestamptz` | not null, default `now()` |
| `updated_at` | `timestamptz` | not null, default `now()` |

**Primary key**: `id`. **Trigger**: `approval_requests_set_updated_at` (before update) → `set_approval_requests_updated_at()`. **Indexes**: `idx_approval_requests_org_status_created_at (organization_id, status, created_at desc)`, `idx_approval_requests_org_requester_created_at (organization_id, requested_by, created_at desc)`, `idx_approval_requests_org_permission_status (organization_id, permission_key, status, created_at desc)`, `idx_approval_requests_org_entity_status (organization_id, entity_type, entity_id, status, created_at desc)`.

The `approval_request_status` enum includes `cancelled` and `expired` in addition to `pending`/`approved`/`rejected`, and `used_at`/`used_by` exist to mark a request as consumed once the originally-blocked action is retried and succeeds. `expires_at` exists on the row but the schema itself does not enforce expiry — any time-based expiry logic would have to be applied by application code or a scheduled job.

### `public.approval_request_decisions`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `organization_id` | `uuid` | not null, FK → `organizations(id)` on delete cascade |
| `request_id` | `uuid` | not null, FK → `approval_requests(id)` on delete cascade |
| `decided_by` | `uuid` | not null, FK → `users(id)` on delete cascade |
| `decision` | `approval_decision` | not null |
| `comment` | `text` | nullable |
| `created_at` | `timestamptz` | not null, default `now()` |

**Primary key**: `id`. **Unique constraint**: `approval_request_decisions_unique (request_id, decided_by)` — enforces one decision per approver per request at the database level. **Indexes**: `idx_approval_request_decisions_org_request_created_at (organization_id, request_id, created_at asc)`, `idx_approval_request_decisions_org_decider_created_at (organization_id, decided_by, created_at desc)`.

---

## Domain: Audit Log Extension (`db/audit-logs-schema.sql`)

Extends the base `audit_logs` table (created in `topbar-schema.sql`) with richer targeting/searchability columns, plus the full index set the activity-timeline UI relies on. Its own `create table if not exists` re-declares the same 7 base columns as the topbar version — this is a defensive fallback in case `topbar-schema.sql` wasn't applied first, not a second table.

### `public.audit_logs` — columns added on top of the base definition

| Column added | Type | Constraints |
|---|---|---|
| `target_user_id` | `uuid` | nullable, FK → `users(id)` on delete set null |
| `source` | `text` | not null, default `'api'` |
| `details` | `jsonb` | nullable |

**Indexes**: `idx_audit_logs_org_created_at (organization_id, created_at desc)`, `idx_audit_logs_org_action_created_at (organization_id, action, created_at desc)`, `idx_audit_logs_org_actor_created_at (organization_id, actor_user_id, created_at desc)`, `idx_audit_logs_org_target_created_at (organization_id, target_user_id, created_at desc)`, `idx_audit_logs_org_entity_created_at (organization_id, entity_type, entity_id, created_at desc)`, and a GIN index `idx_audit_logs_details_gin` on `details` (enabling efficient containment queries against the JSONB payload). No `updated_at` column anywhere on this table — audit logs are strictly append-only.

Full column set after both files are applied: `id, organization_id, actor_user_id, action, entity_type, entity_id, created_at, target_user_id, source, details`.

---

## Domain: Executive Analytics & Reports (`db/executive-analytics-schema.sql`)

Scheduled report definitions, their run history, and point-in-time metric snapshots for historical trend queries.

### `public.analytics_report_schedules`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `organization_id` | `uuid` | not null, FK → `organizations(id)` on delete cascade |
| `name` | `varchar(120)` | not null |
| `frequency` | `analytics_schedule_frequency` | not null, default `'weekly'` |
| `compare_with` | `text` | not null, default `'previous'`, check `in ('previous', 'year', 'none')` |
| `range_days` | `integer` | not null, default `30`, check `>= 1 and <= 365` |
| `timezone` | `varchar(64)` | not null, default `'UTC'` |
| `recipients` | `text[]` | not null, default `{}` |
| `is_enabled` | `boolean` | not null, default `true` |
| `next_run_at` | `timestamptz` | not null |
| `last_run_at` | `timestamptz` | nullable |
| `last_status` | `analytics_report_run_status` | nullable |
| `created_by` | `uuid` | nullable, FK → `users(id)` on delete set null |
| `created_at` | `timestamptz` | not null, default `now()` |
| `updated_at` | `timestamptz` | not null, default `now()` |

**Primary key**: `id`. **Unique constraint**: `analytics_report_schedules_org_name_unique (organization_id, name)`. **Trigger**: `analytics_report_schedules_set_updated_at` (before update) → `set_analytics_report_schedules_updated_at()`. **Indexes**: `idx_analytics_report_schedules_org (organization_id)`, `idx_analytics_report_schedules_org_enabled_next_run (organization_id, is_enabled, next_run_at)`, `idx_analytics_report_schedules_org_created_at (organization_id, created_at desc)`.

This file, like several others, contains a defensive `add column if not exists` block re-adding every column already declared inline, plus re-adding the `compare_with`/`range_days` check constraints — same idempotent-patch pattern noted under Saved Views.

### `public.analytics_report_runs`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `organization_id` | `uuid` | not null, FK → `organizations(id)` on delete cascade |
| `schedule_id` | `uuid` | nullable, FK → `analytics_report_schedules(id)` on delete set null |
| `status` | `analytics_report_run_status` | not null |
| `recipients` | `text[]` | not null, default `{}` |
| `report_from` | `timestamptz` | not null |
| `report_to` | `timestamptz` | not null |
| `error_message` | `text` | nullable |
| `delivered_at` | `timestamptz` | nullable |
| `created_at` | `timestamptz` | not null, default `now()` |

**Primary key**: `id`. **Indexes**: `idx_analytics_report_runs_org_created_at (organization_id, created_at desc)`, `idx_analytics_report_runs_org_schedule_created_at (organization_id, schedule_id, created_at desc)`.

### `public.analytics_metric_snapshots`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `organization_id` | `uuid` | not null, FK → `organizations(id)` on delete cascade |
| `metric_key` | `text` | not null |
| `metric_scope` | `analytics_metric_scope` | not null, default `'current'` |
| `metric_value` | `double precision` | not null |
| `period_from` | `timestamptz` | not null |
| `period_to` | `timestamptz` | not null |
| `source` | `text` | not null, default `'reports_api'` |
| `schedule_id` | `uuid` | nullable, FK → `analytics_report_schedules(id)` on delete set null |
| `report_run_id` | `uuid` | nullable, FK → `analytics_report_runs(id)` on delete set null |
| `created_at` | `timestamptz` | not null, default `now()` |

**Primary key**: `id`. **Indexes**: `idx_analytics_metric_snapshots_org_created_at (organization_id, created_at desc)`, `idx_analytics_metric_snapshots_org_metric_period (organization_id, metric_key, period_to desc)`, `idx_analytics_metric_snapshots_org_schedule_created_at (organization_id, schedule_id, created_at desc)`.

---

## Domain: Email MFA (`db/mfa-email-schema.sql`)

Backing store for the emailed 6-digit verification code used as a second authentication factor. This is the first of two auth-adjacent files (the other is Passkeys, below) with Row-Level Security enabled — both are keyed by `user_id` rather than `organization_id`, since MFA/authenticator state is not organization-scoped.

### `public.email_mfa_challenges`

| Column | Type | Constraints |
|---|---|---|
| `user_id` | `text` | primary key — **not** a foreign key to `users(id)`; matched against Supabase Auth's `auth.uid()` |
| `code_hash` | `text` | not null |
| `attempt_count` | `integer` | not null, default `0`, check `>= 0` |
| `expires_at` | `timestamptz` | not null |
| `last_sent_at` | `timestamptz` | not null, default `now()` |
| `created_at` | `timestamptz` | not null, default `now()` |
| `updated_at` | `timestamptz` | not null, default `now()` |

The primary key being `user_id` itself (rather than a surrogate `id`) means there is at most one active challenge per user at a time — sending a new code overwrites the previous one.

**Primary key**: `user_id`. **Index**: `idx_email_mfa_challenges_expires_at (expires_at)`. **Trigger**: `email_mfa_challenges_set_updated_at` (before update) → `set_email_mfa_challenges_updated_at()`. **Maintenance function**: `cleanup_expired_email_mfa_challenges()` — `returns void`, deletes rows `where expires_at < now()`. Nothing in `db/` schedules this function's execution (no `pg_cron` job, no external trigger found) — it must be invoked manually or by infrastructure outside this repo, or expired rows accumulate indefinitely.

**Row-Level Security**: enabled.

| Policy | Command | Condition (SQL) | Plain English |
|---|---|---|---|
| "Users can manage their own email MFA challenges" | `for all` | `using (auth.uid()::text = user_id)` | A signed-in Supabase user may read/write only the challenge row whose `user_id` matches their own auth UID. |
| "Service role access email MFA challenges" | `for all` | `using (auth.role() = 'service_role') with check (auth.role() = 'service_role')` | A connection authenticated as the Supabase service role (i.e. the app's backend, via `createSupabaseAdminClient()`) can read/write any row, bypassing the self-access rule above. |

---

## Domain: Passkeys / WebAuthn (`db/passkeys-schema.sql`)

Backing store for WebAuthn/passkey credentials and their in-flight registration/authentication ceremony state, used by the `next-passkey-webauthn` library's Supabase adapter.

### `public.passkeys`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `user_id` | `text` | not null — **not** a foreign key to `users(id)`; matched against Supabase Auth's `auth.uid()` |
| `credential_id` | `text` | not null, unique |
| `public_key` | `text` | not null |
| `counter` | `integer` | not null, default `0` |
| `transports` | `text[]` | not null, default `{}` |
| `user_name` | `text` | nullable |
| `user_display_name` | `text` | nullable |
| `authenticator_attachment` | `text` | nullable |
| `device_info` | `jsonb` | not null, default `{}` |
| `backup_eligible` | `boolean` | not null, default `false` |
| `backup_state` | `boolean` | not null, default `false` |
| `last_used_at` | `timestamptz` | nullable |
| `created_at` | `timestamptz` | not null, default `now()` |
| `updated_at` | `timestamptz` | not null, default `now()` |

**Primary key**: `id`. **Indexes**: `idx_passkeys_user_id (user_id)`, `idx_passkeys_credential_id (credential_id)`. **Trigger**: `passkeys_set_updated_at` (before update) → `set_passkeys_updated_at()`.

### `public.passkey_challenges`

| Column | Type | Constraints |
|---|---|---|
| `id` | `text` | primary key (caller-supplied, not `gen_random_uuid()`-derived) |
| `user_id` | `text` | not null — same non-FK, `auth.uid()`-matched convention as `passkeys.user_id` |
| `flow` | `text` | not null (no enum/check on allowed values — e.g. registration vs. authentication ceremony) |
| `challenge` | `text` | not null |
| `expires_at` | `timestamptz` | not null |
| `created_at` | `timestamptz` | not null, default `now()` |

**Primary key**: `id`. **Indexes**: `idx_passkey_challenges_user_id (user_id)`, `idx_passkey_challenges_expires_at (expires_at)`. **Maintenance function**: `cleanup_expired_passkey_challenges()` — `returns void`, deletes rows `where expires_at < now()`. As with the MFA cleanup function above, nothing in `db/` schedules this — no cron wiring was found.

**Row-Level Security**: enabled on both tables.

| Table | Policy | Command | Condition (SQL) | Plain English |
|---|---|---|---|---|
| `passkeys` | "Users can manage their own passkeys" | `for all` | `using (auth.uid()::text = user_id)` | A signed-in user may read/write only passkey rows whose `user_id` matches their own auth UID. |
| `passkeys` | "Service role access passkeys" | `for all` | `using (auth.role() = 'service_role') with check (auth.role() = 'service_role')` | The backend's service-role connection can read/write any row. |
| `passkey_challenges` | "Users can manage their own passkey challenges" | `for all` | `using (auth.uid()::text = user_id)` | Same self-access rule, applied to in-flight challenge rows. |
| `passkey_challenges` | "Service role access passkey challenges" | `for all` | `using (auth.role() = 'service_role') with check (auth.role() = 'service_role')` | Same service-role bypass. |

---

## Domain: Customer Portal (`db/customer-portal-schema.sql`)

Backing store for the separate, unauthenticated-until-verified magic-link login system used by external customers (distinct from staff NextAuth sessions).

### `public.customer_portal_login_links`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `organization_id` | `uuid` | not null, FK → `organizations(id)` on delete cascade |
| `customer_id` | `uuid` | not null, FK → `customers(id)` on delete cascade |
| `email` | `varchar(255)` | not null |
| `token_hash` | `varchar(64)` | not null, unique |
| `expires_at` | `timestamptz` | not null |
| `used_at` | `timestamptz` | nullable |
| `revoked_at` | `timestamptz` | nullable |
| `requested_ip` | `varchar(64)` | nullable |
| `user_agent` | `text` | nullable |
| `created_at` | `timestamptz` | not null, default `now()` |

**Primary key**: `id`. **Indexes**: `idx_customer_portal_login_links_email_created_at (email, created_at desc)`, `idx_customer_portal_login_links_org_customer (organization_id, customer_id)`, `idx_customer_portal_login_links_expires_at (expires_at)`. `token_hash` is unique here (contrast with `organization_invites.token_hash`, which is not — see the Team & Invites section).

### `public.customer_portal_sessions`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `organization_id` | `uuid` | not null, FK → `organizations(id)` on delete cascade |
| `customer_id` | `uuid` | not null, FK → `customers(id)` on delete cascade |
| `email` | `varchar(255)` | not null |
| `token_hash` | `varchar(64)` | not null, unique |
| `expires_at` | `timestamptz` | not null |
| `revoked_at` | `timestamptz` | nullable |
| `last_seen_at` | `timestamptz` | nullable |
| `created_at` | `timestamptz` | not null, default `now()` |

**Primary key**: `id`. **Indexes**: `idx_customer_portal_sessions_email_created_at (email, created_at desc)`, `idx_customer_portal_sessions_org_customer (organization_id, customer_id)`, `idx_customer_portal_sessions_expires_at (expires_at)`.

### `public.customer_portal_identities`

| Column | Type | Constraints |
|---|---|---|
| `customer_id` | `uuid` | primary key, FK → `customers(id)` on delete cascade |
| `organization_id` | `uuid` | not null, FK → `organizations(id)` on delete cascade |
| `user_id` | `uuid` | not null, unique, FK → `users(id)` on delete cascade |
| `created_at` | `timestamptz` | not null, default `now()` |

**Primary key**: `customer_id` (i.e. at most one identity mapping per customer). **Unique constraint**: `user_id` — the reverse mapping is also 1:1. **Index**: `idx_customer_portal_identities_org_customer (organization_id, customer_id)`. This table lets a customer be represented as a synthetic `public.users` row (so ticket authorship/attachment-uploader columns, which all reference `users.id`, can attribute content to a portal customer the same way they attribute it to staff).

None of the three customer-portal tables have RLS enabled, an `updated_at` column, or a trigger — session/link mutation (marking `used_at`/`revoked_at`/`last_seen_at`) is done directly by application code using the service-role client.

---

## Operational script: Notifications Realtime (`db/notifications-realtime.sql`)

Not a schema-defining migration — creates no tables. It is a standalone, idempotent script meant to be pasted directly into the Supabase SQL Editor (its own header says so explicitly) to (re-)enable Postgres logical-replication broadcast of changes to `public.notifications`:

1. `alter table if exists public.notifications replica identity full;`
2. A conditional block that checks `information_schema.tables` for `public.notifications`, and if present and not already listed in `pg_publication_tables` for the `supabase_realtime` publication, runs `alter publication supabase_realtime add table public.notifications;`.

This exact logic already exists inline at the bottom of `topbar-schema.sql` (which additionally skips the `information_schema.tables` existence pre-check, since it just created the table moments earlier in the same script). This file is presumably meant for re-enabling realtime on a database where it was disabled after the fact, or for pasting directly into the Supabase dashboard UI as its header comment suggests, without having to re-run the entire topbar file.

---

## Triggers reference

Every `before update ... for each row` trigger in the schema, all following the identical `new.updated_at = now(); return new;` pattern:

| Trigger | Table | Function | Defined in |
|---|---|---|---|
| `customers_set_updated_at` | `customers` | `set_customers_updated_at()` | `customers-schema.sql` |
| `tickets_set_updated_at` | `tickets` | `set_tickets_updated_at()` | `tickets-schema.sql` |
| `ticket_texts_set_updated_at` | `ticket_texts` | `set_tickets_updated_at()` (shared with `tickets`) | `tickets-schema.sql` |
| `orders_set_updated_at` | `orders` | `set_orders_updated_at()` | `orders-schema.sql` |
| `sla_policies_set_updated_at` | `sla_policies` | `set_sla_policies_updated_at()` | `sla-schema.sql` |
| `saved_views_set_updated_at` | `saved_views` | `set_saved_views_updated_at()` | `saved-views-schema.sql` |
| `automation_rules_set_updated_at` | `automation_rules` | `set_automation_rules_updated_at()` | `automation-schema.sql` |
| `status_services_set_updated_at` | `status_services` | `set_status_services_updated_at()` | `incidents-schema.sql` |
| `incidents_set_updated_at` | `incidents` | `set_incidents_updated_at()` | `incidents-schema.sql` |
| `custom_roles_set_updated_at` | `custom_roles` | `set_custom_roles_updated_at()` | `rbac-approvals-schema.sql` |
| `approval_policies_set_updated_at` | `approval_policies` | `set_approval_policies_updated_at()` | `rbac-approvals-schema.sql` |
| `approval_requests_set_updated_at` | `approval_requests` | `set_approval_requests_updated_at()` | `rbac-approvals-schema.sql` |
| `analytics_report_schedules_set_updated_at` | `analytics_report_schedules` | `set_analytics_report_schedules_updated_at()` | `executive-analytics-schema.sql` |
| `email_mfa_challenges_set_updated_at` | `email_mfa_challenges` | `set_email_mfa_challenges_updated_at()` | `mfa-email-schema.sql` |
| `passkeys_set_updated_at` | `passkeys` | `set_passkeys_updated_at()` | `passkeys-schema.sql` |

Standalone (non-trigger) maintenance functions, both `returns void`, neither scheduled by anything in `db/`: `cleanup_expired_email_mfa_challenges()` (`mfa-email-schema.sql`), `cleanup_expired_passkey_challenges()` (`passkeys-schema.sql`).

Tables that have an `updated_at` column but **no** update trigger keeping it current: `organization_memberships` (the column was added by `team-schema.sql`, but no trigger was ever added for it). Tables with no `updated_at` column at all (effectively append-only or immutable-after-insert by convention): `users`, `organizations`, `notifications`, `notification_preferences`, `audit_logs`, `customer_contacts`, `customer_addresses`, `customer_metadata`, `order_items`, `order_status_events`, `order_attachments`, `customer_communications`, `ticket_tags`, `ticket_tag_assignments`, `incident_impacts`, `incident_updates`, `custom_role_permissions`, `approval_request_decisions`, `analytics_report_runs`, `analytics_metric_snapshots`, `organization_invites`, `customer_portal_login_links`, `customer_portal_sessions`, `customer_portal_identities`, `passkey_challenges`, `ticket_sla_events`.

## Row-Level Security summary

Restating the point made in "Multi-tenancy model" above as a single table, since it's the single most important cross-cutting fact about this schema:

| Table | RLS enabled? | Keyed by |
|---|---|---|
| `passkeys` | Yes | `user_id` (text, matches `auth.uid()`) |
| `passkey_challenges` | Yes | `user_id` (text, matches `auth.uid()`) |
| `email_mfa_challenges` | Yes | `user_id` (text, matches `auth.uid()`) |
| All other ~41 tables in this schema (`organizations`, `organization_memberships`, `tickets`, `orders`, `customers`, `incidents`, `automation_rules`, `custom_roles`, `approval_requests`, `audit_logs`, `customer_communications`, `saved_views`, `organization_invites`, `customer_portal_*`, `analytics_*`, `sla_policies`, and the rest) | **No** | Isolation is enforced only by application code filtering on `organization_id`; there is no database-level backstop for these tables |

---

## Missing information

The following points are called out explicitly rather than guessed at, per the source investigation notes:

- **Rationale for the RLS split is not documented anywhere in the repo.** Why exactly 3 auth-adjacent tables (all user-scoped) have RLS while every multi-tenant business table relies solely on application-layer `organization_id` filtering has no recorded design decision (ADR or otherwise). Whether this is a deliberate, accepted risk or an in-progress gap was not confirmed.
- **No migration-tracking mechanism exists.** There is no table or tool recording which `db/*.sql` files have been applied to which environment. The apply order documented above is reconstructed from header comments and foreign-key dependency analysis, not from any committed migration runner.
- **Two enum declarations must be kept in sync by hand**: `order_payment_status` is independently declared in both `orders-schema.sql` and `orders-payments-schema.sql` with an identical value list today — there is no single source of truth for it.
- **`organization_invites.token_hash` has no unique constraint**, unlike the structurally similar `customer_portal_login_links.token_hash` and `customer_portal_sessions.token_hash` (both `unique`). Whether this is intentional (token space is large enough that collisions are not a practical concern) or an oversight was not confirmed.
- **Two cleanup functions are unscheduled**: `cleanup_expired_email_mfa_challenges()` and `cleanup_expired_passkey_challenges()` exist but nothing in `db/` (no `pg_cron` job, no other file) invokes them. Absent an external scheduler, expired challenge rows accumulate indefinitely.
- **`customer-portal-schema.sql` and `executive-analytics-schema.sql` both name `tickets`/`orders` (and, for analytics, `incidents`) as prerequisites in their header comments, but neither file contains an actual foreign key to those tables.** The stated dependency is about the completeness of the data being reported on or served, not a schema-level requirement — confirmed by reading both files in full and finding no such FK.
- **`public.notification_preferences` exists in the schema but no application code reading or writing it was found** during the source investigation — its current usage status is unconfirmed.
- **The redundant "inline column + defensive re-add block" pattern** seen in `saved-views-schema.sql`, `orders-schema.sql`, `automation-schema.sql`, and `executive-analytics-schema.sql` is documented here as an observed characteristic of the files as committed, not as a confirmed intentional design — it looks like each file accreted patches over time rather than being rewritten cleanly.
- **`incident_service_health`'s implied severity ordering is inconsistent at the application layer** (two different rankings exist in code for the same enum, one treating `maintenance` as most severe and the other treating it as barely worse than `operational`). This is an application-code fact, included here because it affects how the enum's ordering should be interpreted by anyone reading this schema in isolation — the enum's own declaration order in `db/incidents-schema.sql` should not be assumed to encode severity.
- **`approval_requests.status` supports `cancelled` and `expired` values, and `approval_requests.expires_at` exists as a column**, but no cancellation or expiry job was found anywhere in the reviewed application code — these are modeled in the schema but not currently produced by any known code path.
