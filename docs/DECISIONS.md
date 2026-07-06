# Architecture Decision Records

## How to read this document

**These are not original ADRs.** The repository contains no `docs/adr/` folder, no design-discussion history, and no ADR references anywhere in its commit log (git history is a flat sequence of feature commits — e.g. `feat: implement comprehensive authentication system...`, `feat: add executive report email functionality and RBAC system implementation` — with no tags, no branches other than `main`, and no commit that reads like a design decision being recorded). Every record below has been **reconstructed after the fact by reading the code** and inferring what alternative was implicitly rejected. Where the reasoning in "Context"/"Consequences" goes beyond what a specific file literally does, it is reasoning *about* the evidence, not a quote from anyone who built it.

Each entry cites the specific files/behavior it is grounded in. Nothing below is invented; where the evidence was ambiguous, that ambiguity is stated rather than resolved by guessing. Status is `Inferred` for all records — none of these have ever been reviewed or ratified as a decision by the team.

Two additional, well-evidenced candidate decisions that are *not* written up as full ADRs here (to keep this document to the decisions with the clearest single alternative and the richest trade-off evidence) are listed at the end, under "Other candidate decisions."

---

## ADR-001: Combine NextAuth v5 (beta) with Supabase Auth, instead of using either system alone

**Status:** Inferred

### Context

The app needs (a) a session/cookie/JWT layer that plugs cleanly into Next.js App Router — server-side `auth()` calls in every API route and page, `useSession()` on the client, a single `pages.signIn` redirect target — and (b) a managed identity backend that already handles password hashing, OAuth (Google), magic-link generation, and admin operations (create/delete/list users, look up by id) without hand-rolling any of it. Supabase was already the Postgres/Storage/Auth backend for the rest of the product, so its Auth product was already present and paid for.

### Decision

`auth.ts` configures NextAuth v5 beta (`next-auth@^5.0.0-beta.30`) with **three `CredentialsProvider`s**, none of which verify a password against a NextAuth-owned table. Each one verifies against Supabase and then lets NextAuth's own `jwt`/`session` callbacks (`auth.ts:200-215`) mint the actual session cookie:

- `credentials` (default id, `auth.ts:53-93`) calls `supabase.auth.signInWithPassword`. Password sign-in on `/login` instead calls the Supabase SDK directly and bridges through the next provider — but this provider is not dead: `app/invite/[token]/page.tsx:156` calls `signIn("credentials", { email, password, redirect: false })` right after invite acceptance, as a plain email/password check distinct from `/login`'s Supabase-SDK-then-bridge flow.
- `supabase-token` (`auth.ts:94-147`) is the actual universal bridge: it takes a Supabase `accessToken`/`refreshToken` (already obtained client-side by password sign-in, Google OAuth via `supabase.auth.signInWithOAuth`, or magic-link), calls `supabase.auth.getUser(accessToken)` to validate it, and — this is the only provider three different front-end flows all funnel through — completes the NextAuth sign-in.
- `passkey-assertion` (`auth.ts:148-195`) bridges a WebAuthn ceremony result (via the third-party `next-passkey-webauthn` package) the same way, using a short-lived, separately-signed JWT (`lib/server/passkey-assertion.ts`) as the "credential."

Org-membership gating (`assertHasActiveMembership`, `auth.ts:35-49`) is centralized once, inside all three providers' `authorize()`, rather than being duplicated per sign-in-method front-end code.

Because of this split, **two independent sessions coexist per logged-in user**: the browser's own Supabase client session (used for Storage uploads, and — separately — a genuine Supabase Realtime websocket subscription for membership-suspension detection) and the NextAuth JWT session cookie (used by every `auth()` call across the API). Several flows exist purely to keep the two in sync by hand — e.g. signing the user out of Supabase when NextAuth's sign-in throws `account_suspended`, even though no NextAuth session was ever created in that case.

### Consequences

