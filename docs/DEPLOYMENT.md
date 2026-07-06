# Deployment

## There is no deployment pipeline in this repository

This needs to be stated plainly before anything else: **OpsDesk has no committed CI/CD pipeline, no containerization, and no platform-specific deployment configuration.** Specifically, none of the following exist anywhere in the repository (verified by direct directory listing and repo-wide search, excluding `node_modules` and `.next`):

- No `.github/workflows/` directory, and no `.github/` directory at all — no GitHub Actions, no CI of any kind.
- No `Dockerfile`, `docker-compose.yml`, or `docker-compose.yaml` (any casing).
- No `vercel.json`.
- No CI config for any other provider either (no GitLab CI, CircleCI, Azure Pipelines file — a repo-wide search for `*.yml`/`*.yaml` outside `node_modules`/`.next` returns zero results).
- No `LICENSE` file.
- No `middleware.ts` at the repository root or anywhere else (route protection is implemented ad hoc inside pages/layouts instead — see the Architecture doc).

Whatever process is currently used to build and run this application in any environment beyond a developer's machine is **not encoded in the repository** and must be supplied by whoever operates it. Everything below is either (a) directly verified from `package.json` and config files in the repo, or (b) explicitly labeled as an inference with the evidence for that inference stated alongside it.

---

## What can be reasonably inferred (and why it's only an inference)

No committed file names a hosting platform. However, several independent signals in the codebase are consistent with a Vercel-hosted deployment:

- `.env.local` contains a `POSTGRES_DATABASE`, `POSTGRES_HOST`, `POSTGRES_PASSWORD`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_USER` set of variable names — this exact naming pattern matches what Vercel's Supabase integration auto-populates into a project's environment variables. None of these `POSTGRES_*` variables are actually read anywhere in the application code (see the env var table below), which is itself consistent with them being platform-injected rather than app-configured.
- The app depends on `@vercel/blob` (`package.json`) for ticket/order/portal attachment storage, and reads/writes via `put()`/`get()` without ever passing an explicit token in code — the SDK's documented convention is to read `BLOB_READ_WRITE_TOKEN` from the environment implicitly. That variable name is present in `.env.local`.
- A `public/vercel.svg` static asset exists (a leftover from the `create-next-app` Vercel template, per the initial commit `2730899|Initial commit from Create Next App`).
- `.env.local` also contains `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_URL` — a second, non-`NEXT_PUBLIC_`-prefixed set of Supabase variables that duplicates the ones the app actually reads (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`). This duplication is again consistent with an automatic platform integration populating both a client-safe and a server-only variant of the same credentials, most of which the app code never references directly.
- The application is a standard Next.js App Router project (Next.js 16.1.6) with no non-standard build output target (no `output: "export"` or `output: "standalone"` in `next.config.ts`), which is the default shape Vercel expects.

