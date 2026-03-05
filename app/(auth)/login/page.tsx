"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  Loader2,
  Mail,
  ShieldCheck,
} from "lucide-react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { toast } from "sonner";
import { useAuthenticatePasskey } from "next-passkey-webauthn/client";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "../../components/ui/input-otp";
import { hasVerifiedQuery, mapLoginError } from "./login-flow";
import { passkeyEndpoints } from "@/lib/passkey-endpoints";
import { supabase } from "@/lib/supabase";

type SignInResultWithCode = {
  error?: string | null;
  code?: string | null;
  url?: string | null;
};

type PasskeyAuthenticateResult = {
  verified: boolean;
  assertionToken?: string | null;
};

type MfaSendResponse = {
  message?: string;
  email?: string | null;
  error?: string;
};

type MfaVerifyResponse = {
  verified?: boolean;
  mfaAssertion?: string;
  error?: string;
};

type PasskeyLookupResponse = {
  hasPasskey?: boolean;
  userId?: string | null;
};

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function isEmailFormat(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isMultiStepAuthEnabled(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") {
    return false;
  }

  return (metadata as Record<string, unknown>).multi_step_auth_enabled === true;
}

function mapPasswordSignInError(error: unknown): string {
  const raw = error instanceof Error ? error.message : "Failed to sign in";
  const normalized = raw.toLowerCase();

  if (normalized.includes("invalid login credentials")) {
    return mapLoginError("CredentialsSignin");
  }

  if (normalized.includes("email not confirmed")) {
    return "Please verify your email address before signing in.";
  }

  return raw;
}

function readAuthErrorCode(
  result: SignInResultWithCode | undefined,
): string | null {
  if (result?.code) {
    return result.code;
  }

  if (!result?.url || typeof window === "undefined") {
    return null;
  }

  try {
    const parsedUrl = new URL(result.url, window.location.origin);
    return parsedUrl.searchParams.get("code");
  } catch {
    return null;
  }
}

function mapPasskeyRuntimeError(error: unknown): string {
  const raw =
    error instanceof Error ? error.message : "Failed to sign in with passkey";
  const normalized = raw.toLowerCase();

  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "Passkeys require HTTPS (or localhost). On phone, open your HTTPS domain, not a plain HTTP URL.";
  }

  if (normalized.includes("not supported")) {
    return "This browser/device cannot use passkeys for this site. Update browser and ensure HTTPS.";
  }

  if (normalized.includes("credential not found")) {
    return "No matching passkey was found for this email. Confirm the email or use password/magic link.";
  }

  return raw;
}

async function sendMfaCode(accessToken: string): Promise<MfaSendResponse> {
  const response = await fetch("/api/auth/mfa/email/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ accessToken }),
  });

  const payload = (await response.json()) as MfaSendResponse;
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

  const payload = (await response.json()) as MfaVerifyResponse;
  if (!response.ok || !payload.verified || !payload.mfaAssertion) {
    throw new Error(payload.error ?? "Failed to verify code");
  }

  return payload.mfaAssertion;
}

