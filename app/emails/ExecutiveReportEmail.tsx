import * as React from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";

interface ExecutiveReportEmailMetric {
  label: string;
  current: string;
  previous: string;
  year: string;
}

interface ExecutiveReportEmailProps {
  organizationName: string;
  scheduleName: string;
  rangeLabel: string;
  generatedAt: string;
  dashboardUrl: string;
  metrics: ExecutiveReportEmailMetric[];
}

export default function ExecutiveReportEmail({
  organizationName,
  scheduleName,
  rangeLabel,
  generatedAt,
  dashboardUrl,
  metrics,
}: ExecutiveReportEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{organizationName} executive report is ready</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Text style={logoText}>OpsDesk</Text>
          </Section>

          <Section style={content}>
            <Heading style={heading}>Executive Analytics Report</Heading>
            <Text style={text}>
              <span style={highlight}>{organizationName}</span> | {scheduleName}
            </Text>
            <Text style={subtext}>Range: {rangeLabel}</Text>
            <Text style={subtext}>Generated: {generatedAt}</Text>

            <Section style={tableWrap}>
              <table style={table}>
                <thead>
                  <tr>
                    <th style={th}>Metric</th>
                    <th style={th}>Current</th>
                    <th style={th}>Previous</th>
                    <th style={th}>Year</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.map((metric) => (
                    <tr key={metric.label}>
                      <td style={tdMetric}>{metric.label}</td>
                      <td style={td}>{metric.current}</td>
                      <td style={td}>{metric.previous}</td>
                      <td style={td}>{metric.year}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>

            <Button href={dashboardUrl} style={button}>
              Open Executive Dashboard
            </Button>
          </Section>

          <Section style={footer}>
            <Text style={footerText}>
              &copy; {new Date().getFullYear()} OpsDesk. All rights reserved.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const main = {
  backgroundColor: "#f8fafc",
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen-Sans,Ubuntu,Cantarell,"Helvetica Neue",sans-serif',
};

const container = {
  margin: "0 auto",
  padding: "20px 0 48px",
  width: "100%",
  maxWidth: "680px",
};

const header = {
  padding: "32px 0",
  textAlign: "center" as const,
};

const logoText = {
  fontSize: "24px",
  fontWeight: "600",
  color: "#0f172a",
  margin: "0",
};

const content = {
  backgroundColor: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: "12px",
  padding: "32px",
};

const heading = {
  fontSize: "24px",
  lineHeight: "1.3",
  fontWeight: "600",
  color: "#0f172a",
  margin: "0 0 16px",
};

const text = {
  color: "#334155",
  fontSize: "16px",
  lineHeight: "24px",
  margin: "0 0 8px",
};

const subtext = {
  color: "#64748b",
  fontSize: "14px",
  lineHeight: "20px",
  margin: "0 0 4px",
};

const highlight = {
  fontWeight: "600",
  color: "#0f172a",
};

const tableWrap = {
  marginTop: "20px",
  marginBottom: "20px",
};

const table = {
  width: "100%",
  borderCollapse: "collapse" as const,
};

const th = {
  border: "1px solid #e2e8f0",
  backgroundColor: "#f8fafc",
  color: "#334155",
  fontSize: "12px",
  fontWeight: "600",
  padding: "8px",
  textAlign: "left" as const,
};

const td = {
  border: "1px solid #e2e8f0",
  color: "#0f172a",
  fontSize: "13px",
  padding: "8px",
};

const tdMetric = {
  ...td,
  fontWeight: "600",
};

const button = {
  backgroundColor: "#0f172a",
  borderRadius: "6px",
  color: "#ffffff",
  fontSize: "15px",
  fontWeight: "600",
  textDecoration: "none",
  textAlign: "center" as const,
  display: "block",
  padding: "12px 24px",
  margin: "20px auto 0",
};

const footer = {
  marginTop: "24px",
};

const footerText = {
  color: "#94a3b8",
  fontSize: "14px",
  lineHeight: "24px",
  textAlign: "center" as const,
};
