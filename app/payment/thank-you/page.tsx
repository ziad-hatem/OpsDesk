import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/components/ui/card";
import { Button } from "@/app/components/ui/button";

type SearchParams = {
  order_id?: string;
  order_number?: string;
  session_id?: string;
};

type ThankYouPageProps = {
  searchParams: Promise<SearchParams>;
};

function displayValue(value?: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || "-";
}

export default async function PaymentThankYouPage({ searchParams }: ThankYouPageProps) {
  const params = await searchParams;
  const orderNumber = displayValue(params.order_number);
  const sessionId = displayValue(params.session_id);
  const orderId = displayValue(params.order_id);

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-xl">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
            <CheckCircle2 className="h-8 w-8 text-emerald-600" />
          </div>
          <CardTitle className="text-2xl">Thank You</CardTitle>
          <CardDescription>
            Your payment was completed successfully.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border border-slate-200 bg-white p-4 text-sm">
            <p className="text-slate-600">Order Number</p>
            <p className="font-medium text-slate-900 break-all">{orderNumber}</p>
            <p className="mt-3 text-slate-600">Order ID</p>
            <p className="font-medium text-slate-900 break-all">{orderId}</p>
            <p className="mt-3 text-slate-600">Session ID</p>
            <p className="font-medium text-slate-900 break-all">{sessionId}</p>
          </div>

          <div className="flex justify-center">
            <Button asChild>
              <Link href="/login">Back to OpsDesk</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
