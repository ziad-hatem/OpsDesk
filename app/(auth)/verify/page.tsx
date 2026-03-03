"use client";

import { useState } from "react";
import Image from "next/image";
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
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { isVerificationCodeValid } from "./verify-flow";

export default function Page() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const expectedCode = searchParams.get("code") ?? "";

  const [code, setCode] = useState("");
  const [result, setResult] = useState<boolean | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const isValid = isVerificationCodeValid(code, expectedCode);
    setResult(isValid);

    if (isValid) {
      toast.success("Code verified");
    } else {
      toast.error("false");
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
            <CardTitle>Verify your code</CardTitle>
            <CardDescription>
              Enter the verification code from your email.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="verification-code">Verification code</Label>
                <Input
                  id="verification-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Enter code"
                  required
                  className="focus:ring-2 focus:ring-ring"
                />
              </div>

              <Button
                type="submit"
                className="w-full focus:ring-2 focus:ring-ring"
              >
                Verify code
              </Button>

              {result === true && (
                <div className="flex items-center justify-center text-sm text-green-700 gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  <span data-testid="verification-result">true</span>
                </div>
              )}

              {result === false && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <span data-testid="verification-result">false</span>
                  </AlertDescription>
                </Alert>
              )}
            </form>

            <div className="text-center text-sm text-muted-foreground mt-4">
              Already verified?{" "}
              <button
                type="button"
                onClick={() => router.push("/login")}
                className="text-foreground font-medium hover:underline"
              >
                Go to login
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

