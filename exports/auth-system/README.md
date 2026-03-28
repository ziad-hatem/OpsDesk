# OpsDesk Auth Export

This folder is a portable snapshot of the core OpsDesk auth system so you can move it into another Next.js app.

## Included

- `auth.ts`
  NextAuth v5 config backed by Supabase.
- `app/api/auth/*`
  Registration, forgot-password, magic-link, OAuth account check, MFA email verification, and NextAuth handler routes.
- `app/api/passkey/*`
  Passkey register/authenticate/list/delete routes.
- `app/api/me/profile`, `app/api/me/avatar`, `app/api/me/account`
  Optional profile/account APIs for auth-adjacent settings screens.
- `app/(auth)/*`, `app/auth/callback`, `app/auth/magic-link`
  Login/register/forgot/reset/verify UI and callback pages.
- `app/emails/*`
  Verification, reset-password, magic-link, and MFA code email templates.
- `lib/*` and `types/*`
  Supabase clients, passkey helpers, MFA helpers, avatar normalization, and NextAuth type augmentation.
- `db/*`
  The SQL schema this auth system depends on.

## Features

- Email/password sign-in
- Google OAuth via Supabase Auth
- Passwordless magic-link sign-in
- Forgot-password and reset-password
- Email MFA step-up verification
- Passkeys with `next-passkey-webauthn`
- Optional profile/avatar/account-management APIs
- Membership gating via `organization_memberships`

## SQL Order

Apply these in this order:

1. `db/topbar-schema.sql`
2. `db/team-schema.sql`
3. `db/passkeys-schema.sql`
4. `db/mfa-email-schema.sql`

## Quick Start

1. Copy this folder's contents into the root of the target Next.js app.
2. Merge `package.auth.json` dependencies into the target app's `package.json`.
3. Add the env vars from `.env.example`.
4. Make sure the target app supports the `@/*` TypeScript path alias.
5. Merge `app/globals.css` tokens if the target app does not already use these shadcn/Tailwind v4 theme variables.
6. Run the SQL files listed above against your Supabase project.
7. Wrap your app with `SessionProvider` from `next-auth/react` if the destination app is not already doing that.

## Important Notes

- `auth.ts` checks `organization_memberships` and blocks users whose memberships are all suspended.
  If your destination app does not use org membership gating, remove the `assertHasActiveMembership(...)` calls from `auth.ts`.
- The included auth pages expect Tailwind v4 + the copied UI primitives under `app/components/ui`.
- `public/logo.webp` is included because the auth pages render it.
- If you render Google avatars with `next/image`, make sure your target `next.config.ts` allows `https://lh3.googleusercontent.com/**`.

## Not Included

- The current workspace-level profile page UI at `app/account/profile/page.tsx`
- App-wide route-protection logic from the OpsDesk shell/layout
- Redux/topbar integration from the main product

The APIs for profile/avatar/account are included, so you can build a lighter settings screen in the destination app without pulling the full OpsDesk shell.
