"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
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
  FORGOT_PASSWORD_SUCCESS_MESSAGE,
  normalizeEmail,
} from "./forgot-password-flow";

export default function Page() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizeEmail(email) }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to send reset email");
      }

      setSubmitted(true);
      toast.success(FORGOT_PASSWORD_SUCCESS_MESSAGE);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "An unexpected error occurred";
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
          {submitted ? (
            <div className="flex flex-col items-center justify-center p-8 space-y-4 text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-green-600" />
              </div>
              <CardTitle className="text-xl">Check your inbox</CardTitle>
              <CardDescription>{FORGOT_PASSWORD_SUCCESS_MESSAGE}</CardDescription>
              <Button
                className="w-full mt-2"
                onClick={() => router.push("/login")}
              >
                Back to login
              </Button>
            </div>
          ) : (
            <>
              <CardHeader>
                <CardTitle>Forgot your password?</CardTitle>
                <CardDescription>
                  Enter your email and we&apos;ll send you a reset link.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  {error && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="john@acme.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={loading}
                      className="focus:ring-2 focus:ring-ring"
                      required
                    />
                  </div>

                  <Button
                    type="submit"
                    className="w-full focus:ring-2 focus:ring-ring"
                    disabled={loading}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Sending reset link...
                      </>
                    ) : (
                      "Send reset link"
                    )}
                  </Button>

                  <div className="text-center text-sm text-muted-foreground">
                    Remembered your password?{" "}
                    <button
                      type="button"
                      className="text-foreground font-medium hover:underline"
                      onClick={() => router.push("/login")}
                      disabled={loading}
                    >
                      Go to login
                    </button>
                  </div>
                </form>
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

