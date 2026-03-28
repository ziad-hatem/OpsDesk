"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertCircle, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Alert, AlertDescription } from "../../components/ui/alert";
import {
  getResetPasswordMismatchError,
  parseRecoveryTokens,
} from "./reset-password-flow";

export default function Page() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingLink, setCheckingLink] = useState(true);
  const [isLinkValid, setIsLinkValid] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const applyRecoverySession = async () => {
      const tokens = parseRecoveryTokens(
        window.location.search,
        window.location.hash,
      );

      if (!tokens) {
        setIsLinkValid(false);
        setCheckingLink(false);
        return;
      }

      const { error: sessionError } = await supabase.auth.setSession({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
      });

      if (sessionError) {
        setIsLinkValid(false);
      } else {
        setIsLinkValid(true);
      }

      setCheckingLink(false);
    };

    void applyRecoverySession();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const mismatchError = getResetPasswordMismatchError(
      password,
      confirmPassword,
    );
    if (mismatchError) {
      setError(mismatchError);
      return;
    }

    setLoading(true);

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });

      if (updateError) {
        throw new Error(updateError.message);
      }

      toast.success("Password updated successfully");
      router.push("/login");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to reset password";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-muted/50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
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
            <span className="text-2xl font-semibold text-foreground">
              OpsDesk
            </span>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Reset your password</CardTitle>
            <CardDescription>Choose a new password for your account.</CardDescription>
          </CardHeader>
          <CardContent>
            {checkingLink ? (
              <div className="flex items-center justify-center text-sm text-muted-foreground py-4">
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Verifying reset link...
              </div>
            ) : !isLinkValid ? (
              <div className="space-y-4">
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    This reset link is invalid or expired.
                  </AlertDescription>
                </Alert>
                <Button className="w-full" onClick={() => router.push("/login")}>
                  Back to login
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                <div className="space-y-2">
                  <Label htmlFor="password">New Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    minLength={6}
                    disabled={loading}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm Password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm your new password"
                    minLength={6}
                    disabled={loading}
                    required
                  />
                </div>

                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Updating password...
                    </>
                  ) : (
                    "Update password"
                  )}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

