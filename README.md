# OpsDesk Frontend Technical README

OpsDesk is a multi-tenant support operations console built with Next.js App Router.
This document focuses on the frontend architecture, route surfaces, state/data flows, and developer workflow.

## Frontend Scope

The frontend includes three user-facing surfaces:

- Internal workspace app for support/admin teams (dashboard, tickets, orders, customers, incidents, reports, settings).
- Customer portal (`/portal`) for ticket replies and payment actions.
- Public status page (`/status/[slug]`) for external incident communication.

## Stack

- Framework: Next.js `16.1.6` (App Router), React `19`, TypeScript (strict).
- Styling: Tailwind CSS `v4`, CSS custom properties in `app/globals.css`.
- UI primitives: Radix UI wrappers under `app/components/ui/*`.
- State: Redux Toolkit (`auth`, `topbar`, `tickets` slices) + React local state.
- Auth/session: NextAuth v5 beta + Supabase auth.
- Realtime: SSE stream for notifications + Supabase channels for membership access changes.
- Tables/charts: TanStack React Table + Recharts.
- UX feedback: Sonner toasts.
- Passkeys: `next-passkey-webauthn` integration.
- Tests: Vitest + Testing Library + Playwright.

## Architecture

### App shell and route protection

- `app/layout.tsx` is a client layout shell.
- `app/providers.tsx` wires:
  - Redux `Provider`.
  - NextAuth `SessionProvider`.
  - `AuthSessionSync` (syncs session user into Redux and triggers topbar preload).
  - `NotificationRealtimeBridge`.
  - `MembershipRealtimeGuard`.
- Access control is done in layout:
  - Public auth routes: `/login`, `/register`, `/verify`, `/forgot-password`, `/reset-password`, `/auth/magic-link`, `/payment/thank-you`.
  - Public route prefixes: `/invite/`, `/portal`, `/status/`.
  - Non-public routes redirect unauthenticated users to `/login`.
  - Authenticated users are redirected away from auth pages to `/`.

### Navigation and workspace context

- Private workspace pages use:
  - `AppSidebar` (main navigation).
  - `Topbar` (organization switcher, global search, notifications, user menu).
- Active organization is part of topbar state (`/api/me` payload).
- Most feature pages are organization-scoped and show empty guidance when no active organization is selected.

### State model

- `lib/store/slices/auth-slice.ts`
  - Session-derived user profile (`email`, `name`, authenticated flag).
- `lib/store/slices/topbar-slice.ts`
  - User/org metadata, unread notifications count, org switching/creation async flows.
  - `organizationChangeVersion` increments when active org changes.
- `lib/store/slices/tickets-slice.ts`
  - Ticket list + ticket detail cache.
  - Async thunks for list/detail/create/update.
  - Optimistic updates for status/priority/assignee/SLA due date.
  - In-memory append for new comments and attachments.

### Data fetching pattern

- Primary frontend pattern is `fetch()` to internal app API routes (`/api/...`).
- Most reads use `cache: "no-store"` for operational freshness.
- Domain response contracts are typed under `lib/<domain>/types.ts`.
- `lib/axios.ts` exists (`axiosAuth`) but current page-level data flows primarily use native `fetch`.

### Realtime behavior

- `NotificationRealtimeBridge`
  - Opens `EventSource` connection to `/api/notifications/stream`.
  - Dispatches `fetchTopbarData()` and emits `notifications:updated`.
- `MembershipRealtimeGuard`
  - Polls + subscribes to `organization_memberships` changes via Supabase realtime.
  - If access becomes suspended-only, user is signed out and redirected.

### UI system

- Reusable UI components are in `app/components/ui`.
- Shared status rendering is centralized in `app/components/StatusBadge.tsx`.
- `app/components/DataTable.tsx` provides:
  - Sorting/filtering/pagination.
  - Column visibility toggle.
  - Column resizing.
  - Density modes (comfortable/compact).
- Global design tokens and typographic defaults live in `app/globals.css`.

## Route Surface (Frontend)

### Core workspace

- `/` Dashboard (`/api/dashboard`)
- `/tickets` + `/tickets/[id]`
- `/orders` + `/orders/[id]`
- `/customers` + `/customers/[id]`
- `/incidents`
- `/reports`
- `/notifications`
- `/calendar`
- `/help`
- `/account/profile`

### Settings

- `/settings/team` (members, invites, role assignment)
- `/settings/roles` (RBAC, custom roles, approval policies/queue)
- `/settings/sla` (SLA policy editing + manual escalation run)
- `/settings/automation` (rule builder for ticket/order/customer/incident/portal events)
- `/settings/activity` (audit timeline with filters and pagination)

### Auth and public routes

