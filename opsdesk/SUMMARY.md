# OpsDesk — case-study extraction summary

## Update: a live deployment exists (discovered this session)

The original draft assumed no live deployment existed (no `vercel.json` in the repo, README's "Missing Information" section explicitly claims no live/demo URL). That assumption was **wrong** — a follow-up request surfaced a live, working deployment at **https://ops-desk.ziadhatem.dev/**, reachable and fully functional with the test account `test@test.com`. This session:

- Confirmed the deployment is current with recent commits (the account-profile page from commit `98cd095` is live, at `/account/profile` — reached via the avatar dropdown menu, not a direct `/account` URL as the local file layout might suggest).
- Flipped `status` from `"in-development"` to `"production"`, set `domain`/`liveUrl` to the real values, and changed `liveCtaLabel` to "Visit live site".
- **Re-ran Lighthouse against the actual live production build** (not just the local dev server): **100 desktop / 96 mobile** — a large, expected jump over the 95/68 measured earlier the same week against an unminified `next dev` instance. Both sets of raw reports are kept (`lighthouse/live-*-report.json` for production, `lighthouse/*-report.json` for the dev-server comparison).
- Captured a full walkthrough of the live site per your request — see below.

This also raises the stakes on one thing already flagged: the RLS gaps, JWT fallback-secret reuse, and missing rate limiting documented in `docs/SECURITY.md` are no longer theoretical weaknesses in an undeployed repo — they're presumably live on a publicly reachable URL right now. Worth a look before pointing more traffic at it via a portfolio listing.

## Live-site screenshot walkthrough (this request)

Captured against **https://ops-desk.ziadhatem.dev/** (not local dev), logged in as `test@test.com`, at three breakpoints — **1440px desktop, 767px tablet, 375px mobile** — with the browser at 100% zoom (Playwright's default, no OS-level zoom applied):

- **20 pages/flows × 3 breakpoints = 60 full-page screenshots**, saved under `screenshots/live/` with `manifest.json` describing each one: login (logged out), dashboard, notifications, tickets list + detail, orders list + detail, customers list + detail, incidents, the public status page (`/status/test-workspace`, no auth needed), reports, calendar, all 5 settings tabs (team/roles/SLA/automation/activity), account profile, and help.
- Confirmed the layout is genuinely responsive at all three breakpoints — the sidebar collapses, KPI cards restack to single-column, and the workspace switcher truncates its label on narrower widths. No broken/overflowing layouts found at any breakpoint.
- Two "detail" pages needed a fix mid-run: clicking a ticket/order/customer table row doesn't do anything by itself — the row's ID cell renders a `<button>` that has to be clicked directly (confirmed via the underlying `/api/tickets/[id]` request firing only on that click), not the row or its outer `<td>`. Once corrected, all three detail views captured correctly.
- The notifications bell doesn't open a small overlay dropdown — it navigates to a dedicated full-page `/notifications`-style view. Captured as a normal full-page shot, not a floating-panel screenshot.
- The account/profile page isn't at a direct `/account` URL (that 404s) — it's `/account/profile`, only discoverable via the avatar's dropdown menu ("Profile" item). Confirmed and corrected.
- The 20 hero-style images (`hero-desktop.png`/`hero-mobile.png` in `screenshots/`, used by the case-study JSON's required hero shots) were **replaced** with the live-site login captures, since you asked for live, not local-dev, screenshots. Dimensions: 1440×900 desktop, 375×812 mobile (this supersedes the generic 390×844 placeholder from the original extraction spec, since your instruction specified 375px).
- All data visible in every screenshot (ticket titles, revenue figures, customer names) belongs to the seeded "Test Workspace" test account — synthetic, not real customer data.
- The reusable capture script is saved at `scripts/capture-live-screenshots.cjs` (Playwright, logs in and walks all 20 pages/flows at a given breakpoint) so this can be re-run after future deploys.

## What's solid

- **Solo project, 25 commits.** One author (`Ziad Hatem` / `ziad-hatem`, same email, two casing variants), first commit 2026-03-02, most recent 2026-07-06.
- **Stack, tests, CI, and RLS/table counts were independently re-verified this session** (not just carried over from a prior draft) by three parallel read-only checks against the live repo:
  - Unit/component/e2e test counts (39/22/12) reproduced exactly by actually running `npm run test:unit` / `npm run test:components`. Found one nuance the original draft compressed: the 7 failing component tests split into **two distinct causes**, not one — 1 fails on stale "Google sign-in (coming soon)" copy, the other 6 (all of `login-page.test.tsx`) fail because the page now calls `useSearchParams()` and the test's router mock doesn't provide it. Both causes are already documented separately in `docs/TESTING.md`; the case-study text has been tightened to say so.
  - No CI/CD config anywhere (`.github/`, `vercel.json`, `Dockerfile`, `netlify.toml` all absent) — confirmed.
  - Row Level Security: exactly 3 of 44 tables (`passkeys`, `passkey_challenges`, `email_mfa_challenges`) — confirmed by grepping `db/*.sql`.
  - All 5 `architectureDecisions` trade-offs are fully and specifically grounded in `docs/DECISIONS.md`'s ADR-001/002/003/004/007, with several clauses matching near-verbatim — no exaggeration found.
  - Both cited security weaknesses (JWT fallback-secret reuse in `lib/server/{passkey-assertion,mfa-assertion,mfa-email-auth}.ts`; no rate limiting on 4 pre-login endpoints) were confirmed directly in the route/lib source, not just from `docs/SECURITY.md`'s own claims.
  - Full `stackList` cross-checked against `package.json` — every entry is a real dependency, nothing major is missing.
  - The a11y claim (6 enabled `jsx-a11y` rules, 8 files with real ARIA attributes) reproduces exactly with the stricter grep pattern the draft's own evidence field specifies; a naive plain-substring grep returns 19 files because it also catches Tailwind `aria-invalid:`/`aria-selected:` variant-selector classes, not real attributes — worth knowing if anyone re-checks this by hand.
## `_needsInput` punch list (for the portfolio owner)

1. `indexCode` — depends on ziadhatem.dev's existing case-study sequence.
2. `nextSlug`/`nextLabel` — depends on which other case study should follow this one.
3. `sourceUrl` visibility — couldn't confirm via `gh` (not installed) whether the GitHub repo is public or private.
4. `status`/`shippedDate` semantics — flipped to `"production"` now that a live deployment is confirmed; `shippedDate` still uses the latest commit's month (2026-07) since the actual first-deploy date isn't recorded anywhere in-repo.
5. Publishing the SECURITY.md-derived findings — now higher-stakes since the app is live and publicly reachable with these same gaps presumably present.
6. Whether the seeded `test@test.com` test account should stay reachable/public long-term, now that ~60 screenshots of it are part of this deliverable.

## Skipped / not applicable

- Nothing was skipped. The project has a browsable UI (screenshots captured against both local dev and the live site), a reachable live instance (Lighthouse ran against both), and enough documentation/ADRs to ground every `architectureDecisions` entry in evidence rather than invention.
- No `technicalDecisions`/`clientRegister` fields were used — this is a solo flagship-style project, so `stackList`/`architectureDecisions`/`testing`/`retrospective` were used instead, per the extraction prompt's guidance.

## Deliverable contents

```
opsdesk/
  case-study.json
  SUMMARY.md
  screenshots/
    manifest.json
    hero-desktop.png       (live-site login, desktop 1440x900)
    hero-mobile.png        (live-site login, mobile 375x812)
    live/
      manifest.json
      01-login-{desktop-1440,tablet-767,mobile-375}.png
      02-dashboard-...      (20 pages x 3 breakpoints = 60 files total)
      ...
  lighthouse/
    desktop-report.json        (local dev server, for comparison)
    mobile-report.json         (local dev server, for comparison)
    live-desktop-report.json   (live production site — score used in case-study.json)
    live-mobile-report.json    (live production site)
  scripts/
    capture-live-screenshots.cjs   (reusable: node capture-live-screenshots.cjs <desktop|tablet|mobile>)
```
