# Contributing to OpsDesk

This document covers how to get the repository running locally, how to check your work before
submitting it, and the conventions the existing code follows. It reflects what is actually in the
repository today — where a normal contributing guide would point to a template, a bot, or an
enforced rule and none exists here, that is called out explicitly rather than assumed.

This is the first `CONTRIBUTING.md` in the repository. See [Missing Information](#missing-information)
at the end of this document for what still needs to be decided/added by the team.

---

## Prerequisites

- **Node.js 20+**. `package.json` does not declare an `engines` field, so nothing enforces this at
  install time — no document in the repo currently states a Node.js version requirement; this is
  inferred from the `@types/node: ^20` dev dependency and Next.js `16.1.6`'s own baseline. There is
  no `.nvmrc` in the repo to pin an exact version.
- **npm** (the repo ships a `package-lock.json`; no `yarn.lock`/`pnpm-lock.yaml` is present, so use npm
  to keep the lockfile consistent).
- **A Supabase project** (Postgres + Auth + Storage). The app is built directly against
  `@supabase/supabase-js` and Supabase Auth — there is no local/offline database story (no Docker
  compose, no local Postgres config committed).
- Accounts/keys for the third-party services you intend to exercise while developing, since several
  features throw at request time if their env var is missing rather than degrading silently:
  **Resend** (all transactional email), **Stripe** (order payment links), and, for passkeys, a
  browser/OS that supports WebAuthn in a secure context (`https://` or `localhost`).

---

## Initial setup

### 1. Clone and install

```bash
git clone <repo-url>
cd OpsDesk
npm install
```

### 2. Environment variables

Create `.env.local` at the repo root. There is **no `.env.example` at the repo root** to copy from —
the only example file in the repository is `exports/auth-system/.env.example`, which documents the
subset of variables needed for the portable auth-system export under `exports/auth-system/`, not the
full app. Use the environment variable table in `README.md` ("Environment Variables") as the starting
point for the frontend-relevant set, and `docs/DEPLOYMENT.md` for the fully consolidated list (every
variable found anywhere in the codebase, grouped by subsystem, with required/optional status).

At minimum, to sign in and load any org-scoped page locally you need working Supabase URL/key
variables, `NEXTAUTH_URL`, and `NEXTAUTH_SECRET`. Email-dependent flows (registration verification,
magic link, MFA codes, invites) need `RESEND_API_KEY`. Payment-link flows need `STRIPE_SECRET_KEY` /
`STRIPE_WEBHOOK_SECRET`. `.env*` is git-ignored (`.gitignore`), so nothing you put in `.env.local` will
be committed.

### 3. Apply the database schema

There is **no migration-tracking tool** in this repository — no `schema_migrations` table, no
Prisma/Drizzle/node-pg-migrate runner. Every file under `db/*.sql` is a standalone, idempotent script
(guarded with `if not exists` / `do $$ ... exception when duplicate_object` blocks) meant to be pasted
into the Supabase SQL Editor by hand, in dependency order. Nothing in the repo records which files
have already been applied to which environment — that bookkeeping is on you.

Apply order, reconstructed from each file's own header comment and its actual foreign-key
dependencies (not just the comment — two files list dependencies in their header that turn out to
have no matching foreign key; that's noted below so you don't waste time chasing a schema-level
dependency that isn't there):

| Order | File | Apply after | Notes |
|---|---|---|---|
| 1 | `db/topbar-schema.sql` | — (foundation) | Creates `organizations`, `users`, `organization_memberships`, `notifications`, `notification_preferences`, base `audit_logs`, and the `organization_role` enum. Everything else depends on this. |
| 2 | `db/team-schema.sql` | `topbar-schema.sql` | Adds `status`/`joined_at`/`updated_at` to `organization_memberships` and creates `organization_invites`. |
| 3 | `db/customers-schema.sql` | `topbar-schema.sql` | |
| 4 | `db/tickets-schema.sql` | `topbar-schema.sql` (no explicit header comment, but references `public.users`) | Soft-links to `customers`/`orders` via conditional `do $$` FK blocks — safe to apply before or after those two. |
| 5 | `db/orders-schema.sql` | `topbar-schema.sql`, `customers-schema.sql` | |
| 6 | `db/orders-payments-schema.sql` | `orders-schema.sql` | Patch-only file for pre-existing `orders` tables; has a hard runtime guard that raises an exception if `public.orders` doesn't exist yet. Not needed on a fresh database — `orders-schema.sql` already includes these columns inline. |
| 7 | `db/sla-schema.sql` | `topbar-schema.sql`, `tickets-schema.sql` | |
| 8 | `db/ticket-tags-schema.sql` | `topbar-schema.sql`, `tickets-schema.sql` | |
| 9 | `db/saved-views-schema.sql` | `topbar-schema.sql` | |
| 10 | `db/automation-schema.sql` | `topbar-schema.sql`, `tickets-schema.sql` | |
| 11 | `db/communications-schema.sql` | `topbar-schema.sql`, `customers-schema.sql`, `tickets-schema.sql` | Also soft-links to `orders`/`incidents` if present. |
| 12 | `db/customer-portal-schema.sql` | `topbar-schema.sql`, `customers-schema.sql` | The file's own header additionally names `tickets-schema.sql`/`orders-schema.sql` as prerequisites, but no table in this file has a foreign key to `tickets` or `orders` — that listed dependency is about the portal *feature* needing those domains, not a schema requirement. |
| 13 | `db/incidents-schema.sql` | `topbar-schema.sql` | |
| 14 | `db/rbac-approvals-schema.sql` | `topbar-schema.sql`, `team-schema.sql` | Adds `custom_role_id` to `organization_memberships`. |
| 15 | `db/audit-logs-schema.sql` | `topbar-schema.sql` | Extends the base `audit_logs` table (adds `target_user_id`, `source`, `details`). |
| 16 | `db/executive-analytics-schema.sql` | `topbar-schema.sql` | The header also names `tickets-schema.sql`/`orders-schema.sql`/`incidents-schema.sql`, but — same caveat as `customer-portal-schema.sql` — no FK in this file actually points at those tables. |
| 17 | `db/mfa-email-schema.sql` | none named; org-agnostic (`email_mfa_challenges` has no `organization_id` column) | |
| 18 | `db/passkeys-schema.sql` | none named; org-agnostic (`passkeys`/`passkey_challenges` have no `organization_id` column) | |
| 19 | `db/notifications-realtime.sql` | — | Standalone, re-runnable ops script; duplicates realtime-publication logic already run inline by `topbar-schema.sql`. Only needed if realtime on `notifications` wasn't enabled when `topbar-schema.sql` first ran. |

After applying any file that adds a table or column, run `NOTIFY pgrst, 'reload schema';` in the same
SQL Editor session — this is the exact instruction dozens of API routes give in their own error
messages when they detect a table missing from PostgREST's schema cache, and skipping it is the most
common reason a freshly-applied migration still 500s.

If you only need the authentication subset (for example, working on the portable
`exports/auth-system/` export), that subset's own README documents a shorter order:
`topbar-schema.sql` → `team-schema.sql` → `passkeys-schema.sql` → `mfa-email-schema.sql`.

### 4. (Optional) Seed demo data

```bash
npm run tinker:list          # see available scenarios
npm run tinker -- --email you@example.com --create-user
```

`scripts/tinker.mjs` is a Node CLI (run via `node --env-file=.env.local scripts/tinker.mjs`) that seeds
realistic rows across tickets/orders/incidents/SLA/automation/communications/RBAC/portal/analytics/
security tables for a given user + organization. It is a manual demo-data tool, **not** part of the
automated test suite — do not confuse `npm run tinker` with running tests.

### 5. Run the dev server

```bash
npm run dev
```

Open `http://localhost:3000`.

---

## Linting and type-checking

```bash
npm run lint
```

This runs `eslint` against `eslint.config.mjs`, which extends `eslint-config-next`'s
`core-web-vitals` and `typescript` rule sets with no project-specific custom rules. Its own
`globalIgnores` only excludes `.next/**`, `out/**`, `build/**`, and `next-env.d.ts` — `node_modules`
aside, this means **`exports/auth-system/**` is in scope for lint**, and it is likewise in scope for
the TypeScript project (`tsconfig.json`'s `exclude` is only `node_modules`). If you touch anything
under `exports/auth-system/`, or if lint/type errors show up there while you're working elsewhere,
that's expected given the current config, not a fluke.

There is no dedicated `typecheck` npm script. `tsconfig.json` has `"noEmit": true`, so to check types
without a full build, run:

```bash
npx tsc --noEmit
```

Neither `lint` nor a type-check is run automatically anywhere — there is no CI configuration in this
repository (no `.github/workflows`, no other CI provider config) that gates changes on either. Run
both yourself before opening a change.

---

## Testing before you submit a change

```bash
npm test               # full Vitest suite: tests/unit/**/*.test.ts + tests/components/**/*.test.tsx
npm run test:unit       # tests/unit only
npm run test:components # tests/components only
npm run test:watch      # Vitest in watch mode
npm run test:e2e        # Playwright, tests/e2e/**/*.spec.ts
npm run test:e2e:headed # same, with a visible browser
```

Notes on what these actually cover, so you know what you're extending vs. starting from scratch on:

- **Coverage today is narrow and auth-flow-focused.** Unit tests cover the three Redux slices
  (`auth`, `topbar`, `tickets`) and validation/flow helpers for login/register/forgot-password/
  reset-password/verify/tickets/orders/customers. Component tests cover only the login, register,
  forgot-password, reset-password, and verify pages. E2E tests cover only login and register/verify
  journeys (with mocked NextAuth callbacks). **There are no automated tests for tickets, orders,
  customers, incidents, automation, SLA, RBAC/approvals, reports, notifications, or payments** — the
  majority of the product's domain logic. If you're changing one of those areas, there is no existing
  test to run as a regression check; consider adding one, but nothing currently requires it.
- `npm run test:e2e` boots its own dev server on **port 4173** (not 3000) unless `PLAYWRIGHT_BASE_URL`
  is set — see `playwright.config.ts`. Confirm `npm run dev` works on its own first if e2e startup
  fails.
- Playwright is configured for **Chromium only** (`devices["Desktop Chrome"]`); there is no
  Firefox/WebKit/mobile-viewport project configured.
- No code-coverage reporting is configured (no `--coverage` flag wired into any script, no
  nyc/istanbul/codecov integration).
- As with lint/type-check, none of this runs in CI — there is no CI in this repository at all. Running
  the relevant test commands locally before submitting is the only gate that currently exists.

---

## Code organization conventions

The codebase follows a consistent domain-scoped layering, verified directly against the `lib/` and
`app/api/` directory contents (`lib/tickets`, `lib/orders`, `lib/customers`, `lib/incidents`,
`lib/automation`, `lib/sla`, `lib/rbac`, `lib/reports`, `lib/saved-views`, `lib/search`, `lib/team`,
`lib/ticket-tags`, `lib/topbar`, `lib/audit`, `lib/dashboard`, `lib/portal`, matched by
`app/api/tickets`, `app/api/orders`, `app/api/customers`, `app/api/incidents`, `app/api/automation`,
`app/api/sla`, `app/api/reports`, `app/api/saved-views`, `app/api/search`, `app/api/orgs`, and so on).
When adding a new domain or extending an existing one, follow the same shape:

- **`lib/<domain>/types.ts`** — the TypeScript row/response shapes shared between API route handlers
  and frontend consumers (e.g. `lib/tickets/types.ts`, `lib/orders/types.ts`). This is the contract
  both sides import from; don't redeclare the same shape ad hoc inside a route file or a page.
- **`lib/<domain>/validation.ts`** — enum arrays (e.g. `TICKET_STATUSES`), type guards (`isX`), and
  normalizers with an explicit fallback default (`normalizeTicketStatus`, defaulting to `"open"`;
  `normalizeCustomerStatus`, defaulting to `"active"`). Keep validation logic here, not duplicated
  inline in each route.
- **`lib/server/<domain>.ts`** (or `<domain>-engine.ts` for the two rule-engine subsystems,
  `lib/server/automation-engine.ts` and `lib/server/sla-engine.ts`) — server-only business logic:
  Supabase queries, side effects (notifications, audit logs, automation triggers), and anything that
  must never run in a client component. These are imported by `app/api/**/route.ts` handlers, not by
  page components.
- **`app/api/<domain>/**/route.ts`** — Next.js Route Handlers, one file per resource/action, thin
  wrappers that parse/validate the request, call into `lib/server/<domain>.ts`, and shape the
  response using the domain's `types.ts`.
- **`app/<domain>/page.tsx`** (+ nested `[id]/page.tsx` for detail views) — client-rendered feature
  pages consuming the API routes above, typically via native `fetch` (see `lib/axios.ts`'s
  `axiosAuth` — it exists but most page-level data flows use `fetch` directly, not this client).
- **Global/cross-page state** (as opposed to domain-local page state) lives in `lib/store/slices/*`
  as Redux Toolkit slices (`auth-slice.ts`, `topbar-slice.ts`, `tickets-slice.ts` — currently the only
  three registered in `lib/store/store.ts`). Don't add a new slice for something that's only used by
  one page; local component state or a domain hook is the better fit for that.

Two naming details worth knowing before you go looking for something by name:

- **`lib/server/ticket-context.ts`'s `getTicketRequestContext()`** is named after tickets but is
  actually the shared session/active-org resolver used by tickets, orders, customers, incidents,
  saved-views, search, and the dashboard route alike. Don't assume it's ticket-specific from the file
  name.
- **`lib/server/organization-context.ts`'s `getOrganizationActorContext(orgId)`** is the stricter,
  URL-`orgId`-scoped counterpart used by every route under `app/api/orgs/[orgId]/**` (team, invites,
  members, RBAC, approvals, audit logs, report schedules) — it additionally validates the caller's
  membership in that specific org, not just "some active org."

`exports/auth-system/` is a duplicated snapshot of the auth-related `app/`, `db/`, `lib/`, `public/`,
and `types/` subtrees, framed by its own README as a portable copy meant to be dropped into another
Next.js app. No generator script for it was found in the repository — how (or whether) it's kept in
sync with the live tree when you change auth code is not established anywhere. If you modify
`auth.ts` or any of the `lib/server/passkey-*`, `lib/server/mfa-*`, or auth-related API routes, check
whether `exports/auth-system/` needs the same change mirrored into it, and confirm the actual sync
process with the team rather than assuming one exists.

---

## Commit message conventions

There is **no commitlint config, no `.husky/` directory, and no git hook of any kind** in this
repository — nothing enforces a commit message format. What follows is the convention observed in the
actual git history (single `main` branch, no tags), not a rule:

- The large majority of commits use a lowercase `feat:` or `fix:` prefix followed by a short,
  imperative-ish summary, e.g.:
  - `feat: implement comprehensive authentication system with passkey support, MFA, and email-based flows`
  - `feat: add automation rules and engine for ticket management`
  - `fix: remove unused dependencies react-router and react-slick from package.json`
  - `fix: enhance DataTable cell styling for better text alignment and word wrapping`
- This isn't applied with full consistency: a handful of commits capitalize the word right after the
  colon (`feat: Implement SLA policies management...`, `feat: Add user login and registration pages...`),
  a few end in a period and others don't, and three commits drop the type prefix entirely
  (`Refactor code structure for improved readability and maintainability`, used verbatim three times).
  There are no scoped prefixes (nothing like `feat(tickets):`).
- Only commit *subjects* were reviewed to write this section (`git log` one-line output); commit
  bodies/footers were not inspected, so no claim is made here about whether trailers (e.g. issue
  references) are used in practice.

Follow the `feat:`/`fix:` + lowercase-after-colon pattern for new commits for consistency with the
majority of history, but be aware nothing will reject a commit that doesn't.

---

## Opening a change

There is currently no formalized review process encoded in the repository: no `CODEOWNERS` file, no
required-reviewers configuration, and no branch protection config checked in (none of that is
typically stored in-repo anyway, but it's worth stating that nothing here assumes one exists). Before
opening a change:

1. Run `npm run lint` and `npx tsc --noEmit`.
2. Run the test commands relevant to what you changed (see [Testing](#testing-before-you-submit-a-change) above).
3. If your change touches an area with zero existing test coverage, consider whether adding a test is
   feasible — it isn't required by any tooling today, but it's the only way the next contributor will
   know your change is still working.
4. If your change touches the database schema, add a new `db/*.sql` file following the existing
   pattern: idempotent (`if not exists` / exception-guarded), a header comment stating what it must be
   applied after, and an entry added to the apply-order table above.

---

## Missing Information

The following are things a complete contributor guide would normally point to, and none of them exist
in this repository as of this writing:

- **No `CONTRIBUTING.md` existed before this file.**
- **No issue templates and no pull request template** — there is no `.github/` directory at all in
  the repository, so nothing under `.github/ISSUE_TEMPLATE/` or `.github/PULL_REQUEST_TEMPLATE.md`
  exists to reference.
- **No `CODEOWNERS` file.**
- **No commitlint configuration and no git hooks** (`.husky/` or otherwise) — confirmed absent by
  direct directory search; the commit-message conventions above are observed practice only.
- **No CI configuration of any kind** (no GitHub Actions, no other provider's config file anywhere in
  the repo) — lint, type-check, and tests are not gated automatically anywhere; they only run when a
  contributor runs them locally.
- **No code formatter configuration** (no Prettier config found) — formatting consistency, beyond
  what ESLint's rule sets touch, is not enforced by tooling.
- **No `.env.example` at the repository root** — only `exports/auth-system/.env.example` exists, and
  it covers only the auth-system export's subset of variables, not the full application.
- **No stated Node.js engine requirement anywhere in the repo** (`package.json` has no `engines`
  field, and no other file states a required Node.js version; this guide's "Node.js 20+" is only
  inferred from the `@types/node: ^20` dev dependency, so a contributor on an older/newer runtime
  won't be warned by tooling).
- **No confirmation of how (or whether) `exports/auth-system/` is kept in sync** with the live
  `app/`/`db/`/`lib/`/`types/` auth-related files it duplicates — ask the team before assuming a
  process exists.
