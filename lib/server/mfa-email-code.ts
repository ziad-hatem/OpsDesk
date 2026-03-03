import { Resend } from "resend";
import MfaVerificationCodeEmail from "@/app/emails/MfaVerificationCodeEmail";

interface SendMfaEmailCodeParams {
  toEmail: string;
  code: string;
  expiresInMinutes: number;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export async function sendMfaEmailCode(
  params: SendMfaEmailCodeParams,
): Promise<void> {
  const resend = new Resend(getRequiredEnv("RESEND_API_KEY"));
  const fromAddress =
    process.env.RESEND_FROM_EMAIL ?? "OpsDesk <onboarding@resend.dev>";

  const { error } = await resend.emails.send({
    from: fromAddress,
    to: [params.toEmail],
    subject: `Your OpsDesk verification code: ${params.code}`,
    react: await MfaVerificationCodeEmail({
      email: params.toEmail,
      code: params.code,
      expiresInMinutes: params.expiresInMinutes,
    }),
  });

  if (error) {
    throw new Error(error.message ?? "Failed to send MFA verification code");
  }
}
