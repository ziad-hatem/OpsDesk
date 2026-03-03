import { Resend } from "resend";
import ExecutiveReportEmail from "@/app/emails/ExecutiveReportEmail";
import type { ReportsResponse } from "@/lib/reports/types";

interface SendExecutiveReportEmailParams {
  toEmail: string;
  organizationName: string;
  scheduleName: string;
  reports: ReportsResponse;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function formatMinutes(value: number | null): string {
  if (value === null) {
    return "N/A";
  }
  if (value < 60) {
    return `${value.toFixed(1)}m`;
  }
  const hours = Math.floor(value / 60);
  const minutes = Math.round(value % 60);
  if (minutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${minutes}m`;
}

function formatPercent(value: number | null): string {
  if (value === null) {
    return "N/A";
  }
  return `${value.toFixed(1)}%`;
}

function formatCount(value: number | null): string {
  if (value === null) {
    return "N/A";
  }
  return `${Math.round(value)}`;
}

function formatRangeLabel(fromIso: string, toIso: string): string {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return "Custom range";
  }

  const formatter = new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  return `${formatter.format(from)} - ${formatter.format(to)}`;
}

function getDashboardUrl(): string {
  const appBase =
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  return `${appBase.replace(/\/$/, "")}/reports`;
}

export async function sendExecutiveReportEmail(
  params: SendExecutiveReportEmailParams,
): Promise<void> {
  const resend = new Resend(getRequiredEnv("RESEND_API_KEY"));
  const fromEmail =
    process.env.RESEND_FROM_EMAIL ?? "OpsDesk Analytics <onboarding@resend.dev>";

  const metrics = [
    {
      label: "Avg Response Time",
      current: formatMinutes(params.reports.metrics.avgResponseTimeMinutes.current),
      previous: formatMinutes(params.reports.metrics.avgResponseTimeMinutes.previous),
      year: formatMinutes(params.reports.metrics.avgResponseTimeMinutes.year),
    },
    {
      label: "Avg Resolution Time",
      current: formatMinutes(params.reports.metrics.avgResolutionTimeMinutes.current),
      previous: formatMinutes(params.reports.metrics.avgResolutionTimeMinutes.previous),
      year: formatMinutes(params.reports.metrics.avgResolutionTimeMinutes.year),
    },
    {
      label: "Incident MTTR",
      current: formatMinutes(params.reports.metrics.incidentMttrMinutes.current),
      previous: formatMinutes(params.reports.metrics.incidentMttrMinutes.previous),
      year: formatMinutes(params.reports.metrics.incidentMttrMinutes.year),
    },
    {
      label: "Customer Satisfaction",
      current: formatPercent(params.reports.metrics.customerSatisfactionScore.current),
      previous: formatPercent(params.reports.metrics.customerSatisfactionScore.previous),
      year: formatPercent(params.reports.metrics.customerSatisfactionScore.year),
    },
    {
      label: "SLA Compliance",
      current: formatPercent(params.reports.metrics.slaComplianceRate.current),
      previous: formatPercent(params.reports.metrics.slaComplianceRate.previous),
      year: formatPercent(params.reports.metrics.slaComplianceRate.year),
    },
    {
      label: "Ticket Backlog",
      current: formatCount(params.reports.metrics.ticketBacklogCount.current),
      previous: formatCount(params.reports.metrics.ticketBacklogCount.previous),
      year: formatCount(params.reports.metrics.ticketBacklogCount.year),
    },
  ];

  const { error } = await resend.emails.send({
    from: fromEmail,
    to: [params.toEmail],
    subject: `${params.organizationName}: Executive analytics report`,
    react: await ExecutiveReportEmail({
      organizationName: params.organizationName,
      scheduleName: params.scheduleName,
      generatedAt: new Date().toUTCString(),
      rangeLabel: formatRangeLabel(params.reports.range.from, params.reports.range.to),
      dashboardUrl: getDashboardUrl(),
      metrics,
    }),
  });

  if (error) {
    throw new Error(error.message ?? "Failed to send executive report email");
  }
}
