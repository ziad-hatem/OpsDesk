import { Resend } from "resend";
import OrderPaymentLinkEmail from "@/app/emails/OrderPaymentLinkEmail";

interface SendOrderPaymentLinkEmailParams {
  toEmail: string;
  customerName: string | null;
  organizationName: string;
  orderNumber: string;
  amountCents: number;
  currency: string;
  paymentUrl: string;
  expiresAt: string;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function formatMoney(cents: number, currency: string): string {
  const normalizedCurrency = (currency || "USD").trim().toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalizedCurrency,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${normalizedCurrency}`;
  }
}

export async function sendOrderPaymentLinkEmail(
  params: SendOrderPaymentLinkEmailParams,
): Promise<void> {
  const resend = new Resend(getRequiredEnv("RESEND_API_KEY"));
  const fromAddress =
    process.env.RESEND_FROM_EMAIL ?? "OpsDesk Billing <onboarding@resend.dev>";

  const { error } = await resend.emails.send({
    from: fromAddress,
    to: [params.toEmail],
    subject: `Payment link for order ${params.orderNumber}`,
    react: await OrderPaymentLinkEmail({
      customerName: params.customerName,
      organizationName: params.organizationName,
      orderNumber: params.orderNumber,
      amountLabel: formatMoney(params.amountCents, params.currency),
      paymentUrl: params.paymentUrl,
      expiresAt: params.expiresAt,
    }),
  });

  if (error) {
    throw new Error(error.message ?? "Failed to send payment link email");
  }
}
