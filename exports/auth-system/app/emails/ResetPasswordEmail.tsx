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

interface ResetPasswordEmailProps {
  email: string;
  resetLink: string;
}

export default function ResetPasswordEmail({
  email,
  resetLink,
}: ResetPasswordEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>OpsDesk - Reset your password</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Text style={logoText}>OpsDesk</Text>
          </Section>

          <Section style={content}>
            <Heading style={heading}>Reset your password</Heading>
            <Text style={text}>
              We received a request to reset the password for{" "}
              <span style={emailText}>{email}</span>.
            </Text>

            <Button style={button} href={resetLink}>
              Reset Password
            </Button>

            <Text style={subtext}>
              If you did not request this, you can ignore this email.
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
  boxShadow:
    "0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)",
};

const heading = {
  fontSize: "24px",
  letterSpacing: "-0.5px",
  lineHeight: "1.3",
  fontWeight: "600",
  color: "#0f172a",
  padding: "0",
  margin: "0 0 24px",
};

const text = {
  color: "#334155",
  fontSize: "16px",
  lineHeight: "24px",
  margin: "0 0 32px",
};

const emailText = {
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
  margin: "0 auto 32px",
};

const subtext = {
  color: "#64748b",
  fontSize: "14px",
  lineHeight: "20px",
  margin: "0",
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
