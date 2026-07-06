# OpsDesk — Internal API Reference

This document catalogs every route handler under `app/api/**` in the OpsDesk repository. It is grounded entirely in the verified discovery notes produced for this codebase (auth/identity, RBAC/audit, database schema, core domain APIs, automation/SLA, payments/portal, notifications/realtime, reports/analytics, team/misc domains, frontend architecture, and tooling/deployment investigations), cross-checked against the actual `app/api/**` route file listing. Where the notes flagged a detail as unverified, unread, or ambiguous, that is stated explicitly rather than inferred.

There is **no OpenAPI/Swagger specification** in the repository and **no API versioning scheme** (no `/v1/` prefix, no version header) — every route below is the current and only version. Route shapes were reverse-engineered file-by-file by the discovery agents; this document does not add anything beyond what they verified.

## Conventions used in this document

**Auth categories** (each route below is tagged with one of these):

| Label | Meaning |
|---|---|
| **Public** | No authentication check found in the route handler. |
| **Session** | Requires a valid NextAuth session (`auth()` / `getTicketRequestContext()`). The caller must have at least one non-suspended `organization_memberships` row; the "active organization" is resolved from the `opsdesk_active_org_id` cookie, falling back to the user's first membership. |
| **Session + org actor context** | Requires a valid NextAuth session **and** an active membership specifically in the organization named by the `orgId` route parameter (`getOrganizationActorContext(orgId)`), which is stricter than the cookie-based resolution above — used by every `/api/orgs/[orgId]/**` route. |
| **Session + RBAC(`key`)** | On top of session/org-actor auth, gated by `authorizeRbacAction()` against the named permission key. Some of these are additionally **approval-flow eligible** (noted per route) — if the organization has an enabled approval policy for that permission key, the action returns `409 { code: "approval_required", approvalRequestId }` instead of executing, and must be re-invoked after an approver decides on it. |
| **Session + role check** | Gated by a hardcoded `role === "admin" \|\| role === "manager"` check in the route itself, **not** the RBAC permission-key/approval engine (SLA endpoints only — flagged in the discovery notes as an inconsistency with the RBAC-integrated automation endpoints). |
| **Customer-portal session** | A separate, non-NextAuth session identified by the `opsdesk_customer_portal` cookie, issued by the customer-portal magic-link flow (`lib/server/customer-portal-auth.ts`). Entirely distinct from staff/NextAuth auth — a staff NextAuth session does not grant access to portal routes or vice versa. |
| **Service secret** | No user session; the caller must present a shared secret (header or bearer token) matching a server-only env var, or (Stripe only) a cryptographic signature. |

**Cookies referenced throughout:** `opsdesk_active_org_id` (`ACTIVE_ORG_COOKIE`, httpOnly, `sameSite: lax`, secure in production, 30-day max age) carries the staff active-organization selection; `opsdesk_customer_portal` (httpOnly, `sameSite: lax`, secure in production, 14-day max age) carries the customer-portal session token hash.

