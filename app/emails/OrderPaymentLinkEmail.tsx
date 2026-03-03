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

interface OrderPaymentLinkEmailProps {
  customerName: string | null;
  organizationName: string;
  orderNumber: string;
  amountLabel: string;
  paymentUrl: string;
  expiresAt: string;
}

function formatExpiresAt(isoDate: string): string {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) {
    return "soon";
  }
  return parsed.toUTCString();
}

export default function OrderPaymentLinkEmail({
  customerName,
  organizationName,
  orderNumber,
  amountLabel,
  paymentUrl,
  expiresAt,
}: OrderPaymentLinkEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Payment link for order {orderNumber}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Text style={logoText}>OpsDesk</Text>
          </Section>

          <Section style={content}>
            <Heading style={heading}>Payment Request</Heading>
            <Text style={text}>
              {customerName ? `Hi ${customerName},` : "Hi,"}
            </Text>
            <Text style={text}>
              {organizationName} sent you a payment request for order{" "}
              <span style={highlight}>{orderNumber}</span>.
            </Text>
            <Text style={text}>
              Amount due: <span style={highlight}>{amountLabel}</span>
            </Text>

            <Button href={paymentUrl} style={button}>
              Pay Now
            </Button>

            <Text style={subtext}>This payment link expires on {formatExpiresAt(expiresAt)}.</Text>
            <Text style={subtext}>
              If this wasn&apos;t expected, you can ignore this email.
            </Text>
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
  maxWidth: "600px",
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
  padding: "40px",
};

const heading = {
  fontSize: "24px",
  lineHeight: "1.3",
  fontWeight: "600",
  color: "#0f172a",
  margin: "0 0 24px",
};

const text = {
  color: "#334155",
  fontSize: "16px",
  lineHeight: "24px",
  margin: "0 0 16px",
};

const highlight = {
  fontWeight: "600",
  color: "#0f172a",
};

const button = {
  backgroundColor: "#0f172a",
  borderRadius: "6px",
  color: "#ffffff",
  fontSize: "16px",
  fontWeight: "600",
  textDecoration: "none",
  textAlign: "center" as const,
  display: "block",
  padding: "12px 24px",
  margin: "20px auto",
};

const subtext = {
  color: "#64748b",
  fontSize: "14px",
  lineHeight: "20px",
  margin: "0 0 8px",
};

const footer = {
  marginTop: "32px",
};

const footerText = {
  color: "#94a3b8",
  fontSize: "14px",
  lineHeight: "24px",
  textAlign: "center" as const,
};
