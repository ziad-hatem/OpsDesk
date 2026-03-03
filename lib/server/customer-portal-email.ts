import { Resend } from "resend";
import CustomerPortalAccessEmail from "@/app/emails/CustomerPortalAccessEmail";

interface SendCustomerPortalAccessEmailParams {
  toEmail: string;
  customerName: string;
  organizationName: string;
  accessLink: string;
  expiresAt: string;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export async function sendCustomerPortalAccessEmail(
  params: SendCustomerPortalAccessEmailParams,
): Promise<void> {
  const resend = new Resend(getRequiredEnv("RESEND_API_KEY"));
  const fromAddress =
    process.env.RESEND_FROM_EMAIL ?? "OpsDesk <onboarding@resend.dev>";

  const { error } = await resend.emails.send({
    from: fromAddress,
    to: [params.toEmail],
    subject: `${params.organizationName} customer portal access`,
    react: await CustomerPortalAccessEmail({
      customerName: params.customerName,
      organizationName: params.organizationName,
      accessLink: params.accessLink,
      expiresAt: params.expiresAt,
    }),
  });

  if (error) {
    throw new Error(error.message ?? "Failed to send customer portal access email");
  }
}