**Known cross-cutting inconsistencies** (documented in the audit, restated here so this reference doesn't imply false uniformity):
- **Pagination is not standardized.** Tickets/orders/customers use a `limit` query param only (no page number); audit logs use `page` + `limit`; dashboard/reports use date-range params instead of pagination.
- **Error envelopes are not standardized.** Nearly every route returns `{ error: string }` on failure; some additionally include a `code` field (e.g., `account_suspended`, `approval_required`); there is no single documented error schema.
- Several routes explicitly force `export const runtime = "nodejs"` because they need Node-only crypto/streaming APIs; other routes use the platform default. This list is illustrative, not exhaustive — it includes all six `/api/passkey/**` routes, `/api/orders/[id]/payment-link`, `/api/stripe/webhook`, `/api/notifications/stream`, `/api/communications/webhook/[channel]`, `/api/reports/schedules/run`, `/api/portal/orders/[id]/pay`, `/api/portal/auth/request-link`, `/api/auth/passkey/lookup`, `/api/auth/passwordless/magic-link`, `/api/auth/mfa/email/send`, and `/api/auth/mfa/email/verify`.
- Internals of `lib/server/rbac.ts`, `lib/server/automation-engine.ts`, `lib/server/communications.ts`, `lib/server/audit-logs.ts`, and `lib/server/notifications.ts` were only partially read by the discovery agents (call sites and signatures were confirmed; full internal logic for every code path was not). Where a route's *existence, method, and top-level auth gate* are well-verified but a deeper behavioral detail is not, this is noted inline.

---

## Auth

NextAuth v5 (JWT-strategy sessions, no database adapter) plus a set of custom Supabase-Auth-backed routes handle registration, password reset, magic-link, and email-MFA. See `auth.ts` for the three registered `CredentialsProvider`s (`credentials`, `supabase-token`, `passkey-assertion`).

| Path | Method | Purpose | Auth | Details |
|---|---|---|---|---|
| `/api/auth/[...nextauth]` | GET, POST | NextAuth's catch-all handler — session issuance/validation and the `authorize()` logic for the three credentials providers (`credentials`, `supabase-token`, `passkey-assertion`). | Public (this route *is* the login/session mechanism) | Standard NextAuth v5 catch-all; the discovery notes verified the three registered providers and their `auth.ts` logic in detail but did not enumerate every internal NextAuth sub-path (e.g. `signin`, `callback`, `session`, `csrf`) individually — those are NextAuth's own standard surface, not custom OpsDesk code. |
| `/api/auth/register` | POST | Create a Supabase Auth user (password signup) + send a verification email via Resend. | Public | Stamps `user_metadata.registered_via_opsdesk = true` immediately (not deferred to email click). Email send failure is logged but does not fail the request. Uses a hardcoded `from` address (`contact@ziadhatem.dev`) rather than `RESEND_FROM_EMAIL` — an inconsistency versus other transactional emails, per the notes. |
| `/api/auth/forgot-password` | POST | Generate a Supabase password-recovery link and email it. | Public | Always returns the same generic success message regardless of whether the email matches an account (deliberately non-enumerating). Also uses the hardcoded `contact@ziadhatem.dev` from-address. |
| `/api/auth/passwordless/magic-link` | POST | Generate and email a Supabase magic-link sign-in token. | Public (falls back to the current session's email if the request body omits `email`) | Validates the email belongs to a **registered** Supabase auth user via `listUsers` pagination and returns 404 if not — this makes the route account-enumerating, in contrast to forgot-password's deliberately generic response. |
| `/api/auth/mfa/email/send` | POST | Send a 6-digit email MFA code for the step-up flow. | Public route; authenticates the caller via a Supabase `accessToken` in the request body, not a NextAuth session | Requires `user_metadata.multi_step_auth_enabled`. Enforces a 45-second per-user resend cooldown (`email_mfa_challenges.last_sent_at`). |
| `/api/auth/mfa/email/verify` | POST | Verify a submitted 6-digit MFA code and mint a short-lived `mfaAssertion` JWT. | Public route; authenticates via `accessToken` in the body | Max 5 attempts before the challenge is deleted (429). On success, the returned `mfaAssertion` is passed into `signIn("supabase-token", ...)` to complete NextAuth sign-in. |
| `/api/auth/oauth/account-check` | POST | Determine whether a Google-OAuth-authenticated Supabase user already has an OpsDesk account (vs. is brand new). | Public route; authenticates via `accessToken` in the body | Considers the account "existing" if `user_metadata.registered_via_opsdesk`/`created_from_invite`/`company` is set, or a row exists in `users` or `organization_memberships`. Degrades gracefully if those tables are missing. |
| `/api/auth/passkey/lookup` | POST | Pre-login check for whether an email has a registered passkey (drives the "Continue with Passkey" button on `/login`). | Public | See Passkey domain below — grouped there topically even though its path is under `/api/auth/passkey/` rather than `/api/passkey/`. |

---

## Passkey (WebAuthn)

All six `/api/passkey/**` routes are `POST`, and all explicitly set `export const runtime = "nodejs"`. They wrap the third-party `next-passkey-webauthn` package (its internal WebAuthn verification logic is outside this repo and was not independently verified by the discovery notes — only the OpsDesk-side wiring was). Session enforcement is via `resolvePasskeyUserId({ requestedUserId, requireSession })`: when a NextAuth session *does* exist, its `userId` must equal the requested `userId` regardless of the `requireSession` flag.

| Path | Method | Purpose | Auth | Details |
|---|---|---|---|---|
| `/api/auth/passkey/lookup` | POST | Given `{ email }`, resolve the matching Supabase auth user id and report whether a `passkeys` row exists for them. | Public (pre-login) | Used to decide whether to show "Continue with Passkey" on the login page. No rate limiting was found in the code for this endpoint. |
| `/api/passkey/register/start` | POST | Begin a WebAuthn registration ceremony (`next-passkey-webauthn`'s `startRegistration`). | Session required | Strips `authenticatorAttachment` and adds `hints: ["hybrid","client-device","security-key"]` to support cross-device flows. |
| `/api/passkey/register/finish` | POST | Complete registration, persisting the credential. | Session required | Returns 200 if `result.verified`, else 400. |
| `/api/passkey/authenticate/start` | POST | Begin a WebAuthn authentication ceremony. | `requireSession: false` (pre-login) — but if a session *does* exist, its `userId` must match the requested `userId` | `userVerification` defaults to `"preferred"`. No rate limiting found. |
| `/api/passkey/authenticate/finish` | POST | Complete authentication; on success, mints a short-lived `assertionToken` JWT (5-minute expiry) used to complete NextAuth's `passkey-assertion` provider sign-in. | `requireSession: false` | No rate limiting found — an anonymous caller can request start/finish for any `userId` value. |
| `/api/passkey/list` | POST | List the caller's own registered passkeys. | Session required | |
| `/api/passkey/delete` | POST | Delete a passkey by `credentialId`. | Session required | |

---

## Me / Profile / Account

Staff self-service: profile data, password/email/MFA-flag changes, account deletion, and organization switching/creation. All under `/api/me/**`.

| Path | Method | Purpose | Auth | Details |
|---|---|---|---|---|
| `/api/me` | GET | Return the current user, their organizations, resolved active org, membership-access summary, unread notification count, and org-creation eligibility flags. | Session | Auto-provisions a `users` row on first call if missing. As a side effect, this GET call itself sets or clears the `opsdesk_active_org_id` cookie based on the resolved active org — calling it can silently reassign the active-org cookie. |
| `/api/me/profile` | GET | Read the current user's profile (name/email/phone/title/department/bio/timezone/MFA flag) from `user_metadata`. | Session | |
| `/api/me/profile` | PATCH | Update profile fields, including `newPassword` (min 8 chars) and `multiStepAuthEnabled`. | Session | Writes to both Supabase Auth `user_metadata` and the `users` table. Returns 409 on duplicate-email conflicts. |
| `/api/me/account` | DELETE | Full account deletion/anonymization. | Session | Requires the literal confirmation string `"DELETE"` and the account's own email (case-insensitive). Blocks deletion (409) if the caller is the sole active admin of any organization. Anonymizes the `users` row and deletes the Supabase auth user. |
| `/api/me/active-organization` | POST | Switch the active organization by setting the `opsdesk_active_org_id` cookie. | Session | Requires an **active** membership in the target org (403 otherwise, with a legacy fallback if the `status` column doesn't exist yet). |
| `/api/me/organizations` | POST | Create a new organization, either `from_scratch` (given a name) or `from_signup_company` (using the signup-time `user_metadata.company`, only if the user currently has zero memberships). | Session | Blocked entirely (403) for accounts created via team invite. Generates a unique slug, inserts the org, and adds the creator as `role: "admin"`. |

---

## Avatar

Two unrelated `/api/avatar*`-shaped routes exist — one is a placeholder-image generator, the other (under `/api/me/**`) is the real upload endpoint.

| Path | Method | Purpose | Auth | Details |
|---|---|---|---|---|
| `/api/avatar` | GET | Deterministic placeholder-avatar PNG generator (same input string → same generated image), backed by the third-party `facehash` npm package. **Not an upload endpoint.** | Public — no auth check was found in this 3-line route file | Query params (from the `facehash` library's own contract, not custom OpsDesk logic): `name`, `size`, `variant`, `showInitial`, `colors`. The discovery notes found no confirmed caller of this route anywhere in the app code outside `node_modules` — flagged as unverified/possibly-unused rather than asserted dead. |
| `/api/me/avatar` | POST | Upload an avatar image (multipart `file` field) to Supabase Storage and update `users.avatar_url` + auth `user_metadata.avatar_url`. | Session | Allowed types: JPEG/PNG/WEBP/GIF; max 2MB. Storage bucket: `SUPABASE_AVATAR_BUCKET` (default `"avatars"`). Deletes the previous avatar object afterward (best-effort, failure only logged). No GET/DELETE handler in this file. |

---

## Orgs (Team Membership)

The `/api/orgs/[orgId]/**` prefix hosts several distinct feature areas, each documented in its own domain section below (Invites, RBAC/Approvals, Audit, Reports). This section covers only the core team-roster read/manage routes.

| Path | Method | Purpose | Auth | Details |
|---|---|---|---|---|
| `/api/orgs/[orgId]/team` | GET | List all members (with role/status/joined date) and pending invites for the org, plus a computed `TeamPermissions` object (12 parallel non-approval RBAC probe calls for invite/member-role/status/remove permissions). | Session + org actor context | Any active member can read; the returned `permissions` object is what the client uses to conditionally show/hide management controls. |
| `/api/orgs/[orgId]/members/[membershipId]` | PATCH | Change a member's system `role` **or** `status` (exactly one of the two per call). | Session + org actor context + RBAC(`action.team.member.role.change` or `action.team.member.status.change`, both approval-flow eligible) + field-level role-assign check | Cannot demote/suspend the org's last active admin (400). Cannot suspend your own membership (400). Writes audit log `team.member.role_changed` / `team.member.suspended` / `team.member.reactivated`. |
| `/api/orgs/[orgId]/members/[membershipId]` | DELETE | Remove a member from the org. | Session + org actor context + RBAC(`action.team.member.remove`, approval-flow eligible) | Cannot remove yourself; cannot remove the last active admin. Writes audit log `team.member.removed`. |

---

## Invites

Two public, unauthenticated routes (invite lookup/acceptance, used before the invitee has an account) plus three org-scoped, session-gated management routes.

| Path | Method | Purpose | Auth | Details |
|---|---|---|---|---|
| `/api/invites/[token]` | GET | Look up a pending invite by its token (org name, role, expiry, inviter name) for the acceptance page. | Public | Token normalized/hashed (SHA-256) before lookup; 404 if not found/accepted/revoked, 410 if expired. |
| `/api/invites/[token]/accept` | POST | Create the invitee's Supabase Auth user + `users` row + `organization_memberships` row (with the invited role), and mark the invite accepted. | Public | Body: `{ firstName, lastName, password (min 6 chars) }`. On any post-account-creation failure, the just-created auth user is deleted to roll back. Does **not** itself set the active-org cookie — the client does that afterward via `POST /api/me/active-organization`. Writes audit log `team.invite.accepted`. |
| `/api/orgs/[orgId]/invites` | POST | Create a new invite and email it (Resend). | Session + org actor context + RBAC(`action.team.invite.create`, approval-flow eligible) + field-level `field.team.invite.role.{role}.assign` check | 7-day expiry, 32-byte random token (only its SHA-256 hash is stored — `organization_invites.token_hash` has no unique DB constraint). 409 if the email is already a member or already has a pending unexpired invite. Email-send failure auto-revokes the just-created invite and returns 502. |
| `/api/orgs/[orgId]/invites/[inviteId]` | DELETE | Revoke a pending invite. | Session + org actor context + RBAC(`action.team.invite.revoke`, approval-flow eligible) + field-level role check | 409 if already accepted; idempotent (200) if already revoked. |
| `/api/orgs/[orgId]/invites/[inviteId]/resend` | POST | Regenerate the invite's token/expiry and re-send the email. | Session + org actor context + RBAC(`action.team.invite.resend`, approval-flow eligible) + field-level role check | 60-second rate limit **enforced via an in-process `Map`** — not distributed, so it will not be effective across multiple server instances/replicas (flagged in the notes as a real limitation). |

---

## Tickets

| Path | Method | Purpose | Auth | Details |
|---|---|---|---|---|
| `/api/tickets` | GET | List org tickets, filterable by status/priority/assigneeId/assigneeRole/customerId/tagIds/createdFrom/createdTo/search; limit up to 500. | Session | Returns joined assignee/creator/customer plus the full org assignee roster. |
| `/api/tickets` | POST | Create a ticket. | Session | Auto-computes `sla_due_at` from the org's SLA policy if not supplied; inserts a `system` "Ticket created" message; runs the automation engine (`ticket.created`) and the SLA escalation sweep; notifies the assignee if one is set. |
| `/api/tickets/[id]` | GET | Full ticket detail: ticket row + all texts + all attachments + assignee roster. | Session | No DELETE endpoint exists for tickets. |
| `/api/tickets/[id]` | PATCH | Update title/description/status/priority/assigneeId/customerId/slaDueAt. | Session | Any status can move to any other (no enforced state machine). Setting `status: "closed"` stamps `closed_at`; moving away clears it. Every changed field appends a `system` timeline message. Cannot unlink a customer while the ticket is linked to an order. Runs the automation engine (`ticket.updated`) and the SLA escalation sweep afterward. Writes audit log entries for assignee/status/priority changes. |
| `/api/tickets/[id]/texts` | POST | Add a `comment` or `internal_note` (clients cannot create `system`-type entries). | Session | Notifies the ticket creator + assignee; resolves `@mention`s to notifications (only when exactly one org member's handle matches); logs a `chat`/`outbound` row to `customer_communications` if the ticket has a linked customer and the text is a `comment`; re-runs the SLA escalation sweep. |
| `/api/tickets/[id]/tags` | GET, PUT | Read / fully replace the tag assignments on one ticket (PUT deletes-then-reinserts the full set). | Session | The discovery notes found **no UI component anywhere in `app/**` that calls this endpoint** — flagged as an apparently unused/orphaned route rather than confirmed-dead code. |
| `/api/tickets/[id]/attachments` | POST | Upload a file attachment (raw body stream) to Vercel Blob, optionally linked to a specific `ticket_text_id`. | Session | Storage path `tickets/{orgId}/{ticketId}/{timestamp}-{sanitizedFilename}`, private access. No DELETE endpoint exists. |
| `/api/tickets/[id]/attachments/[attachmentId]` | GET | Stream/download a ticket attachment. | Session | Sets `Content-Disposition: attachment`. |

---

## Ticket Tags

| Path | Method | Purpose | Auth | Details |
|---|---|---|---|---|
| `/api/ticket-tags` | GET | List the org's tag catalog. | Session | |
| `/api/ticket-tags` | POST | Create a new tag (name + optional color). | Session | Unique per `(organization_id, name)` at the DB level. |

---

## Orders

| Path | Method | Purpose | Auth | Details |
|---|---|---|---|---|
| `/api/orders` | GET | List orders, filterable by status/paymentStatus/customerId/createdFrom/createdTo/search; limit configurable up to 1000 (default 200). | Session | |
| `/api/orders` | POST | Create an order (+ optional line items). | Session | Requires a valid `customerId` (must belong to the org) and 3-letter `currency`. Auto-generates `order_number` if omitted. `payment_status` is auto-derived from the initial `status`. If item insertion fails, the just-created order is deleted to roll back. Runs the automation engine (`order.created`). |
| `/api/orders/[id]` | GET | Order detail: order + items + attachments + status-event history. | Session | No DELETE endpoint exists for orders. |
| `/api/orders/[id]` | PATCH | Update status/notes/customerId/placedAt/paidAt/fulfilledAt/cancelledAt. | Session | Status changes auto-derive `payment_status` and stamp the corresponding timestamp; every status change inserts an `order_status_events` row and an audit log entry `order.status.changed`. Runs the automation engine (`order.updated`). |
| `/api/orders/[id]/items` | POST | Add a line item to an existing order. | Session | Increments the order's `subtotal_amount`/`total_amount` by the new item's total — does **not** adjust `tax_amount`/`discount_amount`, which the discovery notes flag as a possible (unconfirmed) risk to the DB's `total_amount = subtotal + tax - discount` check constraint. Rolls back the item insert if the totals update fails. |
| `/api/orders/[id]/attachments` | POST | Upload a file attachment to an order (mirrors the ticket-attachment route). | Session | Storage path `orders/{orgId}/{orderId}/{timestamp}-{filename}`, private access. No DELETE endpoint. |
| `/api/orders/[id]/attachments/[attachmentId]` | GET | Download an order attachment. | Session | |
| `/api/orders/[id]/payment-link` | POST | Create a Stripe Checkout session for the order and email the customer a payment link. | Session + RBAC(`action.billing.order.payment_link.send`, fallback allowed for admin/manager, approval-flow eligible) | `export const runtime = "nodejs"`. Rejects cancelled/refunded/already-paid orders and zero/negative totals. On email-send failure, forces `payment_status: "failed"` and returns 502. Writes audit log `order.payment_link.sent`. See the Stripe domain below for the webhook that later reconciles this. |

---

## Customers

| Path | Method | Purpose | Auth | Details |
|---|---|---|---|---|
| `/api/customers` | GET | List customers with computed rollups (`open_tickets_count`, `total_tickets_count`, `total_orders_count`, `total_revenue_amount`), filterable by status/createdFrom/createdTo/search; limit up to 1000 (default 200). | Session | Rollups are computed by pulling all of the org's tickets/orders into memory and aggregating in application code (no SQL `GROUP BY`) — a documented scaling characteristic, not a bug per se. |
| `/api/customers` | POST | Create a customer. | Session | Runs the automation engine (`customer.created`). |
| `/api/customers/[id]` | GET | Customer detail: tickets, orders, communications, org-wide recent incidents (not customer-specific — the `incidents` table has no `customer_id` column), and a merged activity timeline. | Session | No DELETE endpoint exists for customers. |
| `/api/customers/[id]` | PATCH | Update name/email/phone/status/externalId. | Session | Runs the automation engine (`customer.updated`). |

---

## Incidents

Also covers the public-status "services" catalog, which is distinct from the public status page itself (see Public/Status domain).

| Path | Method | Purpose | Auth | Details |
|---|---|---|---|---|
| `/api/incidents` | GET | List all services + incidents (with impacts/updates) for the org, the caller's role, and the org's slug/name (used to build the public status-page link). | Session | |
| `/api/incidents` | POST | Create an incident (+ optional service impacts + initial timeline update). | Session + RBAC(`action.incidents.create`, fallback allowed for admin/manager/support, approval-flow eligible) | Default impact level is derived from severity if not given. Recalculates affected services' `current_status`. Runs the automation engine (`incident.created`). |
| `/api/incidents/[id]` | PATCH | Update title/summary/severity/status/isPublic/serviceImpacts, optionally appending a timeline update. **No GET on this route** — detail comes from the `/api/incidents` list snapshot. | Session + RBAC(`action.incidents.update`, approval-flow eligible) | `serviceImpacts`, when provided, fully replaces the impact set (diffed against the existing set). Status change to `resolved` stamps `resolved_at`. Runs the automation engine (`incident.updated`). No DELETE on this route. |
| `/api/incidents/[id]/updates` | POST | Append a timeline update to an incident, optionally changing its status. | Session + RBAC(`action.incidents.timeline.update`, approval-flow eligible) | Requires at least a message or a status change. |
| `/api/incidents/services` | GET | List the org's status-page services. | Session | |
| `/api/incidents/services` | POST | Create a new service (auto-slugged). | Session + RBAC(`action.incidents.update`, approval-flow eligible) — per the RBAC-audit permission-key survey, service creation is gated on the same key as incident updates, not a distinct "services.manage" key | |
| `/api/incidents/services/[serviceId]` | PATCH, DELETE | Update (name/description/currentStatus/isPublic/displayOrder) or delete a service. | Session + RBAC(`action.incidents.update`, approval-flow eligible) | |

---

## Automation

| Path | Method | Purpose | Auth | Details |
|---|---|---|---|---|
| `/api/automation/rules` | GET | List automation rules for one entity type (`ticket`\|`order`\|`customer`\|`incident`\|`portal`), optionally including archived. | Session | Seeds a default rule for that org+entity type on first read if none exists yet (matched by rule name, so idempotent). |
| `/api/automation/rules` | PATCH | Bulk upsert a batch of rules for one entity type (create if no matching `id`, else update). | Session + RBAC(`action.automation.rules.manage`, fallback allowed for admin/manager, approval-flow eligible) | Validates trigger-event/entity-type compatibility and at least one valid action per rule. |
| `/api/automation/rules/[ruleId]` | PATCH | Toggle `isEnabled` and/or `archived` on one rule. | Session + RBAC(`action.automation.rules.manage`, approval-flow eligible) | Setting `archived: true` also forces `isEnabled: false`. |
| `/api/automation/rules/[ruleId]` | DELETE | Hard-delete one rule. | Session + RBAC(`action.automation.rules.delete`, approval-flow eligible) | |

The discovery notes fully read `lib/server/automation-engine.ts` for its type/entry-point structure but flagged that exact wiring/line numbers for the orders/customers/incidents call sites (as opposed to tickets/portal, which were directly confirmed) were verified only via grep, not a full line-by-line read.

---

## SLA

Distinct from the RBAC/automation permission-key system — these three routes use a **hardcoded** `admin`/`manager` role check instead, explicitly flagged in the notes as an inconsistency (SLA settings cannot be delegated to a custom role the way automation actions can).

| Path | Method | Purpose | Auth | Details |
|---|---|---|---|---|
| `/api/sla/policies` | GET | Return the org's SLA policies per priority (seeding hardcoded defaults on first read if none exist). | Session | |
| `/api/sla/policies` | PATCH | Upsert SLA policy fields (first-response/resolution/warning minutes, escalation role, auto-escalate flag) per priority. | Session + role check (admin/manager only) | Single upsert on `(organization_id, priority)`. |
| `/api/sla/compliance` | GET | Return SLA compliance rate + monthly trend over a date range (default 180 days, capped 365). | Session | |
| `/api/sla/run` | POST | Manually run the SLA escalation sweep across the whole org (or one ticket if `ticketId` is given). | Session + role check (admin/manager only) | There is **no scheduled/cron invocation** of this sweep anywhere in the repo besides this manual trigger and the automatic calls after ticket create/update/reply — the "Run Escalation" button in Settings → SLA is this route's only other UI entry point. |

---

## RBAC / Approvals

| Path | Method | Purpose | Auth | Details |
|---|---|---|---|---|
| `/api/orgs/[orgId]/rbac` | GET | Return custom roles + their permissions, all memberships + assigned users, approval policies, and a pending-approvals count. | Session + org actor context + RBAC(`action.rbac.manage` **or** `action.approvals.review`) | |
| `/api/orgs/[orgId]/rbac` | PATCH | Upsert/delete custom roles, reassign members' custom roles, and upsert approval policies (per permission key: enabled, min approvals, approver roles/custom-role ids). | Session + org actor context + RBAC(`action.rbac.manage`) | **Not** approval-flow gated on this endpoint itself. System roles (`is_system = true`, if any exist) cannot be edited/deleted. Writes audit log `rbac.settings.updated`. |
| `/api/orgs/[orgId]/approvals` | GET | List approval requests. `scope=inbox` (default) = requests the caller can approve; `scope=requested` = requests the caller filed themselves. | Session + org actor context; `scope=inbox` additionally requires RBAC(`action.approvals.review`) | Query params: `scope`, `status`, `limit`. |
| `/api/orgs/[orgId]/approvals/[requestId]` | POST | Approve or reject a pending approval request (`{ decision, comment? }`). | Session + org actor context + RBAC(`action.approvals.review`) | 403 if the caller filed the request themselves (no self-approval) or isn't an eligible approver for it. A single rejection is terminal; approval requires reaching `min_approvals` distinct approver decisions. |

---

## Audit

| Path | Method | Purpose | Auth | Details |
|---|---|---|---|---|
| `/api/orgs/[orgId]/audit-logs` | GET | Query the org's audit log with filters (`action`, `actorUserId`, `from`/`to` date range) and pagination (`page`, `limit`, default 25, capped 100). | Session + org actor context + RBAC(`action.audit.logs.view`) | Also returns `availableActions`/`availableActors` (drawn from the 400 most recent distinct values) to populate filter dropdowns. Degrades gracefully (drops extended columns) if the audit-log schema extension hasn't been applied yet. |

---

## Notifications

| Path | Method | Purpose | Auth | Details |
|---|---|---|---|---|
| `/api/notifications` | GET | List the caller's in-app notifications (`filter=all\|unread`, `types`, `limit` default 50 capped 200) plus an unread count. | Session | Optionally scoped to the active org (resolved from the `opsdesk_active_org_id` cookie via a locally re-implemented `resolveActiveOrgId()` helper, not `getTicketRequestContext()`). |
| `/api/notifications` | PATCH | Mark notifications read — a specific `ids[]` list, or all matching unread ones if omitted. | Session | |
| `/api/notifications/[id]` | PATCH | Mark a single notification read. | Session | Scoped only to the owning user (no explicit org filter, unlike the bulk PATCH above). |
| `/api/notifications/stream` | GET | Long-lived connection that pushes notification-count updates. | Session | `export const runtime = "nodejs"`, `dynamic = "force-dynamic"`. Despite the SSE framing, this is **server-side polling every 5 seconds** dressed as Server-Sent Events, not a genuine Postgres/Supabase realtime push — no LISTEN/NOTIFY or realtime subscription is used internally. Emits named events `notifications.snapshot`, `notifications.updated`, `notifications.error`; the snapshot payload is counts/metadata only (no notification body/title), so consumers must separately call `GET /api/notifications` for full content. |

---

## Communications

A customer-facing message log (`customer_communications`), separate from the internal `notifications` table. The discovery notes found no UI anywhere that lists/browses these rows — only the two write endpoints below exist in the reviewed API surface.

| Path | Method | Purpose | Auth | Details |
|---|---|---|---|---|
| `/api/communications/ingest` | POST | Record a communication (email/chat/whatsapp/sms, inbound/outbound) for an authenticated internal action. | Session | Resolves the target customer by id, email, or phone. Validates any linked ticket/order/incident belongs to the same customer/org. |
| `/api/communications/webhook/[channel]` | POST | Record one or more inbound/outbound communications from an external provider webhook. `[channel]` must be one of `email`, `chat`, `whatsapp`, `sms`. | Service secret — `COMMUNICATIONS_WEBHOOK_SECRET`, read from `x-webhook-secret`, `x-opsdesk-webhook-secret`, or an `Authorization: Bearer` header (checked in that order) | Fails closed with 500 if the env var isn't configured; 401 on mismatch. Comparison is a plain `!==` string check, not constant-time — flagged in the notes as a potential (unconfirmed-severity) timing side-channel. Accepts a single event or a `{ events: [...] }` batch; idempotent via a unique `(organization_id, provider, provider_message_id)` index — duplicate webhook redelivery is deduped, not double-inserted. Partial batch failures return 200 unless *every* event in the batch failed (then 400). |

---

## Reports

Covers both the interactive analytics endpoint and the scheduled-report data model. **There is no in-repo scheduler** — `POST /api/reports/schedules/run` does the actual work of computing and emailing reports, but nothing in the repository invokes it periodically (no `vercel.json`, no GitHub Actions, no cron script were found); an external cron caller must be wired up against it, or schedules will simply never fire despite showing a "Next run" time in the UI.

| Path | Method | Purpose | Auth | Details |
|---|---|---|---|---|
| `/api/reports` | GET | Compute executive analytics (response/resolution time, incident MTTR, a response-time-based CSAT proxy, first-contact-resolution rate, ticket backlog, SLA compliance, plus revenue/ticket-volume/customer-growth/SLA trend series) over a date range (default 180 days, capped 365). | Session | The discovery notes explicitly flag that this route performs **no RBAC permission check** at all, even though an `action.analytics.reports.view` key exists in the permission catalog — a documented gap between "this can be gated" and "this route actually gates it." Also persists metric snapshots to `analytics_metric_snapshots` (write-only from the code reviewed — no route reads them back). |
| `/api/reports/schedules/run` | POST | Find all due, enabled report schedules across **all** organizations, compute analytics for each, email every recipient, record a run row, and advance `next_run_at`. | Service secret — `REPORTS_SCHEDULER_SECRET`, via `Authorization: Bearer` or `x-scheduler-secret` header | 500 if the secret env var isn't configured; 401 on mismatch. `?limit=` query param (default 20, capped 100). Per-schedule failures are caught individually and recorded as a failed run without aborting the whole sweep. |
| `/api/orgs/[orgId]/reports/schedules` | GET | List the org's report schedules and its 30 most recent runs. | Session + org actor context + RBAC(`action.analytics.reports.schedule.manage`, fallback allowed admin/manager) | Not approval-flow gated (read-only). |
| `/api/orgs/[orgId]/reports/schedules` | POST | Create a new report schedule (name, frequency, compare-with, range, timezone, recipients). | Session + org actor context + RBAC(`action.analytics.reports.schedule.manage`, approval-flow eligible) | 409 on duplicate name within the org. Writes audit log `reports.schedule.created`. |
| `/api/orgs/[orgId]/reports/schedules/[scheduleId]` | PATCH | Partially update a schedule. | Session + org actor context + RBAC(`action.analytics.reports.schedule.manage`, approval-flow eligible) | If `frequency` changes without an explicit `nextRunAt`, recomputes it from the schedule's current `next_run_at`. Writes audit log `reports.schedule.updated`. |
| `/api/orgs/[orgId]/reports/schedules/[scheduleId]` | DELETE | Delete a schedule. | Session + org actor context + RBAC(`action.analytics.reports.schedule.manage`, approval-flow eligible) | Writes audit log `reports.schedule.deleted`. |

---

## Dashboard

| Path | Method | Purpose | Auth | Details |
|---|---|---|---|---|
| `/api/dashboard` | GET | Return home-dashboard KPIs (revenue, open tickets, SLA breaches, SLA compliance), a revenue trend chart, an SLA compliance trend, recent orders, and high-priority tickets, over a date range (default 30 days, capped 180). | Session | `openTicketsCount`/`slaBreachesCount` are current point-in-time counts, not date-range-scoped. |

---

## Search

| Path | Method | Purpose | Auth | Details |
|---|---|---|---|---|
| `/api/search` | GET | Global search (`?q=`, `?limit=` capped at 12, default 6) across tickets, customers, orders, and team members, scoped to the caller's active organization. | Session | Queries with `q` shorter than 2 characters short-circuit to an empty result. Team-member matches are additionally filtered to users with an active membership in the active org. The discovery notes did not find the client-side Ctrl/Cmd+K keybinding wiring within the files they were asked to read for this route — that lives in `Topbar.tsx`, documented separately in the frontend-architecture notes. |

---

## Saved Views

| Path | Method | Purpose | Auth | Details |
|---|---|---|---|---|
| `/api/saved-views` | GET | List saved views for one entity type (`tickets`\|`orders`\|`customers`) visible to the caller (their own personal views + any `team`-scoped views). | Session | Falls back to personal-only views if the `scope` column doesn't exist yet (legacy schema). |
| `/api/saved-views` | POST | Create a saved view. | Session | Creating a `team`-scoped view additionally requires the caller's role to be `admin` or `manager` (403 otherwise). |
| `/api/saved-views/[viewId]` | PATCH | Update name/filters/favorite flag/scope. | Session | Non-owners may only edit a `team`-scoped view, and only if they're admin/manager. |
| `/api/saved-views/[viewId]` | DELETE | Delete a saved view. | Session | Same ownership/scope rule as PATCH. |

---

## Portal (Customer Portal)

A fully separate, custom passwordless auth system for external customers — no NextAuth involvement. Session state lives in the `opsdesk_customer_portal` cookie (14-day expiry, single-use login-link tokens with a 20-minute expiry). A customer whose `status` becomes `blocked` is locked out immediately even with a still-valid session token.

| Path | Method | Purpose | Auth | Details |
|---|---|---|---|---|
| `/api/portal/auth/request-link` | POST | Request a magic sign-in link by email. | Public | Rate-limited (max 3 requests per email per 60 seconds, via a DB row count — silently returns the generic success message if exceeded, preventing enumeration). Blocked customers are excluded from matching. One link + email is sent per matching `(organization, customer)` pair if the email matches more than one org. |
| `/api/portal/auth/verify` | GET | Consume a magic-link `?token=`, create a portal session, set the session cookie, and redirect to `/portal`. | Public | Token is single-use (marked `used_at`) and must be exactly 64 lowercase hex characters. Redirects to `/portal/sign-in?error=...` on invalid/expired/blocked-customer cases. |
| `/api/portal/auth/logout` | POST | Revoke the current portal session and clear the cookie. | Customer-portal session (optional — clears the cookie regardless of whether a session was found) | |
| `/api/portal/overview` | GET | Return the signed-in customer's organization, profile, tickets (with latest-message-at + attachment counts), and orders. | Customer-portal session | |
| `/api/portal/tickets/[id]` | GET | One ticket's full detail: ticket row, texts, attachments, resolved authors/uploaders. | Customer-portal session | Scoped to `organization_id` + `customer_id` + `id` — a customer can only see their own tickets (404 otherwise). |
| `/api/portal/tickets/[id]/reply` | POST | Post a customer reply (prefixed `"[Customer Reply] "` in `ticket_texts`). | Customer-portal session | Notifies the ticket's creator/assignee + any `@mention`ed org users; logs an inbound `chat` row to `customer_communications`; fires the automation engine (`portal.ticket_replied`). |
| `/api/portal/tickets/[id]/attachments` | POST | Upload a file attachment to a ticket from the portal. | Customer-portal session | Streams to Vercel Blob; attributes `uploaded_by` to a synthetic portal-identity `users` row. |
| `/api/portal/tickets/[id]/attachments/[attachmentId]` | GET | Download/stream a specific attachment. | Customer-portal session | Verifies ticket ownership before streaming. |
| `/api/portal/orders/[id]/pay` | POST | Create a Stripe Checkout session for the order and return `{ checkoutUrl }` for a full-page redirect. | Customer-portal session | Same rejection rules as the staff payment-link route (cancelled/refunded/already-paid/zero-total). Redirects back to `/portal?tab=orders&paid=1&...` on success (distinct from the staff-initiated flow's `/payment/thank-you` redirect). Fires the automation engine (`portal.order_payment_started`). |

---

## Stripe

| Path | Method | Purpose | Auth | Details |
|---|---|---|---|---|
| `/api/stripe/webhook` | POST | Receive and process Stripe webhook events: `checkout.session.completed`, `checkout.session.expired`, `payment_intent.payment_failed`, `charge.refunded` (all other event types are no-ops). | Service — cryptographic signature verification via the `stripe-signature` header + `STRIPE_WEBHOOK_SECRET` (Stripe SDK's `webhooks.constructEvent`), not a static shared-secret string | `export const runtime = "nodejs"` (required to read the raw request body for signature verification). Updates `orders.payment_status`/`payment_completed_at`/`stripe_payment_intent_id` and inserts `order_status_events` rows as appropriate; writes audit log actions `order.payment.completed` / `.expired` / `.failed` / `.refunded`, each with `source: "stripe_webhook"` and no `actorUserId`. A handler throwing returns 500 for the whole request. |

---

## Public / Status

| Path | Method | Purpose | Auth | Details |
|---|---|---|---|---|
| `/api/public/status/[slug]` | GET | Return a public, filtered snapshot for an organization's status page: public services, public incidents (limit 50) with their public impacts/updates, and a computed overall status. | Public | Uses the service-role Supabase client directly (bypasses RLS) — any caller who knows (or guesses) an org's slug can read this data; the discovery notes found **no rate limiting** on this route. Non-public services/incidents/updates are silently excluded at every level, not returned as an error. The severity ranking used here (`operational < maintenance < degraded < partial_outage < major_outage`) is a **separate, independently-defined `HEALTH_RANK` constant** from the one used internally by `lib/server/incidents.ts` for the same enum (which instead ranks `maintenance` as the *most* severe state) — a verified, unresolved inconsistency between the public and internal status calculations, not a guess. |

---

## Verification notes / known gaps

These are carried forward from the discovery notes so this reference doesn't imply more certainty than was actually established:

- **Automation engine internals** (`lib/server/automation-engine.ts`): entry points, trigger-event names, and the exact call sites for tickets/portal were directly confirmed; the orders/customers/incidents call sites were confirmed to exist via grep but not verified line-by-line.
- **`lib/server/rbac.ts` internals**: the permission catalog, system-role allow/deny patterns, and the `authorizeRbacAction`/approval-flow control flow were read in detail; some downstream helper functions (e.g. `notifyApprovers`) were only read up to their call signature, not their exact notification `type`/copy.
- **`GET /api/tickets/[id]/tags`**: no UI caller was found anywhere in `app/**` — documented above as apparently unused rather than asserted dead code.
- **`GET /api/avatar`**: no confirmed caller was found in the app code, and the route file itself contains no visible auth check — documented as public/unverified-usage rather than guessed.
- **Communications domain**: no UI was found that reads/lists `customer_communications` rows — only the two write endpoints (`ingest`, `webhook/[channel]`) are part of the verified API surface.
- **`GET /api/reports`**: confirmed to skip the RBAC permission check that its own permission catalog defines for it (`action.analytics.reports.view`) — stated as an observed fact from reading the route, not an inference.
- **Report scheduling**: the *absence* of a cron/scheduler was established by exhaustively checking for `vercel.json`, `.github/workflows`, any `.yml`/`.yaml` file, and `package.json` scripts — not by finding an explicit "not implemented" comment.
- **`@vercel/blob` token wiring** (used by all ticket/order/portal attachment routes): no direct `process.env.BLOB_READ_WRITE_TOKEN` reference was found in the app's own source; the discovery notes did not open the `@vercel/blob` package's internals to confirm how it resolves its token, so this is flagged as inferred SDK convention, not directly verified repo code.