- **Pro:** the app gets Supabase's maintained password/OAuth/magic-link/admin-user machinery "for free," while every route in the app still gets NextAuth's App-Router-native `auth()`/`useSession()` ergonomics, instead of writing a bespoke Supabase-Auth-to-cookie bridge in every single route.
- **Pro:** the org-membership suspension check is enforced in exactly one place (`assertHasActiveMembership` inside the three providers) regardless of which sign-in method the user used.
- **Con:** there is no single source of truth for "is this user logged in" — the Supabase session and the NextAuth session are two independently-lived objects, and the codebase has to remember, in each flow, which one to tear down on failure.
- **Con:** the bridge providers (`supabase-token`, `passkey-assertion`) do not perform the actual authentication event themselves — they trust a token that was already validated by Supabase or the passkey library moments earlier. NextAuth here functions as a session/cookie issuer layered on top of Supabase's real authentication, not as an independent identity provider.
- **Con:** the `credentials` provider is a second, independent password-verification path alongside `/login`'s Supabase-SDK-then-bridge flow — `app/invite/[token]/page.tsx` calls it directly after invite acceptance, so there are now two different ways a password gets checked and turned into a NextAuth session, rather than one.

---

## ADR-002: Multi-tenancy via a shared schema + `organization_memberships`, enforced almost entirely at the application layer — not schema-per-tenant, and *not* Postgres RLS

**Status:** Inferred

### Context

The product needs to isolate one organization's tickets, orders, customers, incidents, etc. from another's, while letting a single user belong to (and switch between) multiple organizations.

### Decision

Every domain table — tickets, orders, customers, incidents, automation rules, audit logs, SLA policies, saved views, and roughly two dozen others — carries a plain `organization_id uuid not null references organizations(id) on delete cascade` column, and isolation is enforced by **every server route remembering to filter on it**: `lib/server/ticket-context.ts`'s `getTicketRequestContext()` and `lib/server/organization-context.ts`'s `getOrganizationActorContext(orgId)` resolve "which org is this request scoped to" from a cookie (`opsdesk_active_org_id`) or a URL path segment, and every ticket/order/customer/incident/automation/SLA/RBAC/reports/audit route adds `.eq("organization_id", ...)` accordingly. There is one Postgres schema shared by every tenant — no schema-per-tenant, no per-org database.

Critically, **Postgres Row Level Security is enabled on exactly three tables in the entire schema** — `public.passkeys` and its sibling `public.passkey_challenges` (both in `db/passkeys-schema.sql`), plus `public.email_mfa_challenges` (`db/mfa-email-schema.sql`) — and all three are keyed by `user_id`, not `organization_id`; their policies protect a user's own WebAuthn/MFA artifacts, not org-scoped business data. No `alter table ... enable row level security` or `create policy` referencing `organization_id` exists anywhere in `db/`. Nearly all business-table queries also run through a **service-role Supabase client** (`createSupabaseAdminClient()`), which bypasses RLS entirely even on the three tables where it is enabled — so RLS, where present, is not actually in the request path for most reads/writes anyway.

### Consequences

- **Pro:** cheapest possible model to build and query against — ordinary SQL joins across tickets/orders/customers work without cross-schema plumbing or per-tenant connection routing, and every table is defined exactly once.
- **Pro:** consistent with how "active organization" is resolved everywhere else in the app (a single cookie plus a live membership lookup), rather than needing tenant-aware connection selection.
- **Con (the significant one):** tenant isolation is a property of *code discipline*, not of the database. A single missing `.eq("organization_id", ...)` filter in any future query is a cross-tenant data leak with no second line of defense. This is a real, currently-unmitigated gap, not a hypothetical one — it is the reason RLS exists at all in this schema (for the three auth tables), which makes its absence everywhere else more conspicuous rather than less.
- **Con:** because the app's own business-table access pattern already goes through a service-role client that bypasses RLS by design, retrofitting RLS policies later would not close the gap by itself — the routes that currently use the admin client would also need to be moved to a user-scoped client for RLS to actually run.
- This should be read as a genuine, verifiable design choice (shared schema, app-layer filtering) — not as "RLS enforces multi-tenancy here," which a reader could otherwise reasonably assume given that RLS *is* used elsewhere in this same schema.

