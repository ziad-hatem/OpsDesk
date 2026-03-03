"use client";

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, KeyRound, Loader2, Mail, ShieldCheck } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "../../components/ui/input-otp";
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

type SignInMode = "password" | "magic-link";

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

function readAuthErrorCode(result: SignInResultWithCode | undefined): string | null {
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
  const raw = error instanceof Error ? error.message : "Failed to sign in with passkey";
  const normalized = raw.toLowerCase();

  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "Passkeys require HTTPS (or localhost). On phone, open your HTTPS domain, not a plain HTTP URL.";
  }

  if (normalized.includes("not supported")) {
    return "This browser/device cannot use passkeys for this site. Update browser and ensure HTTPS.";
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
  const [mode, setMode] = useState<SignInMode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [isSendingMagicLink, setIsSendingMagicLink] = useState(false);
  const [isSigningInWithPasskey, setIsSigningInWithPasskey] = useState(false);
  const [isSendingMfaCode, setIsSendingMfaCode] = useState(false);
  const [isVerifyingMfaCode, setIsVerifyingMfaCode] = useState(false);
  const [requiresMfa, setRequiresMfa] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaTargetEmail, setMfaTargetEmail] = useState<string | null>(null);
  const [mfaInfo, setMfaInfo] = useState("");
  const [error, setError] = useState("");
  const [isVerified, setIsVerified] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const { authenticate: authenticatePasskey } = useAuthenticatePasskey({
    endpoints: passkeyEndpoints,
  });

  const disableLoginActions =
    loading ||
    isSendingMagicLink ||
    isSigningInWithPasskey ||
    isSendingMfaCode ||
    isVerifyingMfaCode;
  const mfaBusy = isSendingMfaCode || isVerifyingMfaCode;

  useEffect(() => {
    if (typeof window !== "undefined" && hasVerifiedQuery(window.location.search)) {
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
      setError(
        mapLoginError("CredentialsSignin", "account_suspended"),
      );
    }
  }, [searchParams]);

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

  const runPasskeyChallenge = async (userId: string): Promise<void> => {
    if (typeof window === "undefined" || !("PublicKeyCredential" in window)) {
      throw new Error("Passkeys are not supported in this browser");
    }
    if (!window.isSecureContext) {
      throw new Error(
        "Passkeys require HTTPS (or localhost). On phone, use your HTTPS domain.",
      );
    }

    const result =
      (await authenticatePasskey(userId)) as PasskeyAuthenticateResult;
    if (!result.verified || !result.assertionToken) {
      throw new Error("Passkey authentication was not verified.");
    }
  };

  const getSessionTokens = async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    const refreshToken = sessionData.session?.refresh_token;
    if (!accessToken || !refreshToken) {
      throw new Error("Authentication session is missing. Please sign in again.");
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
      throw new Error(
        mapLoginError(nextAuthResult.error, errorCode),
      );
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
      const normalizedEmail = email.trim().toLowerCase();
      const { data, error: supabaseError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (supabaseError || !data.user) {
        throw new Error(mapPasswordSignInError(supabaseError));
      }

      if (isMultiStepAuthEnabled(data.user.user_metadata)) {
        await startMfaStep(normalizedEmail);
        return;
      }

      await finalizeSessionSignIn();
      toast.success("Logged in successfully");
      router.push("/");
    } catch (submitError: unknown) {
      const message =
        submitError instanceof Error ? submitError.message : "Failed to sign in";
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

  const handleSendMagicLink = async () => {
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setError("Enter your email to receive a magic link");
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
        body: JSON.stringify({ email: normalizedEmail }),
      });

      const data = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to send magic link");
      }

      toast.success(data.message ?? "Check your email for a sign-in link.");
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

    if (typeof window === "undefined" || !("PublicKeyCredential" in window)) {
      setError("Passkeys are not supported in this browser");
      return;
    }
    if (!window.isSecureContext) {
      setError("Passkeys require HTTPS (or localhost). On phone, use your HTTPS domain.");
      return;
    }

    setIsSigningInWithPasskey(true);

    try {
      const { data: existingSessionData } = await supabase.auth.getSession();
      if (!existingSessionData.session) {
        throw new Error(
          "No local auth session found. Sign in once with password or magic link first.",
        );
      }

      await runPasskeyChallenge(
        existingSessionData.session.user.id,
      );
      await finalizeSessionSignIn();
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

  const handleModeChange = (value: string) => {
    if (value === "password" || value === "magic-link") {
      setMode(value);
      setError("");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 via-white to-slate-50 px-4 py-6 flex items-center justify-center">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900 text-lg font-bold text-white">
            OD
          </div>
          <div>
            <p className="text-lg font-semibold text-slate-900">OpsDesk</p>
            <p className="text-xs text-slate-500">OpsDesk Access</p>
          </div>
        </div>
        <Card className="border-slate-200 shadow-sm">
          {isVerified ? (
            <div className="flex flex-col items-center justify-center p-8 text-center">
              <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                <CheckCircle2 className="h-8 w-8 text-green-600" />
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
                <div className="inline-flex w-fit items-center gap-1 rounded-full border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">
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
                  <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    {mfaInfo}
                  </p>
                ) : null}

                <div className="space-y-2">
                  <Label htmlFor="mfa-code">Verification code</Label>
                  <InputOTP
                    id="mfa-code"
                    maxLength={6}
                    value={mfaCode}
                    onChange={(value) => setMfaCode(value.replace(/\D/g, "").slice(0, 6))}
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
                    className="focus:ring-2 focus:ring-slate-900"
                    required
                  />
                </div>

                <Tabs value={mode} onValueChange={handleModeChange} className="w-full">
                  <TabsList className="w-full">
                    <TabsTrigger value="password">Password</TabsTrigger>
                    <TabsTrigger value="magic-link">Magic Link</TabsTrigger>
                  </TabsList>

                  <TabsContent value="password" className="mt-4">
                    <form onSubmit={handlePasswordSignIn} className="space-y-3">
                      <div className="space-y-2">
                        <Label htmlFor="password">Password</Label>
                        <Input
                          id="password"
                          type="password"
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                          disabled={disableLoginActions}
                          className="focus:ring-2 focus:ring-slate-900"
                          required
                        />
                        <div className="text-right">
                          <button
                            type="button"
                            onClick={() => router.push("/forgot-password")}
                            className="text-sm font-medium text-slate-900 hover:underline"
                            disabled={disableLoginActions}
                          >
                            Forgot password?
                          </button>
                        </div>
                      </div>

                      <Button
                        type="submit"
                        className="w-full focus:ring-2 focus:ring-slate-900"
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
                  </TabsContent>

                  <TabsContent value="magic-link" className="mt-4 space-y-3">
                    <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                      We will email you a secure sign-in link.
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
                  </TabsContent>
                </Tabs>

                <div className="space-y-3 border-t border-slate-200 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={handlePasskeySignIn}
                    disabled={disableLoginActions}
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
                  <p className="text-xs text-slate-500">
                    Passkey sign-in requires an existing local session on this device.
                  </p>
                </div>

                <p className="text-center text-sm text-slate-500">
                  Don&apos;t have an account?{" "}
                  <button
                    type="button"
                    onClick={() => router.push("/register")}
                    className="font-medium text-slate-900 hover:underline"
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
