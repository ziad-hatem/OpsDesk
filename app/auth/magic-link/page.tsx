"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, TriangleAlert } from "lucide-react";
import { signIn } from "next-auth/react";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { supabase } from "@/lib/supabase";

type CompletionState = {
  isLoading: boolean;
  error: string | null;
  requiresMfa: boolean;
  info: string | null;
  email: string | null;
};

type SignInResultWithCode = {
  error?: string | null;
  code?: string | null;
  url?: string | null;
};

type TokenPair = {
  accessToken: string;
  refreshToken: string;
};

function mapAuthError(errorMessage: string, code?: string | null): string {
  if (code === "account_suspended") {
    return "Your account is suspended. Contact your organization admin.";
  }
  if (code === "mfa_required") {
    return "Multi-step authentication is enabled. Enter your email verification code to continue.";
  }
  if (errorMessage === "CredentialsSignin") {
    return "Could not complete sign-in for this account.";
  }
  return errorMessage;
}

function readAuthErrorCode(result: { code?: string | null; url?: string | null }): string | null {
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

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

async function sendMfaCode(accessToken: string): Promise<{
  message?: string;
  email?: string | null;
}> {
  const response = await fetch("/api/auth/mfa/email/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ accessToken }),
  });

  const payload = (await response.json()) as {
    message?: string;
    email?: string | null;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(payload.error ?? "Failed to send verification code");
  }

  return payload;
}

async function verifyMfaCode(params: {
  accessToken: string;
  code: string;
}): Promise<string> {
  const response = await fetch("/api/auth/mfa/email/verify", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      accessToken: params.accessToken,
      code: params.code,
    }),
  });

  const payload = (await response.json()) as {
    verified?: boolean;
    mfaAssertion?: string;
    error?: string;
  };

  if (!response.ok || !payload.verified || !payload.mfaAssertion) {
    throw new Error(payload.error ?? "Failed to verify code");
  }

  return payload.mfaAssertion;
}