export default function Page() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [isSendingMagicLink, setIsSendingMagicLink] = useState(false);
  const [isSigningInWithPasskey, setIsSigningInWithPasskey] = useState(false);
  const [isCheckingPasskey, setIsCheckingPasskey] = useState(false);
  const [hasRegisteredPasskey, setHasRegisteredPasskey] = useState(false);
  const [passkeyUserId, setPasskeyUserId] = useState<string | null>(null);
  const [passkeyLookupEmail, setPasskeyLookupEmail] = useState<string>("");
  const [isSendingMfaCode, setIsSendingMfaCode] = useState(false);
  const [isVerifyingMfaCode, setIsVerifyingMfaCode] = useState(false);
  const [requiresMfa, setRequiresMfa] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaTargetEmail, setMfaTargetEmail] = useState<string | null>(null);
  const [mfaInfo, setMfaInfo] = useState("");
  const [magicLinkTargetEmail, setMagicLinkTargetEmail] = useState<
    string | null
  >(null);
  const [magicLinkInfo, setMagicLinkInfo] = useState("");
  const [error, setError] = useState("");
  const [isVerified, setIsVerified] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const { authenticate: authenticatePasskey } = useAuthenticatePasskey({
    endpoints: passkeyEndpoints,
  });
  const normalizedEmail = normalizeEmail(email);
  const hasValidEmail = isEmailFormat(normalizedEmail);

  const disableLoginActions =
    loading ||
    isSendingMagicLink ||
    isSigningInWithPasskey ||
    isSendingMfaCode ||
    isVerifyingMfaCode;
  const mfaBusy = isSendingMfaCode || isVerifyingMfaCode;

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      hasVerifiedQuery(window.location.search)
    ) {
      setIsVerified(true);
    }
  }, []);

  useEffect(() => {
    const prefilledEmail = searchParams.get("email");
    if (prefilledEmail) {
      setEmail(prefilledEmail);
    }
  }, [searchParams]);

  useEffect(() => {
    const errorCode = searchParams.get("error");
    if (errorCode === "account_suspended") {
      setError(mapLoginError("CredentialsSignin", "account_suspended"));
    }
  }, [searchParams]);

  useEffect(() => {
    setHasRegisteredPasskey(false);
    setPasskeyUserId(null);
    setPasskeyLookupEmail("");

    if (!hasValidEmail) {
      setIsCheckingPasskey(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setIsCheckingPasskey(true);
      try {
        const response = await fetch("/api/auth/passkey/lookup", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email: normalizedEmail }),
          signal: controller.signal,
        });

        const payload = (await response.json()) as PasskeyLookupResponse;
        const discoveredUserId =
          typeof payload.userId === "string" ? payload.userId.trim() : "";
        const available =
          response.ok &&
          payload.hasPasskey === true &&
          discoveredUserId.length > 0;

        setHasRegisteredPasskey(available);
        setPasskeyUserId(available ? discoveredUserId : null);
        setPasskeyLookupEmail(normalizedEmail);
      } catch (lookupError: unknown) {
        if (lookupError instanceof Error && lookupError.name === "AbortError") {
          return;
        }
        setHasRegisteredPasskey(false);
        setPasskeyUserId(null);
        setPasskeyLookupEmail("");
      } finally {
        setIsCheckingPasskey(false);
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
      setIsCheckingPasskey(false);
    };
  }, [hasValidEmail, normalizedEmail]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isVerified && countdown > 0) {
      timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    } else if (isVerified && countdown === 0) {
      setIsVerified(false);
      router.replace("/login");
    }
    return () => clearTimeout(timer);
  }, [isVerified, countdown, router]);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_IN" && session) {
        if (
          typeof window !== "undefined" &&
          window.location.hash.includes("access_token")
        ) {
          setLoading(true);
          try {
            await finalizeSessionSignIn();
            toast.success("Logged in successfully");
            router.push("/");
          } catch (err: unknown) {
            const message =
              err instanceof Error ? err.message : "Failed to sign in";
            setError(message);
            toast.error(message);
            setLoading(false);
          }
        }
      }
    });

    return () => {
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const runPasskeyChallenge = async (userId: string): Promise<string> => {
    if (typeof window === "undefined" || !("PublicKeyCredential" in window)) {
      throw new Error("Passkeys are not supported in this browser");
    }
    if (!window.isSecureContext) {
      throw new Error(
        "Passkeys require HTTPS (or localhost). On phone, use your HTTPS domain.",
      );
    }

    const result = (await authenticatePasskey(
      userId,
    )) as PasskeyAuthenticateResult;
    if (!result.verified || !result.assertionToken) {
      throw new Error("Passkey authentication was not verified.");
    }

    return result.assertionToken;
  };

  const getSessionTokens = async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    const refreshToken = sessionData.session?.refresh_token;
    if (!accessToken || !refreshToken) {
      throw new Error(
        "Authentication session is missing. Please sign in again.",
      );
    }

    return { accessToken, refreshToken };
  };

  const finalizeSessionSignIn = async (params?: { mfaAssertion?: string }) => {
    const { accessToken, refreshToken } = await getSessionTokens();
    const nextAuthResult = (await signIn("supabase-token", {
      redirect: false,
      accessToken,
      refreshToken,
      mfaAssertion: params?.mfaAssertion,
    })) as SignInResultWithCode | undefined;

    if (nextAuthResult?.error) {
      const errorCode = readAuthErrorCode(nextAuthResult);
      if (errorCode === "account_suspended") {
        await supabase.auth.signOut();
      }
      throw new Error(mapLoginError(nextAuthResult.error, errorCode));
    }
  };

  const startMfaStep = async (fallbackEmail: string) => {
    setIsSendingMfaCode(true);
    try {
      const { accessToken } = await getSessionTokens();
      const response = await sendMfaCode(accessToken);
      setRequiresMfa(true);
      setMfaCode("");
      setMfaTargetEmail(response.email ?? fallbackEmail);
      setMfaInfo(response.message ?? "Verification code sent to your email.");
      toast.success("Verification code sent to your email.");
    } finally {
      setIsSendingMfaCode(false);
    }
  };

  const handlePasswordSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const nextEmail = normalizeEmail(email);
      const { data, error: supabaseError } =
        await supabase.auth.signInWithPassword({
          email: nextEmail,
          password,
        });

      if (supabaseError || !data.user) {
        throw new Error(mapPasswordSignInError(supabaseError));
      }

      if (isMultiStepAuthEnabled(data.user.user_metadata)) {
        await startMfaStep(nextEmail);
        return;
      }

      await finalizeSessionSignIn();
      toast.success("Logged in successfully");
      router.push("/");
    } catch (submitError: unknown) {
      const message =
        submitError instanceof Error
          ? submitError.message
          : "Failed to sign in";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyMfaCode = async () => {
    const trimmedCode = mfaCode.trim();
    if (!/^\d{6}$/.test(trimmedCode)) {
      setError("Enter the 6-digit verification code from your email.");
      return;
    }

    setError("");
    setIsVerifyingMfaCode(true);

    try {
      const { accessToken } = await getSessionTokens();
      const mfaAssertion = await verifyMfaCode({
        accessToken,
        code: trimmedCode,
      });

      await finalizeSessionSignIn({ mfaAssertion });
      toast.success("Signed in with multi-step authentication");
      router.push("/");
    } catch (verifyError: unknown) {
      const message =
        verifyError instanceof Error
          ? verifyError.message
          : "Failed to verify code";
      setError(message);
      toast.error(message);
    } finally {
      setIsVerifyingMfaCode(false);
    }
  };

  const handleResendMfaCode = async () => {
    setError("");
    setIsSendingMfaCode(true);

    try {
      const { accessToken } = await getSessionTokens();
      const response = await sendMfaCode(accessToken);
      setMfaTargetEmail((previous) => response.email ?? previous);
      setMfaInfo(response.message ?? "Verification code sent to your email.");
      toast.success("Verification code resent.");
    } catch (resendError: unknown) {
      const message =
        resendError instanceof Error
          ? resendError.message
          : "Failed to resend verification code";
      setError(message);
      toast.error(message);
    } finally {
      setIsSendingMfaCode(false);
    }
  };

  const handleCancelMfa = async () => {
    await supabase.auth.signOut();
    setRequiresMfa(false);
    setMfaCode("");
    setMfaInfo("");
    setMfaTargetEmail(null);
    setPassword("");
    setError("");
  };

  const handleGoogleSignIn = async () => {
    setError("");
    setLoading(true);
    try {
      const { error: supabaseError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/login`,
        },
      });

      if (supabaseError) {
        throw new Error(supabaseError.message);
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to sign in with Google";
      setError(message);
      toast.error(message);
      setLoading(false);
    }
  };

  const handleSendMagicLink = async () => {
    const nextEmail = normalizeEmail(email);
    if (!nextEmail) {
      setError("Enter your email to receive a magic link");
      return;
    }

    if (!isEmailFormat(nextEmail)) {
      setError("Enter a valid email address to receive a magic link");
      return;
    }

    setError("");
    setIsSendingMagicLink(true);

    try {
      const response = await fetch("/api/auth/passwordless/magic-link", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: nextEmail }),
      });

      const data = (await response.json()) as {
        message?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to send magic link");
      }

      const successMessage =
        data.message ?? "Check your email for a sign-in link.";
      setMagicLinkTargetEmail(nextEmail);
      setMagicLinkInfo(successMessage);
      toast.success(successMessage);
    } catch (sendError: unknown) {
      const message =
        sendError instanceof Error
          ? sendError.message
          : "Failed to send magic link";
      setError(message);
      toast.error(message);
    } finally {
      setIsSendingMagicLink(false);
    }
  };

  const handlePasskeySignIn = async () => {
    setError("");

    if (!hasValidEmail) {
      setError("Enter a valid email to continue with passkey.");
      return;
    }

    if (isCheckingPasskey) {
      setError("Checking passkey availability. Try again in a moment.");
      return;
    }

    if (passkeyLookupEmail !== normalizedEmail) {
      setError("Checking passkey availability. Try again in a moment.");
      return;
    }

    if (!hasRegisteredPasskey || !passkeyUserId) {
      setError("No registered passkey was found for this email.");
      return;
    }

    if (typeof window === "undefined" || !("PublicKeyCredential" in window)) {
      setError("Passkeys are not supported in this browser");
      return;
    }
    if (!window.isSecureContext) {
      setError(
        "Passkeys require HTTPS (or localhost). On phone, use your HTTPS domain.",
      );
      return;
    }

    setIsSigningInWithPasskey(true);

    try {
      const assertionToken = await runPasskeyChallenge(passkeyUserId);
      const result = (await signIn("passkey-assertion", {
        redirect: false,
        assertionToken,
      })) as SignInResultWithCode | undefined;

      if (result?.error) {
        throw new Error(mapLoginError(result.error, readAuthErrorCode(result)));
      }

      toast.success("Signed in with passkey");
      router.push("/");
    } catch (passkeyError: unknown) {
      const message = mapPasskeyRuntimeError(passkeyError);
      setError(message);
      toast.error(message);
    } finally {
      setIsSigningInWithPasskey(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-muted/40 to-background px-4 py-8 flex items-center justify-center">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-3">
          <div className="relative h-11 w-11 overflow-hidden rounded-xl border border-border bg-background">
            <Image
              src="/logo.webp"
              alt="OpsDesk logo"
              fill
              className="object-cover"
              sizes="44px"
              priority
            />
          </div>
          <div>
            <p className="text-lg font-semibold text-foreground">OpsDesk</p>
            <p className="text-xs text-muted-foreground">OpsDesk Access</p>
          </div>
        </div>
        <Card className="border-border/70 bg-card/95 shadow-xl dark:bg-secondary/60">
          {isVerified ? (
            <div className="flex flex-col items-center justify-center p-8 text-center">
              <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                <CheckCircle2 className="h-8 w-8" />
              </div>
              <CardTitle className="text-xl">Email Verified</CardTitle>
              <CardDescription className="mt-2">
                Your email is confirmed. Redirecting to login in {countdown}s.
              </CardDescription>
              <Button
                variant="outline"
                className="mt-6 w-full"
                onClick={() => {
                  setIsVerified(false);
                  router.replace("/login");
                }}
              >
                Continue to Login
              </Button>
            </div>
          ) : requiresMfa ? (
            <>
              <CardHeader className="space-y-3">
                <div className="inline-flex w-fit items-center gap-1 rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs font-medium text-foreground">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Step 2 of 2
                </div>
                <CardTitle>Verify Your Sign-In</CardTitle>
                <CardDescription>
                  Enter the code sent to {mfaTargetEmail ?? "your email"}.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {error ? (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}

                {mfaInfo ? (
                  <p className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                    {mfaInfo}
                  </p>
                ) : null}

                <div className="space-y-2">
                  <Label htmlFor="mfa-code">Verification code</Label>
                  <InputOTP
                    id="mfa-code"
                    maxLength={6}
                    value={mfaCode}
                    onChange={(value) =>
                      setMfaCode(value.replace(/\D/g, "").slice(0, 6))
                    }
                    containerClassName="justify-center"
                    disabled={mfaBusy}
                  >
                    <InputOTPGroup>
                      <InputOTPSlot index={0} />
                      <InputOTPSlot index={1} />
                      <InputOTPSlot index={2} />
                      <InputOTPSlot index={3} />
                      <InputOTPSlot index={4} />
                      <InputOTPSlot index={5} />
                    </InputOTPGroup>
                  </InputOTP>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Button onClick={handleVerifyMfaCode} disabled={mfaBusy}>
                    {isVerifyingMfaCode ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Verifying...
                      </>
                    ) : (
                      "Verify and Sign In"
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleResendMfaCode}
                    disabled={mfaBusy}
                  >
                    {isSendingMfaCode ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      "Resend Code"
                    )}
                  </Button>
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={() => void handleCancelMfa()}
                  disabled={mfaBusy}
                >
                  Cancel
                </Button>
              </CardContent>
            </>
          ) : magicLinkTargetEmail ? (
            <div className="flex flex-col items-center justify-center p-8 text-center">
              <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                <CheckCircle2 className="h-8 w-8" />
              </div>
              <CardTitle className="text-xl">Check your inbox</CardTitle>
              <CardDescription className="mt-2">
                {magicLinkInfo || "A sign-in link has been sent to your email."}
              </CardDescription>
              <p className="mt-2 text-sm text-muted-foreground">
                Sent to{" "}
                <span className="font-medium text-foreground">
                  {magicLinkTargetEmail}
                </span>
              </p>

              <div className="mt-6 grid w-full gap-2">
                <Button
                  type="button"
                  onClick={handleSendMagicLink}
                  disabled={isSendingMagicLink}
                >
                  {isSendingMagicLink ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending link...
                    </>
                  ) : (
                    "Send again"
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setMagicLinkTargetEmail(null);
                    setMagicLinkInfo("");
                  }}
                  disabled={isSendingMagicLink}
                >
                  Back to sign-in methods
                </Button>
              </div>
            </div>
          ) : (
            <>
              <CardHeader className="space-y-2">
                <CardTitle>Welcome Back</CardTitle>
                <CardDescription>
                  Choose how you want to sign in.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {error ? (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}

                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="name@company.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    disabled={disableLoginActions}
                    className="focus:ring-2 focus:ring-ring"
                    required
                  />
                </div>

                <form onSubmit={handlePasswordSignIn} className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      disabled={disableLoginActions}
                      className="focus:ring-2 focus:ring-ring"
                      required
                    />
                    <div className="text-right">
                      <button
                        type="button"
                        onClick={() => router.push("/forgot-password")}
                        className="text-sm font-medium text-muted-foreground hover:text-foreground hover:underline"
                        disabled={disableLoginActions}
                      >
                        Forgot password?
                      </button>
                    </div>
                  </div>

                  <Button
                    type="submit"
                    className="w-full focus:ring-2 focus:ring-ring"
                    disabled={disableLoginActions}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Signing in...
                      </>
                    ) : (
                      "Sign In"
                    )}
                  </Button>
                </form>

                <div className="space-y-3 border-t border-border pt-4">
                  <p className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                    Prefer passwordless sign-in? We can email you a secure magic
                    link.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={handleSendMagicLink}
                    disabled={disableLoginActions}
                  >
                    {isSendingMagicLink ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Sending link...
                      </>
                    ) : (
                      <>
                        <Mail className="mr-2 h-4 w-4" />
                        Send Magic Link
                      </>
                    )}
                  </Button>
                </div>

                <div className="relative mt-4">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-border" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">
                      Or continue with
                    </span>
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  className="w-full focus:ring-2 focus:ring-ring mt-4"
                  onClick={handleGoogleSignIn}
                  disabled={disableLoginActions}
                >
                  <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="currentColor"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                  Sign in with Google
                </Button>

                {hasValidEmail ? (
                  <div className="space-y-2 border-t border-border pt-4">
                    {isCheckingPasskey ? (
                      <p className="text-xs text-muted-foreground">
                        Checking for a registered passkey...
                      </p>
                    ) : null}

                    {hasRegisteredPasskey ? (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full"
                          onClick={handlePasskeySignIn}
                          disabled={disableLoginActions || isCheckingPasskey}
                        >
                          {isSigningInWithPasskey ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Checking passkey...
                            </>
                          ) : (
                            <>
                              <KeyRound className="mr-2 h-4 w-4" />
                              Continue with Passkey
                            </>
                          )}
                        </Button>
                        <p className="text-xs text-muted-foreground">
                          Passkey found for this email.
                        </p>
                      </>
                    ) : null}
                  </div>
                ) : null}

                <p className="text-center text-sm text-muted-foreground">
                  Don&apos;t have an account?{" "}
                  <button
                    type="button"
                    onClick={() => router.push("/register")}
                    className="font-medium text-foreground hover:underline"
                    disabled={disableLoginActions}
                  >
                    Create account
                  </button>
                </p>
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
