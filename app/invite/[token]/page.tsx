"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Alert, AlertDescription } from "../../components/ui/alert";

type InviteInfoResponse = {
  invite: {
    email: string;
    role: string;
    roleLabel: string;
    expiresAt: string;
    organization: {
      id: string;
      name: string;
    };
    inviterName: string | null;
  };
};

type AcceptInviteResponse = {
  success: true;
  email: string;
  organizationId: string;
  organizationName: string;
  role: string;
};

function formatDateTime(isoDate: string): string {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }

  return parsed.toLocaleString();
}

async function readApiError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload.error) {
      return payload.error;
    }
  } catch {
    // Ignore JSON parse errors.
  }

  return response.statusText || `Request failed with status ${response.status}`;
}

export default function InviteTokenPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();

  const [inviteInfo, setInviteInfo] = useState<InviteInfoResponse["invite"] | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loadingInvite, setLoadingInvite] = useState(true);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");

  const canSubmit = useMemo(
    () =>
      Boolean(
        inviteInfo &&
          firstName.trim() &&
          lastName.trim() &&
          password.length >= 6 &&
          confirmPassword.length >= 6,
      ),
    [confirmPassword.length, firstName, inviteInfo, lastName, password.length],
  );

  const loadInvite = useCallback(async () => {
    if (!token) {
      setError("Invalid invite token.");
      setLoadingInvite(false);
      return;
    }

    setLoadingInvite(true);
    setError("");
    try {
      const response = await fetch(`/api/invites/${token}`, {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const payload = (await response.json()) as InviteInfoResponse;
      setInviteInfo(payload.invite);
    } catch (loadError: unknown) {
      const message =
        loadError instanceof Error ? loadError.message : "Failed to validate invite";
      setError(message);
    } finally {
      setLoadingInvite(false);
    }
  }, [token]);

  useEffect(() => {
    void loadInvite();
  }, [loadInvite]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!inviteInfo || !token) {
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setCreatingAccount(true);
    setError("");
    try {
      const response = await fetch(`/api/invites/${token}/accept`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          password,
        }),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const acceptedInvite = (await response.json()) as AcceptInviteResponse;

      setSuccessMessage(
        `Account created. Joining ${inviteInfo.organization.name}...`,
      );

      const signInResult = await signIn("credentials", {
        email: inviteInfo.email,
        password,
        redirect: false,
      });

      if (signInResult?.error) {
        toast.success("Account created. Please log in.");
        router.push(`/login?email=${encodeURIComponent(inviteInfo.email)}`);
        return;
      }

      await fetch("/api/me/active-organization", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ organizationId: acceptedInvite.organizationId }),
      }).catch(() => {
        // Non-blocking; app can still resolve active org via /api/me fallback.
      });

      toast.success("Welcome to OpsDesk");
      router.push("/");
    } catch (submitError: unknown) {
      const message =
        submitError instanceof Error
          ? submitError.message
          : "Failed to create account from invite";
      setError(message);
    } finally {
      setCreatingAccount(false);
    }
  };

  return (
    <div className="min-h-screen bg-muted/50 flex items-center justify-center p-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="flex justify-center">
          <div className="flex items-center gap-3">
            <div className="relative h-12 w-12 overflow-hidden rounded-xl border border-border bg-background">
              <Image
                src="/logo.webp"
                alt="OpsDesk logo"
                fill
                className="object-cover"
                sizes="48px"
                priority
              />
            </div>
            <span className="text-2xl font-semibold text-foreground">OpsDesk</span>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Accept Invite</CardTitle>
            <CardDescription>
              Create your account and join the invited organization.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingInvite ? (
              <div className="py-10 text-center text-muted-foreground">
                <Loader2 className="w-5 h-5 mx-auto mb-3 animate-spin" />
                Validating invite...
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                {successMessage && (
                  <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" />
                    {successMessage}
                  </div>
                )}

                {inviteInfo ? (
                  <>
                    <div className="space-y-2">
                      <Label>Organization</Label>
                      <Input value={inviteInfo.organization.name} readOnly />
                    </div>
                    <div className="space-y-2">
                      <Label>Invited Email</Label>
                      <Input value={inviteInfo.email} readOnly />
                    </div>
                    <div className="space-y-2">
                      <Label>Role</Label>
                      <Input value={inviteInfo.roleLabel} readOnly />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Expires at: {formatDateTime(inviteInfo.expiresAt)}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="invite-first-name">First Name</Label>
                        <Input
                          id="invite-first-name"
                          value={firstName}
                          onChange={(e) => setFirstName(e.target.value)}
                          disabled={creatingAccount}
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="invite-last-name">Last Name</Label>
                        <Input
                          id="invite-last-name"
                          value={lastName}
                          onChange={(e) => setLastName(e.target.value)}
                          disabled={creatingAccount}
                          required
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="invite-password">Password</Label>
                      <Input
                        id="invite-password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={creatingAccount}
                        minLength={6}
                        placeholder="At least 6 characters"
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="invite-confirm-password">Confirm Password</Label>
                      <Input
                        id="invite-confirm-password"
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        disabled={creatingAccount}
                        minLength={6}
                        required
                      />
                    </div>

                    <Button
                      type="submit"
                      className="w-full"
                      disabled={!canSubmit || creatingAccount}
                    >
                      {creatingAccount ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Creating account...
                        </>
                      ) : (
                        "Create account and join"
                      )}
                    </Button>
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    This invite is invalid or expired.
                  </div>
                )}
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