export default function MagicLinkCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<CompletionState>({
    isLoading: true,
    error: null,
    requiresMfa: false,
    info: null,
    email: null,
  });
  const [pendingTokens, setPendingTokens] = useState<TokenPair | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [isVerifyingMfa, setIsVerifyingMfa] = useState(false);
  const [isResendingMfa, setIsResendingMfa] = useState(false);

  const queryString = useMemo(() => searchParams.toString(), [searchParams]);

  useEffect(() => {
    let isMounted = true;

    async function completeLogin() {
      try {
        const params = new URLSearchParams(queryString);
        const code = params.get("code");

        let accessToken: string | null = null;
        let refreshToken: string | null = null;

        if (code) {
          const { data, error } = await supabase.auth.exchangeCodeForSession(code);
          if (error || !data.session?.access_token || !data.session.refresh_token) {
            throw new Error(error?.message ?? "Magic link code exchange failed");
          }
          accessToken = data.session.access_token;
          refreshToken = data.session.refresh_token;
        } else {
          const hash =
            typeof window !== "undefined" && window.location.hash.startsWith("#")
              ? window.location.hash.slice(1)
              : "";
          const hashParams = new URLSearchParams(hash);
          const accessFromHash = hashParams.get("access_token");
          const refreshFromHash = hashParams.get("refresh_token");

          if (accessFromHash && refreshFromHash) {
            const { data, error } = await supabase.auth.setSession({
              access_token: accessFromHash,
              refresh_token: refreshFromHash,
            });
            if (error || !data.session?.access_token || !data.session.refresh_token) {
              throw new Error(error?.message ?? "Failed to initialize auth session");
            }
            accessToken = data.session.access_token;
            refreshToken = data.session.refresh_token;
          } else {
            throw new Error("Missing authentication code in callback URL");
          }
        }

        const signInResult = (await signIn("supabase-token", {
          redirect: false,
          accessToken,
          refreshToken,
        })) as SignInResultWithCode | undefined;

        if (signInResult?.error) {
          const signInErrorCode = readAuthErrorCode(signInResult);
          if (signInErrorCode === "mfa_required") {
            const mfaResponse = await sendMfaCode(accessToken);

            if (!isMounted) {
              return;
            }

            setPendingTokens({
              accessToken,
              refreshToken,
            });
            setState({
              isLoading: false,
              error: null,
              requiresMfa: true,
              info: mfaResponse.message ?? "Verification code sent to your email.",
              email: mfaResponse.email ?? null,
            });
            return;
          }

          if (signInErrorCode === "account_suspended") {
            await supabase.auth.signOut();
          }

          throw new Error(
            mapAuthError(signInResult.error, signInErrorCode),
          );
        }

        router.replace("/");
      } catch (error: unknown) {
        if (!isMounted) {
          return;
        }
        setState({
          isLoading: false,
          error: getErrorMessage(error, "Could not complete magic link sign-in"),
          requiresMfa: false,
          info: null,
          email: null,
        });
      }
    }

    void completeLogin();

    return () => {
      isMounted = false;
    };
  }, [queryString, router]);

  const handleVerifyMfa = async () => {
    if (!pendingTokens) {
      setState((prev) => ({
        ...prev,
        error: "Authentication session is missing. Restart sign-in.",
      }));
      return;
    }

    const trimmedCode = mfaCode.trim();
    if (!/^\d{6}$/.test(trimmedCode)) {
      setState((prev) => ({
        ...prev,
        error: "Enter the 6-digit verification code from your email.",
      }));
      return;
    }

    setIsVerifyingMfa(true);
    setState((prev) => ({ ...prev, error: null }));

    try {
      const mfaAssertion = await verifyMfaCode({
        accessToken: pendingTokens.accessToken,
        code: trimmedCode,
      });

      const retryResult = (await signIn("supabase-token", {
        redirect: false,
        accessToken: pendingTokens.accessToken,
        refreshToken: pendingTokens.refreshToken,
        mfaAssertion,
      })) as SignInResultWithCode | undefined;

      if (retryResult?.error) {
        const retryCode = readAuthErrorCode(retryResult);
        if (retryCode === "account_suspended") {
          await supabase.auth.signOut();
        }
        throw new Error(mapAuthError(retryResult.error, retryCode));
      }

      router.replace("/");
    } catch (error: unknown) {
      setState((prev) => ({
        ...prev,
        error: getErrorMessage(error, "Failed to verify MFA code"),
      }));
    } finally {
      setIsVerifyingMfa(false);
    }
  };

  const handleResendMfa = async () => {
    if (!pendingTokens) {
      setState((prev) => ({
        ...prev,
        error: "Authentication session is missing. Restart sign-in.",
      }));
      return;
    }

    setIsResendingMfa(true);
    setState((prev) => ({ ...prev, error: null }));

    try {
      const response = await sendMfaCode(pendingTokens.accessToken);
      setState((prev) => ({
        ...prev,
        info: response.message ?? "Verification code sent to your email.",
        email: response.email ?? prev.email,
      }));
    } catch (error: unknown) {
      setState((prev) => ({
        ...prev,
        error: getErrorMessage(error, "Failed to resend verification code"),
      }));
    } finally {
      setIsResendingMfa(false);
    }
  };

  const handleBackToLogin = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  if (state.isLoading) {
    return (
      <div className="min-h-screen bg-muted/50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Signing You In</CardTitle>
            <CardDescription>Validating your magic link...</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center text-muted-foreground">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Completing login, please wait.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (state.requiresMfa) {
    return (
      <div className="min-h-screen bg-muted/50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Verify Your Sign-In</CardTitle>
            <CardDescription>
              Enter the 6-digit code sent to {state.email ?? "your email"}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {state.info ? <p className="text-sm text-muted-foreground">{state.info}</p> : null}
            {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}

            <div className="space-y-2">
              <Label htmlFor="mfa-code">Verification Code</Label>
              <Input
                id="mfa-code"
                value={mfaCode}
                onChange={(event) => setMfaCode(event.target.value)}
                placeholder="123456"
                maxLength={6}
                inputMode="numeric"
                autoComplete="one-time-code"
                disabled={isVerifyingMfa || isResendingMfa}
              />
            </div>

            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={handleVerifyMfa}
                disabled={isVerifyingMfa || isResendingMfa}
              >
                {isVerifyingMfa ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  "Verify and Continue"
                )}
              </Button>
              <Button
                variant="outline"
                onClick={handleResendMfa}
                disabled={isVerifyingMfa || isResendingMfa}
              >
                {isResendingMfa ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Sending...
                  </>
                ) : (
                  "Resend"
                )}
              </Button>
            </div>

            <Button
              variant="ghost"
              className="w-full"
              onClick={() => void handleBackToLogin()}
              disabled={isVerifyingMfa || isResendingMfa}
            >
              Back to Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TriangleAlert className="h-5 w-5 text-red-500" />
            Magic Link Failed
          </CardTitle>
          <CardDescription>
            {state.error ?? "The sign-in link is invalid or has expired."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-end">
          <Button onClick={() => router.replace("/login")}>Back to Login</Button>
        </CardContent>
      </Card>
    </div>
  );
}