- `/login`, `/register`, `/verify`
- `/forgot-password`, `/reset-password`
- `/auth/magic-link` (magic link callback completion + MFA continuation)
- `/invite/[token]` (invite acceptance and account bootstrap)
- `/portal/sign-in`, `/portal`
- `/status/[slug]`
- `/payment/thank-you`

## Frontend Feature Notes

- Global command palette in topbar (`Ctrl/Cmd + K`) calls `/api/search`.
- Sidebar toggle shortcut (`Ctrl/Cmd + B`) via sidebar provider.
- Saved views are implemented for tickets/orders/customers via `/api/saved-views`.
- CSV export is available in list pages (tickets/orders/customers/reports).
- File attachment upload/download flows exist for ticket/order details and portal ticket replies.
- Reports page includes schedule CRUD + recent run history.
- Profile page supports:
  - Avatar upload/crop modes.
  - Password update.
  - Email magic-link send.
  - Passkey registration/list/remove.
  - Multi-step auth toggle.

## Folder Map (Frontend-Oriented)

```txt
app/
  layout.tsx
  providers.tsx
  globals.css
  components/
    AppSidebar.tsx
    Topbar.tsx
    DataTable.tsx
    StatusBadge.tsx
    ui/*
  (auth)/*                    # login/register/verify/forgot/reset
  auth/magic-link/page.tsx
  account/profile/page.tsx
  tickets/* orders/* customers/* incidents/* reports/*
  notifications/page.tsx
  settings/*                  # team/roles/sla/automation/activity
  portal/*                    # customer portal
  status/[slug]/page.tsx      # public status page
  api/*                       # internal API routes consumed by UI

lib/
  store/                      # Redux store + slices
  supabase.ts                 # browser supabase client
  passkey-endpoints.ts
  <domain>/types.ts           # typed frontend contracts

tests/
  unit/
  components/
  e2e/
```

## Local Development

### Prerequisites

- Node.js `20+`
- npm

### Install and run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Environment Variables (Frontend-Relevant)

Use `.env.local`. The following variables directly affect frontend behavior and auth/UI-linked flows:

| Variable | Required | Used for |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Browser Supabase client initialization |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Browser Supabase auth/realtime |
| `NEXT_PUBLIC_API_URL` | Optional | Base URL for `lib/axios.ts` client |
| `NEXT_PUBLIC_APP_URL` | Recommended | Absolute app URL fallback for links/callbacks |
| `NEXTAUTH_URL` | Yes | NextAuth callbacks and generated URLs |
| `NEXTAUTH_SECRET` | Yes | NextAuth/session/MFA assertion signing fallback |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Required by server routes that support frontend auth/profile flows |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | Feature-dependent | Email flows (magic link, MFA code, invite/report mailers) |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Feature-dependent | Portal payment/session handling |
| `PASSKEY_*` vars | Optional | Passkey RP/origin overrides |
| `SITEMAP_STATUS_SLUGS` | Optional | Comma-separated public status slugs to include in sitemap (for `/status/[slug]`) |

## Scripts

```bash
npm run dev
npm run build
npm run sitemap
npm run start
npm run lint
npm run test
npm run test:watch
npm run test:unit
npm run test:components
npm run test:e2e
npm run test:e2e:headed
```

`npm run build` now runs `next-sitemap` automatically via `postbuild` and emits `public/sitemap.xml`, `public/sitemap-0.xml`, and `public/robots.txt`.

## Testing Strategy

- Unit tests (`tests/unit`)
  - Slice logic (auth, topbar, tickets).
  - Flow helpers (login/register/verify/forgot/reset).
  - Validation helpers (tickets/orders/customers).
- Component tests (`tests/components`)
  - Auth pages (login/register/verify/forgot/reset) with mocked router/APIs.
- E2E tests (`tests/e2e`)
  - Register/verify/login/forgot-password journeys.
  - Uses Playwright with route mocking for deterministic auth callbacks.
  - Default e2e base URL is `http://127.0.0.1:4173`.

## Frontend Conventions

- Keep API payload typing in domain `types.ts` files.
- Use `cache: "no-store"` for mutable operational dashboards/lists.
- Keep user feedback explicit via `toast.success/error`.
- Prefer centralized status rendering (`StatusBadge`) over ad hoc badge logic.
- For org-scoped pages, guard for missing `activeOrgId` and render actionable empty states.

## Troubleshooting

- Passkeys fail on mobile or LAN URL:
  - Use HTTPS origin (or localhost). Passkey flows require secure context.
- Repeated redirect to login:
  - Verify session cookies and `NEXTAUTH_URL`/`NEXTAUTH_SECRET`.
- Empty workspace data:
  - Ensure an active organization exists and is selected.
- E2E startup issues:
  - Confirm `npm run dev` works; Playwright launches dev server on port `4173` by default.
