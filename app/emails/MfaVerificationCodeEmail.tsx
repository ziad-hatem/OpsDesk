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
} from "@react-email/components";

interface MfaVerificationCodeEmailProps {
  email: string;
  code: string;
  expiresInMinutes: number;
}

export default function MfaVerificationCodeEmail({
  email,
  code,
  expiresInMinutes,
}: MfaVerificationCodeEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>OpsDesk security code: {code}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Text style={logoText}>OpsDesk</Text>
          </Section>

          <Section style={content}>
            <Heading style={heading}>Verify your sign-in</Heading>
            <Text style={text}>
              Enter this verification code to continue signing in to{" "}
              <span style={emailText}>{email}</span>.
            </Text>

            <Section style={codeContainer}>
              <Text style={codeText}>{code}</Text>
            </Section>

            <Text style={subtext}>
              This code expires in {expiresInMinutes} minutes.
            </Text>
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
  margin: "0 0 20px",
};

const emailText = {
  fontWeight: "600",
  color: "#0f172a",
};

const codeContainer = {
  border: "1px solid #cbd5e1",
  borderRadius: "10px",
  padding: "14px 16px",
  margin: "0 0 20px",
  backgroundColor: "#f8fafc",
};

const codeText = {
  margin: "0",
  color: "#0f172a",
  textAlign: "center" as const,
  letterSpacing: "6px",
  fontSize: "30px",
  fontWeight: "700",
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
