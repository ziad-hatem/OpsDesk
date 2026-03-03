import { Resend } from "resend";
import TeamInviteEmail from "@/app/emails/TeamInviteEmail";
import { getRoleLabel } from "@/lib/team/validation";
import type { OrganizationRole } from "@/lib/topbar/types";

interface SendTeamInviteEmailParams {
  toEmail: string;
  organizationName: string;
  inviterName: string | null;
  role: OrganizationRole;
  inviteLink: string;
  expiresAt: string;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function normalizeAppBaseUrl(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export function buildInviteLink(token: string): string {
  const baseUrl =
    process.env.NEXTAUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000";
  return `${normalizeAppBaseUrl(baseUrl)}/invite/${token}`;
}

export async function sendTeamInviteEmail(
  params: SendTeamInviteEmailParams,
): Promise<void> {
  const resend = new Resend(getRequiredEnv("RESEND_API_KEY"));
  const fromAddress =
    process.env.RESEND_FROM_EMAIL ?? "OpsDesk <onboarding@resend.dev>";

  const { error } = await resend.emails.send({
    from: fromAddress,
    to: [params.toEmail],
    subject: `You're invited to join ${params.organizationName} on OpsDesk`,
    react: await TeamInviteEmail({
      inviteeEmail: params.toEmail,
      organizationName: params.organizationName,
      inviterName: params.inviterName,
      roleLabel: getRoleLabel(params.role),
      inviteLink: params.inviteLink,
      expiresAt: params.expiresAt,
    }),
  });

  if (error) {
    throw new Error(error.message ?? "Failed to send invite email");
  }
}
