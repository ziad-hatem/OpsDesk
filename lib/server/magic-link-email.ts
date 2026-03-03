import { Resend } from "resend";
import MagicLinkEmail from "@/app/emails/MagicLinkEmail";

interface SendMagicLinkEmailParams {
  toEmail: string;
  magicLink: string;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export async function sendMagicLinkEmail(
  params: SendMagicLinkEmailParams,
): Promise<void> {
  const resend = new Resend(getRequiredEnv("RESEND_API_KEY"));
  const fromAddress =
    process.env.RESEND_FROM_EMAIL ?? "OpsDesk <onboarding@resend.dev>";

  const { error } = await resend.emails.send({
    from: fromAddress,
    to: [params.toEmail],
    subject: "Your OpsDesk magic sign-in link",
    react: await MagicLinkEmail({
      email: params.toEmail,
      magicLink: params.magicLink,
    }),
  });

  if (error) {
    throw new Error(error.message ?? "Failed to send magic link email");
  }
}
