"use client";

import { FormEvent, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Mail, Loader2 } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";

function getErrorMessage(code: string | null): string | null {
  if (!code) {
    return null;
  }

  if (code === "invalid_link" || code === "invalid_or_expired") {
    return "This sign-in link is invalid or expired. Request a new one.";
  }
  if (code === "customer_blocked") {
    return "Portal access is blocked for this customer. Contact support.";
  }
  return "Unable to sign in with that link. Request a new one.";
}

export default function PortalSignInPage() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(
    getErrorMessage(searchParams.get("error")),
  );

  const normalizedEmail = useMemo(() => email.trim().toLowerCase(), [email]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!normalizedEmail || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/portal/auth/request-link", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: normalizedEmail }),
      });

      const payload = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to request sign-in link");
      }

      setMessage(
        payload.message ??
          "If this email has portal access, a secure sign-in link has been sent.",
      );
    } catch (requestError: unknown) {
      const requestErrorMessage =
        requestError instanceof Error
          ? requestError.message
          : "Failed to request portal sign-in link";
      setError(requestErrorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-10">
      <div className="mx-auto w-full max-w-md">
        <Card className="border-slate-200 bg-white">
          <CardHeader className="space-y-2 text-center">
            <CardTitle className="text-2xl text-slate-900">Customer Portal</CardTitle>
            <CardDescription>
              Enter your customer email and we will send a secure sign-in link.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="portal-email">Email</Label>
                <Input
                  id="portal-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@company.com"
                  required
                  disabled={isSubmitting}
                />
              </div>

              <Button
                type="submit"
                disabled={isSubmitting || !normalizedEmail}
                className="w-full gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Sending link...
                  </>
                ) : (
                  <>
                    <Mail className="h-4 w-4" />
                    Send secure link
                  </>
                )}
              </Button>
            </form>

            {message ? (
              <p className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {message}
              </p>
            ) : null}

            {error ? (
              <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

