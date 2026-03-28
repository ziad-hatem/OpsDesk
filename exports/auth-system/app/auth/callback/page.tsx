"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, TriangleAlert } from "lucide-react";
import { signIn } from "next-auth/react";
import { Button } from "@/app/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/card";
import { supabase } from "@/lib/supabase";

type SignInResultWithCode = {
  error?: string | null;
  code?: string | null;
  url?: string | null;
};

type AccountCheckResponse = {
  exists?: boolean;
  error?: string;
};

function readAuthErrorCode(result: {
  code?: string | null;
  url?: string | null;
}): string | null {
  if (result.code) {
    return result.code;
  }

  if (!result.url || typeof window === "undefined") {
    return null;
  }

  try {
    const parsedUrl = new URL(result.url, window.location.origin);
    return parsedUrl.searchParams.get("code");
  } catch {
    return null;
  }
}

export default function GoogleCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [isNewAccount, setIsNewAccount] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function completeLogin() {
      try {
        const isRegisterIntent = searchParams.get("intent") === "register";

        let accessToken: string | null = null;
        let refreshToken: string | null = null;

        // --- PKCE Flow: Supabase returns ?code= in the URL (default in newer versions) ---
        const code = searchParams.get("code");
        if (code) {
          const { data, error: exchangeError } =
            await supabase.auth.exchangeCodeForSession(code);

          if (
            exchangeError ||
            !data.session?.access_token ||
            !data.session.refresh_token
          ) {
            throw new Error(
              exchangeError?.message ??
                "Failed to exchange auth code for session",
            );
          }

          accessToken = data.session.access_token;
          refreshToken = data.session.refresh_token;
        }

        // --- Implicit Flow fallback: Supabase returns #access_token= in the hash ---
        if (!accessToken && typeof window !== "undefined") {
          const hash = window.location.hash.startsWith("#")
            ? window.location.hash.slice(1)
            : "";
          const hashParams = new URLSearchParams(hash);
          const accessFromHash = hashParams.get("access_token");
          const refreshFromHash = hashParams.get("refresh_token");

          if (accessFromHash && refreshFromHash) {
            const { data, error: sessionError } =
              await supabase.auth.setSession({
                access_token: accessFromHash,
                refresh_token: refreshFromHash,
              });

            if (
              sessionError ||
              !data.session?.access_token ||
              !data.session.refresh_token
            ) {
              throw new Error(
                sessionError?.message ?? "Failed to initialize auth session",
              );
            }

            accessToken = data.session.access_token;
            refreshToken = data.session.refresh_token;
          }
        }

        if (!accessToken || !refreshToken) {
          throw new Error(
            "Missing authentication tokens. Please try signing in again.",
          );
        }

        if (isRegisterIntent) {
          const { error: updateMetadataError } = await supabase.auth.updateUser({
            data: {
              registered_via_opsdesk: true,
            },
          });
          if (updateMetadataError) {
            console.error(
              `[auth/callback] failed to persist register marker: ${updateMetadataError.message}`,
            );
          }
        } else {
          const accountCheckResponse = await fetch("/api/auth/oauth/account-check", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ accessToken }),
          });
          const accountCheckPayload =
            (await accountCheckResponse.json()) as AccountCheckResponse;

          if (!accountCheckResponse.ok) {
            throw new Error(
              accountCheckPayload.error ??
                "Could not validate this Google account. Please try again.",
            );
          }

          if (!accountCheckPayload.exists) {
            await supabase.auth.signOut();
            if (!isMounted) return;
            setIsNewAccount(true);
            setError(
              "No OpsDesk account found for this Google email. Please sign up first.",
            );
            return;
          }
        }

        // Sync into NextAuth
        const signInResult = (await signIn("supabase-token", {
          redirect: false,
          accessToken,
          refreshToken,
        })) as SignInResultWithCode | undefined;

        if (signInResult?.error) {
          const signInErrorCode = readAuthErrorCode(signInResult);

          if (signInErrorCode === "account_suspended") {
            await supabase.auth.signOut();
            throw new Error(
              "Your account is suspended. Contact your organization admin.",
            );
          }

          // On register intent, new user might not have a membership yet — that's fine.
          // Redirect them to home anyway; they'll be prompted to join/create an org.
          if (isRegisterIntent) {
            if (!isMounted) return;
            router.replace("/");
            return;
          }

          throw new Error(
            "Could not complete sign-in. Please try again or contact support.",
          );
        }

        if (!isMounted) return;
        router.replace("/");
      } catch (err: unknown) {
        if (!isMounted) return;
        setError(
          err instanceof Error
            ? err.message
            : "An unexpected error occurred during sign-in.",
        );
      }
    }

    void completeLogin();

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="min-h-screen bg-muted/50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TriangleAlert className="h-5 w-5 text-red-500" />
              {isNewAccount ? "Account Not Found" : "Sign-In Failed"}
            </CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2 justify-end">
            {isNewAccount ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => router.replace("/login")}
                >
                  Back to Login
                </Button>
                <Button onClick={() => router.replace("/register")}>
                  Create Account
                </Button>
              </>
            ) : (
              <Button onClick={() => router.replace("/login")}>
                Back to Login
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Signing You In</CardTitle>
          <CardDescription>
            Completing Google sign-in, please wait...
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center text-muted-foreground">
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          Completing login, please wait.
        </CardContent>
      </Card>
    </div>
  );
}
