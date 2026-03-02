import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { CredentialsSignin } from "next-auth";
import { supabase } from "./lib/supabase";

class InvalidCredentials extends CredentialsSignin {
  code = "Invalid email or password";
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
          image:
            (data.user.user_metadata?.avatar_url as string | undefined) ?? null,
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
