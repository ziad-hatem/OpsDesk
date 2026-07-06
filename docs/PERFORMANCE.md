# Performance

This document describes the performance-relevant patterns actually implemented in OpsDesk's code — how data is fetched and cached (or deliberately not cached), how lists are paginated, how "realtime" features are delivered, how images are optimized, how the client bundle is split, and what the build pipeline generates. It does not contain benchmarks, load-test results, or measured latency numbers, because none exist in this repository (see [Missing Information](#missing-information)). Every claim below was verified either by a discovery-agent read of the source or by a direct repo search performed while writing this document.

---

## Data freshness over caching: `cache: "no-store"` is the default everywhere

A repo-wide search for `cache: "no-store"` in `app/` returns matches in more than 30 client-side `fetch` call sites, covering nearly every page and settings screen that reads from an internal API route: the dashboard (`app/page.tsx`), tickets list and detail (`app/tickets/page.tsx`, `app/tickets/[id]/page.tsx`), orders list and detail (`app/orders/page.tsx`, `app/orders/[id]/page.tsx`), customers list and detail (`app/customers/page.tsx`, `app/customers/[id]/page.tsx`), incidents (`app/incidents/page.tsx`), reports (`app/reports/page.tsx`, both the analytics fetch and the schedules fetch), notifications (`app/notifications/page.tsx`), the calendar (`app/calendar/page.tsx`), the customer portal (`app/portal/page.tsx`), invite acceptance (`app/invite/[token]/page.tsx`), the public status page (`app/status/[slug]/page.tsx`), account profile (`app/account/profile/page.tsx`), the topbar's global search (`app/components/Topbar.tsx`), and every settings screen with a live data view (team, roles/RBAC, SLA, activity/audit log, automation).

No corresponding `next: { revalidate }` option or bare `revalidate` value was found alongside any of these calls — the pattern is uniformly "skip caching entirely," not "cache for N seconds." This is a deliberate, repo-wide convention rather than an isolated choice on one or two pages.

**Trade-off.** The upside is straightforward: every page load, filter change, tab switch, or organization switch re-runs the query against the live database, so a user never sees a stale response left over from the Next.js Data Cache, the browser's HTTP cache, or a shared CDN edge cache. This matters specifically because of how the app scopes data — every request is implicitly scoped to whichever organization is currently "active" (tracked via the `opsdesk_active_org_id` cookie and resolved server-side per request), and that active org can change without a full page reload. The Redux `tickets` slice reinforces the same discipline at the client-state layer: it wipes its cached ticket list and detail cache by comparing its own tracked `activeOrgId` against the incoming `activeOrgId` whenever `fetchTopbarData`/`switchTopbarOrganization`/`createTopbarOrganization` resolve — not via the separate (and otherwise unused) `organizationChangeVersion` counter that lives in the topbar slice. `cache: "no-store"` is the fetch-level analog of that same "never let cross-org data linger" principle.