**None of this is confirmed.** The environment variable naming suggests a Vercel-managed Postgres/Supabase/Blob integration, and Next.js applications of this shape are commonly deployed to Vercel — but no deployment config in this repository names Vercel, and it is equally possible the app is deployed elsewhere (a self-hosted Node server, another PaaS) with these variables copied in from a Vercel project for unrelated reasons (e.g., the database was provisioned via Vercel's marketplace but the app itself runs somewhere else). Confirm the actual hosting platform with whoever operates this application before writing an operational runbook that assumes Vercel.

---

## What is verified: build, postbuild, and start

These three commands are read directly from `package.json`:

| Step | Command | What it does |
|---|---|---|
| Build | `next build` | Standard Next.js production build. No custom build flags or `next.config.ts` overrides beyond the one noted below. |
| Postbuild | `next-sitemap` (runs automatically after every `build` via the `postbuild` npm lifecycle hook) | Generates `sitemap.xml` and `robots.txt` from `next-sitemap.config.js`. See below for exactly what it includes. |
| Start | `next start` | Standard Next.js production server. Requires `next build` to have already run. |

Other scripts defined in `package.json` (`dev`, `lint`, `test`, `test:unit`, `test:components`, `test:e2e`, `test:e2e:headed`, `sitemap`, `tinker`, `tinker:list`, `tinker:users`) are development/tooling scripts, not part of the deployment path.

`next.config.ts` contains exactly one non-default setting: `images.remotePatterns` allowlists `https://lh3.googleusercontent.com/**` (Google's avatar CDN host, needed because Google OAuth avatar URLs are rendered via `next/image`). There are no redirects, custom headers, or experimental flags configured.

### What `next-sitemap` actually generates (`next-sitemap.config.js`)

- `siteUrl` resolves from `NEXT_PUBLIC_APP_URL`, falling back to `NEXTAUTH_URL`, falling back to `http://localhost:3000` — so if neither of the first two is set in the production environment, the generated sitemap/robots.txt will contain `localhost` URLs.
- The sitemap does **not** include the whole site. A `transform` function drops every path except a hardcoded allowlist of exactly seven static routes: `/auth/magic-link`, `/forgot-password`, `/login`, `/portal/sign-in`, `/register`, `/reset-password`, `/verify`. Every authenticated/app route is deliberately excluded from the sitemap.
- An `additionalPaths` step appends `/status/<slug>` entries for each slug listed in the `SITEMAP_STATUS_SLUGS` environment variable (comma-separated). This variable is **not present** in `.env.local`, so in the current local configuration this step contributes zero extra paths; if public status pages should be indexed in production, this variable needs to be set there.
- `robots.txt` is generated with a single policy: `Allow: /` for all user agents — i.e., robots.txt permits crawling of everything, while the sitemap itself only ever lists the seven allowlisted paths plus any configured status-page slugs.

There is no other post-build step (no asset upload step, no cache invalidation step, no health-check step) present in `package.json`.

---

## Environment variables required to run the app

The table below consolidates every environment variable name found across all subsystem investigations into one list, deduplicated. "Consumed in code" means a `process.env.<NAME>` (or `getRequiredEnv("<NAME>")`) reference was actually found in application source (excluding `node_modules`). "Required/Optional" reflects how the code treats the variable at the point of use — a "Required" entry throws or returns a hard error (401/500) if unset; "Optional" entries have a fallback default. A blank "Consumed in code" cell means the variable exists in `.env.local` but no reference to it was found anywhere in the reviewed application code.

### Core app / NextAuth

| Variable | Required/Optional | Subsystem | Where read |
|---|---|---|---|
| `NEXTAUTH_SECRET` | Required | NextAuth session JWT signing; also the fallback secret for three unrelated JWTs (see Security notes below) | `auth.ts`; fallback in `lib/server/mfa-assertion.ts`, `lib/server/passkey-assertion.ts`, `lib/server/mfa-email-auth.ts` |
| `NEXTAUTH_URL` | Optional (first-choice base URL; falls back to `NEXT_PUBLIC_APP_URL`, then `http://localhost:3000`) | Redirect URLs for password reset, registration, magic link, passkey RP origin, Stripe checkout URLs, customer-portal links, invite links, executive-report dashboard links, sitemap `siteUrl` | Numerous files across auth, payments, team-invite, and reports subsystems |
| `NEXT_PUBLIC_APP_URL` | Optional (fallback if `NEXTAUTH_URL` unset) | Same base-URL role as above, second in the fallback chain | Same call sites as `NEXTAUTH_URL` |
| `NEXT_PUBLIC_API_URL` | Optional (defaults to `http://localhost:3000/api`) | Base URL for the `axiosAuth` axios client | `lib/axios.ts` |
| `SITEMAP_STATUS_SLUGS` | Optional (empty list if unset) | Comma-separated public-status-page slugs added to the sitemap | `next-sitemap.config.js` |
| `NODE_ENV` | Platform-provided | Controls `secure` flag on several cookies (active-org cookie, customer-portal session cookie) | `/api/me`, `/api/me/active-organization`, `/api/me/organizations`, `lib/server/customer-portal-auth.ts` |

### Supabase

| Variable | Required/Optional | Subsystem | Where read |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Required | Anon-key client, admin/service-role client construction | `lib/supabase.ts`, `lib/supabase-admin.ts`, `app/api/auth/register/route.ts` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Required | Anon-key Supabase client (browser-side auth calls, and the one genuine Supabase Realtime websocket subscription in the app) | `lib/supabase.ts` |
| `SUPABASE_SERVICE_ROLE_KEY` | Required | Admin/service-role Supabase client used by nearly every server-side route (bypasses RLS) | `lib/supabase-admin.ts`, `app/api/auth/register/route.ts`, `scripts/tinker.mjs` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | — | Present in `.env.local`; no reference found anywhere in application source | — |
| `SUPABASE_URL` | — | Present in `.env.local` (non-`NEXT_PUBLIC_` duplicate of the URL above); no reference found in application source | — |
| `SUPABASE_ANON_KEY` | — | Present in `.env.local` (non-`NEXT_PUBLIC_` duplicate of the anon key above); no reference found in application source | — |
| `SUPABASE_PUBLISHABLE_KEY` | — | Present in `.env.local`; no reference found in application source | — |
| `SUPABASE_SECRET_KEY` | — | Present in `.env.local`; no reference found in application source | — |
| `SUPABASE_JWT_SECRET` | — | Present in `.env.local`; no reference found in application source | — |
| `POSTGRES_DATABASE` | — | Present in `.env.local`; no reference found in application source | — |
| `POSTGRES_HOST` | — | Present in `.env.local`; no reference found in application source | — |
| `POSTGRES_PASSWORD` | — | Present in `.env.local`; no reference found in application source | — |
| `POSTGRES_PRISMA_URL` | — | Present in `.env.local`; no reference found in application source (no Prisma client exists in this repo) | — |
| `POSTGRES_URL` | — | Present in `.env.local`; no reference found in application source | — |
| `POSTGRES_URL_NON_POOLING` | — | Present in `.env.local`; no reference found in application source | — |
| `POSTGRES_USER` | — | Present in `.env.local`; no reference found in application source | — |

The unreferenced Supabase/Postgres variables above are almost certainly artifacts of a platform integration auto-populating a standard variable set (see the Vercel inference above) rather than anything the app deliberately requires — but this has not been confirmed with the team, and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `OPS_READ_WRITE_TOKEN` in particular have no discoverable purpose from source alone. Do not delete them from production without confirming they are genuinely dead.

### File storage

| Variable | Required/Optional | Subsystem | Where read |
|---|---|---|---|
| `BLOB_READ_WRITE_TOKEN` | Inferred required (see note) | Ticket/order/portal attachment storage via `@vercel/blob` | No direct `process.env.BLOB_READ_WRITE_TOKEN` reference was found in application source; the `@vercel/blob` SDK's documented convention is to read this variable internally when `put()`/`get()` are called without an explicit `token` option, which is how every attachment route in this app calls them. This is inferred from SDK convention, not from a source-code reference. |
| `SUPABASE_AVATAR_BUCKET` | Optional (defaults to `"avatars"`) | Avatar upload/delete storage bucket name | `app/api/me/avatar/route.ts`, `app/api/me/account/route.ts` |
| `OPS_READ_WRITE_TOKEN` | — | Present in `.env.local`; no reference found anywhere in application source | — |

### Email (Resend)

| Variable | Required/Optional | Subsystem | Where read |
|---|---|---|---|
| `RESEND_API_KEY` | Required (throws if unset, at send time) | All transactional email sends: registration verification, forgot-password, magic link, email-MFA codes, team invites, customer-portal access links, order payment-link emails, executive report emails | `app/api/auth/register/route.ts`, `app/api/auth/forgot-password/route.ts`, `lib/server/magic-link-email.ts`, `lib/server/mfa-email-code.ts`, `lib/server/team-invite-email.ts`, `lib/server/customer-portal-email.ts`, `lib/server/order-payment-email.ts`, `lib/server/executive-report-email.ts` |
| `RESEND_FROM_EMAIL` | Optional (each call site falls back to its own default, see note) | From-address override for the email sends above | `lib/server/magic-link-email.ts`, `lib/server/mfa-email-code.ts`, `lib/server/team-invite-email.ts`, `lib/server/customer-portal-email.ts`, `lib/server/order-payment-email.ts`, `lib/server/executive-report-email.ts` |

Note: `app/api/auth/register/route.ts` and `app/api/auth/forgot-password/route.ts` use a **hardcoded** from-address (`"OpsDesk <contact@ziadhatem.dev>"`) instead of `RESEND_FROM_EMAIL`, while every other email sender defaults to `"OpsDesk <onboarding@resend.dev>"` (or `"OpsDesk Billing <onboarding@resend.dev>"` / `"OpsDesk Analytics <onboarding@resend.dev>"` for their respective senders) if `RESEND_FROM_EMAIL` is unset. This is a real inconsistency in the source, not a documentation error — confirm which from-address should actually be used in production before relying on `RESEND_FROM_EMAIL` to control all outbound mail uniformly.

### Payments (Stripe)

| Variable | Required/Optional | Subsystem | Where read |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | Required (throws if unset) | Stripe SDK client construction, used to create Checkout Sessions for both the staff-initiated and customer-portal payment-link flows | `lib/server/stripe.ts` |
| `STRIPE_WEBHOOK_SECRET` | Required (throws if unset) | Verifies the `stripe-signature` header on the incoming webhook | `lib/server/stripe.ts`, consumed by `app/api/stripe/webhook/route.ts` |

### Passkeys / WebAuthn

| Variable | Required/Optional | Subsystem | Where read |
|---|---|---|---|
| `PASSKEY_RP_ID` | Optional (derived from `expectedOrigin`'s hostname if unset, else `"localhost"`) | WebAuthn Relying Party ID | `lib/server/passkey-config.ts` |
| `PASSKEY_RP_NAME` | Optional (default `"OpsDesk"`) | WebAuthn Relying Party display name | `lib/server/passkey-config.ts` |
| `PASSKEY_EXPECTED_ORIGIN` | Optional (falls back to the resolved base URL) | Expected WebAuthn ceremony origin | `lib/server/passkey-config.ts` |
| `PASSKEY_ASSERTION_SECRET` | Optional (falls back to `NEXTAUTH_SECRET`) | Signs the short-lived JWT bridging a completed WebAuthn ceremony into NextAuth sign-in | `lib/server/passkey-assertion.ts` |

### MFA (email one-time code)

| Variable | Required/Optional | Subsystem | Where read |
|---|---|---|---|
| `MFA_ASSERTION_SECRET` | Optional (falls back to `NEXTAUTH_SECRET`) | Signs the short-lived JWT bridging a verified email-MFA code into NextAuth sign-in | `lib/server/mfa-assertion.ts` |
| `MFA_EMAIL_CODE_SECRET` | Optional (falls back to `NEXTAUTH_SECRET`) | HMAC secret used to hash the 6-digit email MFA code before storing/comparing it | `lib/server/mfa-email-auth.ts` |

### Webhooks / scheduled jobs (external callers)

| Variable | Required/Optional | Subsystem | Where read |
|---|---|---|---|
| `COMMUNICATIONS_WEBHOOK_SECRET` | Required (the route returns 500 for every request if unset — fail-closed) | Shared-secret auth for the inbound `POST /api/communications/webhook/[channel]` endpoint | `app/api/communications/webhook/[channel]/route.ts` |
| `REPORTS_SCHEDULER_SECRET` | Required (the route returns 500 for every request if unset) | Shared-secret auth for `POST /api/reports/schedules/run`, the endpoint an external scheduler must call to actually send due executive reports | `app/api/reports/schedules/run/route.ts` |

`REPORTS_SCHEDULER_SECRET` is not present in `.env.local` and is not documented in the README's environment variable table — see the runbook note below; without it, scheduled executive reports cannot be delivered at all, silently, even though schedules will still display "Next run: ..." in the UI.

### Testing (non-production)

| Variable | Required/Optional | Subsystem | Where read |
|---|---|---|---|
| `PLAYWRIGHT_BASE_URL` | Optional (if unset, Playwright boots its own `npm run dev -- --port 4173`) | e2e test target base URL | `playwright.config.ts` |
| `CI` | Optional (generic convention; enables Playwright's `retries: 2`) | Test retry behavior | `playwright.config.ts` |

---

## Manual setup steps not automated by any script

These are steps a deployer must currently perform by hand; nothing in the repository automates them.

1. **Apply the database schema.** There is no migration-tracking mechanism (no `schema_migrations` table, no Prisma/Drizzle migration runner) — the `db/*.sql` files (19 total) are standalone, idempotent scripts intended to be run manually, in order, via the Supabase SQL Editor. Every route that depends on a not-yet-applied table returns a runtime error naming the specific file to run and instructs the operator to then run `NOTIFY pgrst, 'reload schema';`. The dependency order, reconstructed from in-file header comments and foreign-key dependencies, is:
   `db/topbar-schema.sql` → `db/team-schema.sql`, `db/saved-views-schema.sql` (its header comment says to apply it after `db/topbar-schema.sql`, and it references the `organizations`/`users` tables created there) → `db/customers-schema.sql` → `db/tickets-schema.sql` and `db/orders-schema.sql` (mutually soft-linked) → `db/sla-schema.sql`, `db/ticket-tags-schema.sql`, `db/automation-schema.sql`, `db/communications-schema.sql`, `db/customer-portal-schema.sql`, `db/orders-payments-schema.sql`, `db/executive-analytics-schema.sql`, `db/rbac-approvals-schema.sql`, `db/audit-logs-schema.sql`, `db/incidents-schema.sql` → `db/passkeys-schema.sql`, `db/mfa-email-schema.sql`, `db/notifications-realtime.sql` (no other-file dependencies for these last three).
2. **Create the Supabase Storage bucket for avatars.** The bucket named by `SUPABASE_AVATAR_BUCKET` (default `"avatars"`) must be created manually in Supabase Storage and made public, or the avatar upload endpoint (`POST /api/me/avatar`) returns a 500 pointing this out at request time.
3. **Wire up an external scheduler for executive report delivery.** `POST /api/reports/schedules/run` is the entire mechanism for sending scheduled executive-analytics report emails — it finds due schedules, computes analytics, emails recipients, and advances `next_run_at`. Nothing in this repository invokes it periodically (no cron config of any kind exists, per the CI/CD section above; `scripts/tinker.mjs` only seeds fixture data, it does not call this endpoint). An external cron (for example, a platform's scheduled-function feature, or an external cron service) must be configured to `POST` this endpoint with `Authorization: Bearer <REPORTS_SCHEDULER_SECRET>` (or the `x-scheduler-secret` header) on whatever cadence is desired. Until that is configured, schedules created through the `/reports` UI will never actually deliver an email.
4. **Wire up cleanup for two maintenance functions.** `cleanup_expired_email_mfa_challenges()` and `cleanup_expired_passkey_challenges()` are defined as Postgres functions (in `db/mfa-email-schema.sql` and `db/passkeys-schema.sql` respectively) but nothing in the repository schedules their execution (no `pg_cron` job, no external trigger). Left unscheduled, `email_mfa_challenges` and `passkey_challenges` rows accumulate indefinitely past their `expires_at`.

---

## Known limitations relevant to how this app is deployed

- **The invite-resend rate limiter is process-local, in-memory state** (`app/api/orgs/[orgId]/invites/[inviteId]/resend/route.ts` uses a plain module-level `Map`). If the app runs as more than one instance/replica (which is the normal case for most serverless or horizontally-scaled hosting), this rate limit will not be enforced consistently across instances.
- **No rate limiting was found** on several pre-login, enumeration-sensitive endpoints (passkey lookup/authenticate routes, the public status page route). If this is expected to be mitigated by infrastructure (a WAF, reverse proxy, or platform-level rate limiting), that mitigation is not present in this repository and must be configured at the platform/infra layer.
- **Two stray temp files exist at the repository root** (`.tmp_incidents_numbered.txt`, `.tmp_incidents_numbered_after.txt`, ~61KB and ~82KB). It is not verified here whether these are gitignored; confirm before assuming they are excluded from a deployment artifact/build.

---

## Missing Information

The following are things a complete deployment document would normally cover, which are absent from the repository and were not discoverable from source alone. These should be supplied by whoever operates the application, not guessed:

- **Confirmed hosting platform.** No committed config names one; the Vercel inference above is circumstantial only.
- **Any CI/CD pipeline definition** — build/test/deploy automation, required status checks, or a rollback procedure.
- **Containerization** — no Dockerfile/docker-compose exists; if the app is containerized in production, that Dockerfile lives outside this repository.
- **Infrastructure-as-code** — no Terraform, Pulumi, or platform-specific config (e.g., `vercel.json`) exists to describe compute, networking, or environment provisioning.
- **A migration-tracking mechanism** for the `db/*.sql` files — currently there is no record anywhere of which schema files have been applied to which environment. This is a real operational risk: re-running the SQL apply process against a wrong or already-migrated environment relies entirely on human memory of the file list above.
- **Backup and disaster-recovery strategy** for the Supabase Postgres database and Supabase Storage buckets.
- **Staging/preview environment strategy** — nothing in the repo indicates whether a preview/staging deployment exists or how one would be provisioned.
- **Node.js engine/version requirement** — `package.json` does not declare an `engines` field.
- **Monitoring, logging, and alerting** — no APM/error-tracking SDK (e.g., Sentry) or logging integration was found in dependencies; server-side errors are handled with `console.error`/`console.log` only, with no confirmed downstream log aggregation.
- **The real reason `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `OPS_READ_WRITE_TOKEN`, and the seven `POSTGRES_*`/duplicate `SUPABASE_*` variables exist in `.env.local`** with no code reference — confirm with the team whether these are safe to omit from a new environment's configuration or whether they're required by tooling/infrastructure not visible in the application source (e.g., a direct Postgres connection used by an out-of-repo script or BI tool).
- **Confirmation of the correct `RESEND_FROM_EMAIL` behavior** — since two email senders (registration, forgot-password) ignore this variable and use a hardcoded address while all others respect it, a deployer needs to know whether this is intentional before assuming setting `RESEND_FROM_EMAIL` controls all outbound mail.
