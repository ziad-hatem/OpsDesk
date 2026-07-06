# OpsDesk — case-study extraction summary

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
- **Screenshots captured live** against a local `next dev` instance on a dedicated port (3500 — port 3000 was already occupied by an unrelated project, left untouched): `hero-desktop.png` (1440×900) and `hero-mobile.png` (390×844) of `/login`, the only meaningful "landing" view for an unauthenticated visitor to this internal support console. The layout genuinely reflows to a clean single-column mobile card — no responsive breakage.
- **Lighthouse measured live, this session**, against the same dev-server instance used for the screenshots: **95 (desktop) / 68 (mobile)**. Note this is a large jump from an earlier same-week measurement of 76 — the desktop run this time followed a prior page visit (from screenshot capture), so it measured a warm Turbopack-compiled route rather than a cold first load. Neither number is from a production `next build`/`next start`.

## `_needsInput` punch list (for the portfolio owner)

1. `indexCode` — depends on ziadhatem.dev's existing case-study sequence.
2. `nextSlug`/`nextLabel` — depends on which other case study should follow this one.
3. `domain`/`liveUrl`/`liveCtaLabel` — no live deployment exists; decide whether the hero CTA points at GitHub or is hidden.
4. `sourceUrl` visibility — couldn't confirm via `gh` (not installed) whether the GitHub repo is public or private.
5. `shippedDate` semantics — currently the latest commit's month (2026-07); confirm this is right for an in-development project vs. using the first-commit month (2026-03).
6. `lighthouseScore` volatility — 95 desktop / 68 mobile this session, vs. 76 in an earlier session; both are real dev-server measurements under different cache-warmth conditions, neither is a production build. Re-run against `next build && next start` if a stable, publishable number is wanted.
7. Publishing the SECURITY.md-derived findings (RLS gaps, JWT fallback-secret reuse, missing rate limiting) — these are real and independently confirmed in code, but confirm they're acceptable to make public before this ships.

## Skipped / not applicable

- Nothing was skipped. The project has a browsable UI (screenshots captured), a reachable local instance (Lighthouse ran), and enough documentation/ADRs to ground every `architectureDecisions` entry in evidence rather than invention.
- No `technicalDecisions`/`clientRegister` fields were used — this is a solo flagship-style project, so `stackList`/`architectureDecisions`/`testing`/`retrospective` were used instead, per the extraction prompt's guidance.

## Deliverable contents

```
opsdesk/
  case-study.json
  SUMMARY.md
  screenshots/
    manifest.json
    hero-desktop.png
    hero-mobile.png
  lighthouse/
    desktop-report.json
    mobile-report.json
```
