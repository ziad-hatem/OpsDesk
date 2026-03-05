import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { CredentialsSignin } from "next-auth";
import { supabase } from "./lib/supabase";
import { createSupabaseAdminClient } from "./lib/supabase-admin";
import { loadMembershipAccessSummary } from "./lib/server/membership-access";
import { verifyMfaAssertionToken } from "./lib/server/mfa-assertion";
import { verifyPasskeyAssertionToken } from "./lib/server/passkey-assertion";
import { normalizeAvatarUrl } from "./lib/avatar-url";

class InvalidCredentials extends CredentialsSignin {
  code = "Invalid email or password";
}

class SuspendedAccount extends CredentialsSignin {
  code = "account_suspended";
}

class MfaRequired extends CredentialsSignin {
  code = "mfa_required";
}

class InvalidPasskeyAssertion extends CredentialsSignin {
  code = "invalid_passkey_assertion";
}

function isMultiStepAuthEnabled(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") {
    return false;
  }

  return (metadata as Record<string, unknown>).multi_step_auth_enabled === true;
}

async function assertHasActiveMembership(userId: string): Promise<void> {
  const supabaseAdmin = createSupabaseAdminClient();
  const accessResult = await loadMembershipAccessSummary(supabaseAdmin, userId);

  if (accessResult.error) {
    console.error(
      `[auth] failed to load membership access summary for ${userId}: ${accessResult.error}`,
    );
    return;
  }

  if (accessResult.summary.hasOnlySuspendedMemberships) {
    throw new SuspendedAccount();
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const { data, error } = await supabase.auth.signInWithPassword({
          email: credentials.email as string,
          password: credentials.password as string,
        });

        if (error || !data.user) {
          throw new InvalidCredentials();
        }

        await assertHasActiveMembership(data.user.id);
        if (isMultiStepAuthEnabled(data.user.user_metadata)) {
          throw new MfaRequired();
        }

        const firstName = data.user.user_metadata?.first_name as
          | string
          | undefined;
        const lastName = data.user.user_metadata?.last_name as
          | string
          | undefined;
        const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

        return {
          id: data.user.id,
          email: data.user.email,
          name: fullName || null,
          image: normalizeAvatarUrl(data.user.user_metadata?.avatar_url),
        };
      },
    }),
    CredentialsProvider({
      id: "supabase-token",
      name: "Supabase Token",
      credentials: {
        accessToken: { label: "Access Token", type: "text" },
        mfaAssertion: { label: "MFA Assertion", type: "text" },
      },
      async authorize(credentials) {
        const accessToken =
          typeof credentials?.accessToken === "string"
            ? credentials.accessToken.trim()
            : "";
        const mfaAssertion =
          typeof credentials?.mfaAssertion === "string"
            ? credentials.mfaAssertion.trim()
            : "";
        if (!accessToken) {
          return null;
        }

        const { data, error } = await supabase.auth.getUser(accessToken);
        if (error || !data.user?.id || !data.user.email) {
          return null;
        }

        await assertHasActiveMembership(data.user.id);
        if (isMultiStepAuthEnabled(data.user.user_metadata)) {
          const isVerified = mfaAssertion
            ? verifyMfaAssertionToken({
                token: mfaAssertion,
                expectedUserId: data.user.id,
              })
            : false;
          if (!isVerified) {
            throw new MfaRequired();
          }
        }

        const firstName = data.user.user_metadata?.first_name as
          | string
          | undefined;
        const lastName = data.user.user_metadata?.last_name as
          | string
          | undefined;
        const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

        return {
          id: data.user.id,
          email: data.user.email,
          name: fullName || data.user.user_metadata?.name || null,
          image: normalizeAvatarUrl(data.user.user_metadata?.avatar_url),
        };
      },
    }),
    CredentialsProvider({
      id: "passkey-assertion",
      name: "Passkey Assertion",
      credentials: {
        assertionToken: { label: "Assertion Token", type: "text" },
      },
      async authorize(credentials) {
        const assertionToken =
          typeof credentials?.assertionToken === "string"
            ? credentials.assertionToken.trim()
            : "";
        if (!assertionToken) {
          return null;
        }

        const assertion = verifyPasskeyAssertionToken({
          token: assertionToken,
        });
        if (!assertion?.userId) {
          throw new InvalidPasskeyAssertion();
        }

        const supabaseAdmin = createSupabaseAdminClient();
        const { data: authUserResult, error: authUserError } =
          await supabaseAdmin.auth.admin.getUserById(assertion.userId);
        if (authUserError || !authUserResult.user?.email) {
          throw new InvalidPasskeyAssertion();
        }

        const authUser = authUserResult.user;
        await assertHasActiveMembership(authUser.id);

        const firstName = authUser.user_metadata?.first_name as
          | string
          | undefined;
        const lastName = authUser.user_metadata?.last_name as
          | string
          | undefined;
        const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

        return {
          id: authUser.id,
          email: authUser.email,
          name: fullName || authUser.user_metadata?.name || null,
          image: normalizeAvatarUrl(authUser.user_metadata?.avatar_url),
        };
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) {
        token.userId = user.id;
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.userId ?? token.sub ?? "";
      }

      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
});
