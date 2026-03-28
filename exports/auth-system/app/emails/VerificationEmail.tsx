import * as React from "react";
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
  Button,
} from "@react-email/components";

interface VerificationEmailProps {
  email: string;
  firstName?: string;
  verificationLink: string;
}

export default function VerificationEmail({
  email,
  firstName,
  verificationLink,
}: VerificationEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>OpsDesk - Welcome! Please verify your email</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Text style={logoText}>OpsDesk</Text>
          </Section>

          <Section style={content}>
            <Heading style={heading}>Welcome aboard!</Heading>
            <Text style={text}>
              Hi {firstName || "there"}, we're excited to have you on OpsDesk.
              Let's get your account set up for{" "}
              <span style={emailText}>{email}</span>.
            </Text>

            <Button style={button} href={verificationLink}>
              Verify Email Address
            </Button>

            <Text style={subtext}>
              If you didn't request this email, there's nothing to worry about -
              you can safely ignore it.
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
  backgroundColor: "#f8fafc", // slate-50
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
  color: "#0f172a", // slate-900
  margin: "0",
};

const content = {
  backgroundColor: "#ffffff",
  border: "1px solid #e2e8f0", // slate-200
  borderRadius: "12px",
  padding: "40px",
  boxShadow:
    "0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)",
};

const heading = {
  fontSize: "24px",
  letterSpacing: "-0.5px",
  lineHeight: "1.3",
  fontWeight: "600",
  color: "#0f172a", // slate-900
  padding: "0",
  margin: "0 0 24px",
};

const text = {
  color: "#334155", // slate-700
  fontSize: "16px",
  lineHeight: "24px",
  margin: "0 0 32px",
};

const emailText = {
  fontWeight: "600",
  color: "#0f172a", // slate-900
};

const button = {
  backgroundColor: "#0f172a", // slate-900
  borderRadius: "6px",
  color: "#ffffff",
  fontSize: "16px",
  fontWeight: "600",
  textDecoration: "none",
  textAlign: "center" as const,
  display: "block",
  padding: "12px 24px",
  margin: "0 auto 32px",
};

const subtext = {
  color: "#64748b", // slate-500
  fontSize: "14px",
  lineHeight: "20px",
  margin: "0",
};

const footer = {
  marginTop: "32px",
};

const footerText = {
  color: "#94a3b8", // slate-400
  fontSize: "14px",
  lineHeight: "24px",
  textAlign: "center" as const,
};