The downside is that there is no response caching anywhere in these request paths — no browser reuse, no Next.js Data Cache reuse, no edge cache. Every one of these requests re-executes its full query (and, for a handful of routes, a full in-memory aggregation — see [Server-side in-memory aggregation](#server-side-in-memory-aggregation) below) on every navigation or re-fetch. Combined with the absence of any caching layer in front of the API routes themselves (no Redis, no CDN cache-control policy — see Missing Information), the cost of "always fresh" is "always fully recomputed."

---

## List rendering: client-side pagination, not virtualization

`app/components/DataTable.tsx` is the shared table component behind tickets, orders, customers, and other list views. It is built on `@tanstack/react-table` with `getCoreRowModel`, `getSortedRowModel`, `getFilteredRowModel`, and `getPaginationRowModel` all enabled, plus column resizing (`enableColumnResizing: true`, `columnResizeMode: "onChange"`) and a density toggle (comfortable/compact row padding).

Two details matter for performance:

1. **Pagination is entirely client-side.** The full `data` array passed into the table is already resident in memory — it was fetched in one request by the calling page or Redux thunk. `getPaginationRowModel()` only slices that in-memory array into pages; it does not make additional network requests as the user pages through. The row-per-page control offers `[10, 20, 30, 40, 50]`, and no `initialState.pagination.pageSize` is configured in `useReactTable`'s options (verified directly in `app/components/DataTable.tsx`), so the first render falls back to TanStack Table's built-in default of 10 rows per page until the user changes it.
2. **No row virtualization is used anywhere** (no `react-window`, `@tanstack/react-virtual`, or equivalent). Because pagination happens *after* the full dataset is already in memory, only the current page's rows are ever mounted as DOM nodes — so DOM size isn't the bottleneck. The actual cost is front-loaded into the single fetch that populates the array in the first place.

What bounds the size of that in-memory array is the **API layer's own `limit` parameter**, not DataTable:

| Domain | List endpoint | How the row count is bounded |
|---|---|---|
| Tickets | `GET /api/tickets` | Fixed `limit` of 500 rows |
| Orders | `GET /api/orders` | Client-configurable `limit`, capped at 1000, default 200 |
| Customers | `GET /api/customers` | Client-configurable `limit`, capped at 1000, default 200 |
| Audit logs | `GET /api/orgs/{orgId}/audit-logs` | True server-side pagination: `page` (default 1) + `limit` (default 25, capped at 100) |

Audit logs is the only list endpoint reviewed that implements real server-side, page-token-style pagination. Tickets, orders, and customers instead fetch one bounded batch — up to 500–1000 rows — and let DataTable's client-side pager slice it in the browser. For an organization whose ticket/order/customer count approaches those caps, this means every list-page load or re-fetch (which, per the section above, happens on essentially every navigation and filter change because of `cache: "no-store"`) transfers and JSON-parses the entire capped row set even though the user is only looking at 10–50 rows at a time. The Redux `tickets` slice mirrors this: it stores the whole fetched `list: TicketListItem[]` array and invalidates it wholesale on organization switch, not incrementally.

---

## Server-side in-memory aggregation

Three read paths compute derived/rollup data by loading full row sets into Node process memory and aggregating in application code, rather than pushing the aggregation into SQL:

- **`GET /api/customers`** computes each customer's `open_tickets_count`, `total_tickets_count`, `total_orders_count`, and `total_revenue_amount` by pulling *all* of the org's tickets and orders into memory and aggregating them in JavaScript in the route handler — there is no SQL `GROUP BY` behind these counts.
- **`computeExecutiveAnalytics()`** (`lib/server/executive-analytics.ts`), which backs both the interactive `GET /api/reports` endpoint and every scheduled-report email run, issues one `Promise.all` per invocation against six tables, each capped at a hardcoded row limit: up to 20,000 rows each from `orders`, `tickets`, and `incidents`, and up to 50,000 rows each from `ticket_texts` and `ticket_sla_events` (plus an uncapped `customers` query filtered only by date). All of the response-time, resolution-time, SLA-compliance, and satisfaction-proxy metrics are then derived from those rows in memory — and because every metric is computed for three overlapping date windows (current period, previous period, same period one year prior), a meaningful share of that in-memory work effectively runs three times per request.
- **`GET /api/dashboard`** pulls a bounded but sizeable window of up to 5,000 order rows (plus smaller ticket/customer queries) into memory to build the revenue trend, SLA compliance trend, and KPI tiles.

None of these three paths implement streaming or incremental computation — the caps are flat row limits, not a windowing/cursor strategy, so the cost of each request scales with how close an organization's actual data volume is to those caps. Because none of these responses are cached (see the `cache: "no-store"` pattern above), and because the analytics computation additionally writes its results into an `analytics_metric_snapshots` table that nothing in the reviewed code ever reads back from, every one of these requests recomputes from raw rows rather than reading a previously-computed value — there is no warm-cache path for any of them today.

---

## Realtime delivery: one genuine push channel, one poll dressed as a stream, and a redundant fallback

OpsDesk has two "realtime" client-side mechanisms, and they are implemented very differently from each other:

| Mechanism | Component | Transport | Interval | Purpose |
|---|---|---|---|---|
| Notification updates | `app/components/NotificationRealtimeBridge.tsx` via `GET /api/notifications/stream` | Server-Sent Events (`EventSource`) | Server polls Supabase every `POLL_INTERVAL_MS = 5000` (5s) inside the request handler; a `: keepalive` comment is sent every `HEARTBEAT_INTERVAL_MS = 20000` (20s) | Tells the client when its unread-notification count/latest-notification snapshot has changed, so it can re-fetch full data |
| Membership-suspension enforcement | `app/components/MembershipRealtimeGuard.tsx` | Supabase Realtime (`postgres_changes` over websocket), server-scoped to the caller's own `user_id` | Push-driven, debounced 120ms on receipt | Detects when all of a user's org memberships have been suspended and force-signs them out |
| Same as above, fallback | Same component | `setInterval` poll | Every 45 seconds, unconditionally | Guarantees the same check runs even if the websocket never delivers an event |

The notifications "stream" is genuinely SSE at the transport level, but the server-side implementation is polling: the route handler queries Supabase for a small snapshot (`totalCount`, `unreadCount`, `latestNotificationId`, `latestCreatedAt`) every 5 seconds and only emits an SSE event when a hash of that snapshot changes; it never receives a push from the database. The route is explicitly forced out of Next's normal caching/optimization path (`export const dynamic = "force-dynamic"`, `export const revalidate = 0`, `export const runtime = "nodejs"`) — necessary to keep a long-lived connection open and stop Next.js from trying to statically optimize or cache it.

The membership guard, by contrast, is genuinely push-driven: it subscribes to a Postgres `postgres_changes` channel on `organization_memberships` filtered to the current user's row. It is nonetheless paired with an *unconditional* 45-second poll of the identical check, run regardless of whether the websocket has delivered anything — the discovery notes describe this as "a fast-path/optimization on top of a guaranteed 45s polling fallback, not the sole enforcement mechanism," i.e., the polling path is the one actually guaranteed to work, and the websocket is a latency optimization on top of it.

**Net resource cost per open, authenticated browser tab:** one long-lived server-side SSE connection (Node runtime, polling Supabase every 5s), one open Supabase Realtime websocket, and one 45-second client-side timer — three concurrently live mechanisms serving two distinct features. There is also a duplicated-fetch pattern layered on top: both `NotificationRealtimeBridge` (which owns the SSE connection) and `app/components/Topbar.tsx` independently listen for the same `window` `"notifications:updated"` custom event and each separately calls the `fetchTopbarData()` thunk (which hits `GET /api/me`) in response — so a single notification change can trigger two near-simultaneous `/api/me` calls from the same tab.

Separately, `db/topbar-schema.sql` and the standalone `db/notifications-realtime.sql` both add the `notifications` table to the `supabase_realtime` Postgres publication — but no client code found anywhere in the app subscribes to a `postgres_changes` channel on `notifications`. The only genuine websocket subscription in the codebase targets `organization_memberships`. This publication configuration for `notifications` appears to be unused infrastructure relative to what the app actually consumes today.

None of the above is expressed with a measured concurrent-connection ceiling or CPU/memory cost — it is a description of the mechanism as implemented, not a load-tested capacity figure (see Missing Information).

---

## Image delivery

`next.config.ts` contains exactly one non-default setting:

```ts
images: {
  remotePatterns: [
    { protocol: "https", hostname: "lh3.googleusercontent.com", port: "", pathname: "/**" },
  ],
}
```

This allowlists a single remote host — Google's avatar CDN — so that Google OAuth profile photos can be rendered through `next/image`'s built-in optimizer. No other remote host is configured, and there are no other image-related overrides (`formats`, `deviceSizes`/`imageSizes`, `unoptimized`) anywhere in the config — everything else about image handling is Next.js's default behavior.

Locally-hosted static assets rendered via `next/image` (for example, the sidebar wordmark at `public/logo.webp`, loaded with the `priority` flag) don't need a remote-pattern entry, since they're same-origin.

Two other user-photo paths exist in the app — Supabase Storage-hosted avatar uploads (served as public URLs with a cache-busting `?v=<timestamp>` query string) and the third-party `facehash` package used for generated placeholder avatars in the topbar and account-profile screens — but whether each of these actually routes through `next/image`'s optimizer, as opposed to a plain `<img>` element, was not confirmed component-by-component in the underlying investigation. Treat `next/image` optimization as confirmed only for the Google-avatar and local-logo cases described above.

---

## Code splitting

OpsDesk uses the Next.js App Router (`app/` directory), which automatically gives each route segment its own bundle — navigating between, say, `/tickets` and `/orders` only requires the JavaScript for the route being entered, not the whole app. Two structural details in this codebase reinforce that default behavior:

- **`app/layout.tsx` is a Server Component** (no `"use client"` directive; it exports Next.js `metadata` directly, which is only legal in a Server Component). It renders nothing but the HTML shell and delegates to `app/layout-shell.tsx`, which *is* `"use client"` and holds all of the session-aware redirect logic and the decision of whether to mount the authenticated app shell. Because `layout.tsx` itself carries no client-side interactivity, it contributes no JavaScript payload of its own — only `layout-shell.tsx`'s logic does.
- **`layout-shell.tsx` conditionally mounts the heaviest client-side component tree.** For public routes (the auth pages, the customer portal, the public status page), it renders a bare `<main>` with just a theme toggle and a toaster — `AppSidebar` and `Topbar` are not rendered at all. `Topbar` alone owns the organization switcher, the `Ctrl/Cmd+K` command palette (`cmdk`), the notification bell, and the SSE connection described above, so none of that component-tree code executes for a visitor on `/login`, `/portal`, or `/status/[slug]`. Whether this also translates into a smaller *shipped bundle* for those routes (versus the code being present but simply not rendered) depends on Next's own per-route chunking and was not independently profiled.

No manual code-splitting was found: a repo-wide search for `next/dynamic` and `React.lazy` inside `app/` returned no real usage — the only `import(...)`-shaped matches are TypeScript `typeof import(...)` type-only references used for type inference (e.g., typing a Supabase client parameter), not runtime dynamic imports. Whatever splitting exists is what the App Router provides automatically; nothing in the app has been manually split for bundle-size reasons.

**Dependency footprint note.** `package.json` lists a full Radix UI primitive set (used throughout `app/components/ui/*`) *and* a separate MUI installation (`@mui/material`, `@mui/icons-material`, plus its `@emotion/react`/`@emotion/styled` runtime dependencies) as direct dependencies. A repo-wide search for `@mui/` and `@emotion/` imports across the entire tracked TypeScript source tree returned zero matches — nothing in the application code imports either package. If nothing imports them, standard bundler tree-shaking should exclude them from any shipped output regardless of their presence in `package.json`, so this is flagged only as a dependency-hygiene / potential-confusion observation, not a demonstrated bundle-size problem — no bundle analyzer was run to confirm actual shipped bytes either way.

---

## Build-time: sitemap generation (`postbuild`)

`package.json` wires `next-sitemap` to run automatically after every production build:

```json
"build": "next build",
"postbuild": "next-sitemap"
```

`next-sitemap.config.js` resolves `siteUrl` from `NEXT_PUBLIC_APP_URL`, falling back to `NEXTAUTH_URL`, falling back to `http://localhost:3000`. A `transform` function then drops (returns `null` for) every generated path except a hardcoded seven-entry allowlist:

```
/auth/magic-link, /forgot-password, /login, /portal/sign-in, /register, /reset-password, /verify
```

Every authenticated/application route — the dashboard, tickets, orders, customers, incidents, reports, every settings screen — is excluded from `sitemap.xml` by construction, not by omission. An `additionalPaths` step appends `/status/<slug>` entries for each slug listed in the `SITEMAP_STATUS_SLUGS` environment variable (comma-separated); that variable is not present in `.env.local`, so in the current local configuration this step contributes zero additional paths.

`robotsTxtOptions` generates a `robots.txt` with a single policy — `Allow: /` for all user agents — meaning crawling is not blocked anywhere at the robots.txt level, while `sitemap.xml` itself only ever advertises the seven allowlisted static routes plus any configured public status-page slugs. The net effect is broad crawl *permission* paired with a deliberately narrow crawl *discovery surface*: nothing stops a crawler from requesting an authenticated route directly, but the generated sitemap never points one at it.

This is purely a static-file generation step (`sitemap.xml`, `robots.txt`) that runs once per build — it has no effect on runtime page performance, only on what an external crawler is told to look at after a deploy.

---

## Missing Information

The following are explicitly absent from the repository and are not addressed anywhere in the underlying investigation notes. They are listed here rather than guessed at:

- **No bundle analyzer.** No `@next/bundle-analyzer`, no `next.config.ts` analyze flag, and no other bundle-size tooling exists in `package.json` or any config file. No note or file anywhere cites an actual bundle-size figure for any route.
- **No Lighthouse CI, and no standalone Lighthouse run** is configured or referenced anywhere in the repository.
- **No load-testing tool** (k6, Artillery, autocannon, or similar) and no load-test results exist anywhere in the repository or in the discovery notes.
- **No HTTP cache header is used to enable caching on any API route reviewed** — the only `Cache-Control` headers found (on the SSE route at `app/api/notifications/stream/route.ts:192`, which sends `"no-cache, no-transform"`, and on the three attachment-download routes — `app/api/orders/[id]/attachments/[attachmentId]/route.ts:86`, `app/api/portal/tickets/[id]/attachments/[attachmentId]/route.ts:111`, and `app/api/tickets/[id]/attachments/[attachmentId]/route.ts:89` — each of which sends `"private, no-store"`) explicitly disable caching, reinforcing rather than contradicting the no-caching convention. No Redis/memcached and no CDN cache-control policy for API responses exist either. Combined with the pervasive `cache: "no-store"` pattern described above, every read path — including the in-memory-aggregation ones — is fully re-executed on every request.
- **No production performance monitoring** (APM, Web Vitals reporting, Core Web Vitals collection, error/latency tracing) was found referenced in `package.json`, `next.config.ts`, or any subsystem's notes.
- **No documented performance target or SLO** exists anywhere — no stated goal for API response time, page load time, or report/dashboard computation latency.
- **No CI pipeline exists at all** (confirmed separately in the deployment investigation: no `.github/workflows`, no other CI config), so there is also no automated performance regression check of any kind gating changes.
- Whether `next/image`'s optimizer is actually invoked for Supabase-hosted avatar URLs and `facehash`-generated avatars (as opposed to a plain `<img>` element) was not confirmed component-by-component — confirm before treating avatar images as covered by Next's image optimization.
- The 5-second notification-poll interval and the 45-second membership-poll interval are documented here as observed constants in the code, not as the output of a stated capacity/resource-budget decision — no note found a comment or design record explaining why those specific intervals were chosen, or what connection-count/read-volume they were sized against.