---

## ADR-003: Redux Toolkit for global/session-derived client state, instead of React Context or a server-state cache library (React Query/SWR)

**Status:** Inferred

### Context

The client needs state for: the logged-in user and auth status (mirrored from NextAuth's `useSession()`), the active organization plus the user's org list and unread-notification count (from `/api/me`), and an in-memory ticket list/detail cache that supports **optimistic UI updates** — a status/priority/assignee change should be reflected instantly, without waiting on a refetch.

### Decision

`lib/store/store.ts` registers exactly three Redux Toolkit slices — `auth`, `tickets`, `topbar` — and nothing else:

```ts
configureStore({ reducer: { auth: authReducer, tickets: ticketsReducer, topbar: topbarReducer } });
```

Data fetching is done with `createAsyncThunk` (`fetchTopbarData`, `switchTopbarOrganization`, `createTopbarOrganization`, `fetchTickets`, `fetchTicketDetail`, `createTicket`, `updateTicket`), and each slice manually tracks its own `status: "idle"|"loading"|"succeeded"|"failed"` / `error` / `loadedAt`. Cross-slice coordination is hand-written: `tickets-slice` listens for `topbar-slice`'s org-switch/org-create actions and wipes its own ticket cache (`resetTicketCacheForOrgChange`) whenever the active org id changes, and both slices reset fully on a shared `clearLoggedUser` action. Optimistic UI is implemented as plain (non-thunk) reducers — `applyOptimisticTicketPatch`, `addTicketTextToDetail`, `addTicketAttachmentToDetail` — that mutate the cached ticket list/detail directly without a round trip.

Notably, this pattern is applied selectively: orders, customers, incidents, automation, and reports pages fetch their own data with local component state, not through a Redux slice. Only auth, org-switching, and tickets got the global-store treatment.

### Consequences

- **Pro:** full, explicit, synchronously-inspectable control over the exact cross-slice behavior described above (wipe the ticket cache specifically when the active org changes; reset everything on logout) — this choreography is a natural `extraReducers` listener in Redux Toolkit, and would need bespoke glue on top of a query-key-based cache library to express the same thing.
- **Pro:** typed `useAppSelector`/`useAppDispatch` hooks give compile-time safety across the whole state shape.
- **Con:** the app re-implements request-lifecycle bookkeeping (loading/error/staleness) by hand, slice by slice, that a library like React Query or SWR provides out of the box (cache-key dedup, background refetch, retry, stale-time) — more boilerplate for the same guarantees, with no shared convention enforced beyond copy-pasted shape between slices.
- **Con:** cache invalidation is entirely manual and slice-specific — the ticket cache only invalidates on an explicit org-change action; there's no timer-based or refocus-based revalidation the way a server-state library provides by default.
- **Con:** the inconsistent application (3 slices for some domains, local `useState` for others) means a reader can't assume "global state = source of truth for this domain" project-wide; it has to be checked per page.

---

## ADR-004: Server-Sent Events (implemented as server-side polling) for the notification stream, instead of WebSockets — even though the app already uses a real WebSocket channel elsewhere

**Status:** Inferred

### Context

The topbar needs to reflect new/unread in-app notifications without the user manually refreshing.

### Decision

`GET /api/notifications/stream` (`app/api/notifications/stream/route.ts`, `runtime: "nodejs"`, `dynamic: "force-dynamic"`) opens a long-lived `text/event-stream` response and **polls Supabase every 5 seconds** server-side (`POLL_INTERVAL_MS = 5000`), computing a snapshot hash (`totalCount:unreadCount:latestNotificationId:latestCreatedAt`) and only pushing an `event: notifications.updated` frame to the client when that hash changes versus the previous poll; a `heartbeat` comment fires every 20 seconds (`HEARTBEAT_INTERVAL_MS = 20000`) to stop intermediary proxies from closing the idle connection, and the response sets `X-Accel-Buffering: no` specifically to defeat reverse-proxy buffering of the stream.

This is a deliberate choice **not** to use a genuine push mechanism for this specific feature — the same codebase already has one: `MembershipRealtimeGuard.tsx` opens a real Supabase Realtime `postgres_changes` subscription (a websocket) to detect when an admin suspends a user's org membership, and reacts within roughly 120ms of the underlying database change. There is also a `db/notifications-realtime.sql` migration that enables the `notifications` table for the `supabase_realtime` Postgres publication — but no client code anywhere in the repo subscribes to it; it appears to be enabled infrastructure with no consumer.

### Consequences

- **Pro:** a single long-lived HTTP connection with standard `EventSource` auto-reconnect semantics (`retry: 5000`) is simpler to stand up and operate than a bidirectional websocket, and this feature needs no client-side Supabase Realtime subscription/auth wiring of its own.
- **Pro:** hash-diffing means an idle connection sends almost nothing besides heartbeats, even though the server re-queries every 5 seconds regardless of whether anything changed.
- **Con:** this is polling with a push-shaped API on top — every open browser tab keeps a server connection alive and re-queries Supabase on a fixed 5-second cadence whether or not anything changed, a real per-connection cost that scales linearly with concurrently-open tabs, and is strictly less efficient than the push-based mechanism the app already uses one feature over.
- **Con:** there are now three different "live update" approaches for what is conceptually similar work, with no evident shared rationale: a true Realtime websocket (membership changes), SSE-shaped polling (notifications), and an enabled-but-unconsumed Realtime publication (also notifications) — a reader who only checks the SQL migrations would reasonably but incorrectly conclude notifications are pushed over Realtime.
- **Con:** the stream payload itself carries counts/ids only, not the notification content — the client must always make a second request (`fetchTopbarData()`, hitting `/api/me`) to get anything to actually display, adding a request hop to every update.

---

## ADR-005: `cache: "no-store"` on client fetches for operational/dashboard data, instead of relying on Next.js's default fetch caching or ISR

**Status:** Inferred

### Context

Next.js's App Router caches `fetch()` aggressively by default, and supports ISR (`revalidate`) for pages — attractive for read-heavy public content, but a poor fit for a per-organization, per-user operational dashboard where every request's correct answer depends on who is asking and which org they currently have active.

### Decision

Client-side fetches for operational, per-org data explicitly opt out of caching rather than relying on the framework default. `app/page.tsx` (the main dashboard) fetches `GET /api/dashboard?from=...&to=...` with `cache: "no-store"`, and `Topbar.tsx`'s global command-palette search fetches `GET /api/search?...` the same way. This pairs with the broader server-side pattern of resolving "active organization" fresh on every request from a cookie plus a live membership lookup (`getTicketRequestContext()`), rather than anything that could be safely memoized independent of the caller.

### Consequences

- **Pro:** correctness is easy to reason about — switching organizations, or a teammate updating a ticket, is reflected on the very next fetch, with no class of "stale shared cache leaked another org's numbers" bugs. A naive ISR/shared-cache setup would need the org id baked into every cache key to be safe at all.
- **Pro:** consistent with the app's per-request org-resolution model generally (ADR-002) — caching would be actively wrong here more often than it would help.
- **Con:** no caching layer means every dashboard load, every debounced search keystroke, and every reports-page load recomputes potentially expensive aggregate queries from scratch — the executive-analytics computation alone can pull up to 20,000–50,000 rows per table per request, with no Redis/CDN layer anywhere in the stack to absorb repeat load.
- **Con:** this is a per-call-site convention (`cache: "no-store"` passed at each individual `fetch()`), not a framework-level default or a shared utility — nothing stops a future page from omitting it and silently inheriting Next's default caching behavior for what is actually a per-org query.

---

## ADR-006: Ship a portable `exports/auth-system/` folder snapshot for reuse in other apps, instead of extracting the auth stack into an npm package

**Status:** Inferred

### Context

The auth system (NextAuth config, Supabase bridging, MFA, passkeys, magic link, forgot/reset password, the optional `/api/me/*` profile routes) is generic enough to be worth reusing in a future or sibling Next.js app, without necessarily dragging the rest of this product (tickets, orders, RBAC, etc.) along with it.

### Decision

The repository maintains `exports/auth-system/` — a folder containing copies of `auth.ts`, `app/api/auth/*`, `app/api/passkey/*`, three optional `/api/me/*` routes (`profile`, `avatar`, `account`), the `(auth)` pages plus `/auth/callback` and `/auth/magic-link`, the auth-related email templates, the relevant `lib/*`/`types/*` helpers, and the relevant `db/*.sql` files — alongside its own `README.md`, `.env.example`, and `package.auth.json` (confirmed present: `app/`, `auth.ts`, `db/`, `lib/`, `package.auth.json`, `public/`, `README.md`, `types/`). That README explicitly frames itself as "a portable snapshot of the core OpsDesk auth system so you can move it into another Next.js app," documents a Quick Start (copy the folder, merge `package.auth.json` dependencies, add env vars, run the `db/*.sql` files in order, wrap the target app in NextAuth's `SessionProvider`), instructs the integrator to strip the `assertHasActiveMembership(...)` org-membership gate if the destination app has no org-membership concept, and lists what it deliberately does *not* include (the live workspace profile page, the OpsDesk shell/layout's route-protection, Redux/topbar integration).

### Consequences

- **Pro:** zero packaging/versioning/publishing overhead — no private registry, no semver, no build step. "Reuse" is "copy this folder and merge two config files," the lowest-friction option for a small team.
- **Pro:** the export documents its own integration prerequisites directly in its README (Tailwind v4 tokens, the `@/*` path alias, the `next.config.ts` image-domain allowlist for Google avatars, `public/logo.webp`) — more self-contained than "go read the live source and figure out what you need."
- **Con:** this is a manual, point-in-time snapshot with no discoverable regeneration mechanism anywhere in the repo — no script was found that produces `exports/auth-system/` from the live tree, so nothing prevents the live `auth.ts`/`lib/server/*` from silently drifting out of sync with the exported copy over time, and there is no automated check that would catch such drift.
- **Con:** because `tsconfig.json`'s `include`/`exclude` only excludes `node_modules`, this duplicated tree is included in the live app's own TypeScript project and ESLint scope — effectively doubling the amount of near-identical auth code type-checked and linted on every run.
- **Con (relative to an npm package):** no single source of truth and no version to pin — a bugfix made in one copy has no mechanism to propagate to the other; keeping them consistent is a manual, easy-to-forget discipline, not a build-time guarantee.

---

## ADR-007: Client-side, layout-level route protection instead of `middleware.ts`

**Status:** Inferred

### Context

Next.js's App Router supports a root `middleware.ts` that can gate access to protected routes before a page renders, including at the edge. The alternative is for the client-rendered layout itself to check auth status and redirect.

### Decision

**No `middleware.ts` exists anywhere in this repository** — the only two files with that name in the entire working tree are inside `node_modules` (`node_modules/next-auth/src/middleware.ts`, `node_modules/redux/src/types/middleware.ts`); a repo-wide search returns nothing else. Route protection is instead implemented once, centrally, inside a **client component**: `app/layout-shell.tsx` (`"use client"`) declares an exact-match set of public routes —

```ts
const PUBLIC_AUTH_ROUTES = new Set([
  "/login", "/register", "/verify", "/forgot-password", "/reset-password",
  "/auth/callback", "/auth/magic-link", "/payment/thank-you",
]);
```

— plus prefix rules for `/invite/*`, `/portal*`, and `/status/*`, and uses NextAuth's `useSession()` inside a `useEffect` to `router.replace("/login")` when an unauthenticated session hits a non-public route, or `router.replace("/")` when an authenticated session hits one of the exact public **auth** routes (note: only the auth-route subset triggers this "already logged in" redirect — an authenticated user visiting `/portal`, `/status/[slug]`, or `/invite/[token]` is deliberately left alone). Separately, every domain's API routes each call NextAuth's `auth()` themselves (via shared helpers like `getTicketRequestContext()`/`getOrganizationActorContext()`) and return 401/403 independently — there is no middleware chokepoint backing this up.

Notably, the plain root layout, `app/layout.tsx`, is a Server Component (it exports Next.js `metadata`, which is only legal there) that does nothing but render `RootLayoutShell` from `layout-shell.tsx` — the actual protection logic lives in the second, client-only file, not in `layout.tsx` itself.

### Consequences

- **Pro:** the entire page-level authorization gate is readable in one file — one `Set`, a handful of prefix checks, one `useEffect` — rather than a separate edge-compatible middleware function with its own `matcher` config to maintain.
- **Pro:** because it's a `"use client"` component driven by `useSession()`, it naturally reuses the same session hook the rest of the app already depends on for UI state (e.g. the Redux `auth`-slice sync in `app/providers.tsx` watches the same hook), instead of maintaining a second, edge-runtime-safe way of reading the session.
- **Con:** this protection only ever runs client-side, *after* the page's JS has already been requested and started rendering — `layout-shell.tsx` has a visible loading-spinner branch specifically because the redirect can only fire once hydration confirms `status !== "authenticated"`. A `middleware.ts` approach can redirect before any page bytes are served. In practice, the real security boundary is each API route's own `auth()` check (which does run server-side); the layout gate is a navigation/UX convenience only, not a data-access boundary.
- **Con:** there is no single chokepoint guaranteeing a new route is protected — every new API route must remember to call the shared context helper itself; nothing analogous to a middleware `matcher` enforces this uniformly.
- **Con:** the public-route allowlist is a hand-maintained literal `Set` plus a few `startsWith` prefixes in one client file. A new public page that forgets to be added here will incorrectly bounce anonymous users to `/login`; conversely, a route accidentally added becomes unauthenticated by omission rather than by an explicit, reviewable route-level policy.

---

## Other candidate decisions (evidenced, not written up as full ADRs here)

The discovery notes surface additional patterns that are just as well-evidenced as the ones above and would make reasonable ADRs in a future pass, but are left out here to keep this document focused:

- **Email-delivered one-time codes for MFA step-up, instead of TOTP/authenticator-app-based MFA** (`lib/server/mfa-email-auth.ts`, `lib/server/mfa-email-code.ts`, `db/mfa-email-schema.sql`) — a second factor gated by `user_metadata.multi_step_auth_enabled`, delivered as a 6-digit code via Resend, rather than a standard RFC 6238 TOTP flow.
- **SLA timers computed as pure wall-clock elapsed minutes, with no business-hours/calendar concept** (`lib/server/sla-engine.ts`, `db/sla-schema.sql`) — an "8-hour SLA" counts nights and weekends the same as business hours; there is no calendar/timezone-aware due-date model anywhere in the schema.
- **Scheduled report delivery implemented as a secret-protected webhook requiring an external cron caller, rather than an in-process scheduler** (`app/api/reports/schedules/run/route.ts`) — the endpoint does all the real work (compute analytics, email recipients, advance `next_run_at`) but nothing in the repository ever calls it; it depends entirely on infrastructure (e.g., a Vercel Cron job) configured outside the codebase.

These are omitted from the numbered list above only for scope, not because the evidence is weaker — see the accompanying discovery notes (`automation_sla`, `auth_identity`, `reports_analytics`) for the full grounding.
