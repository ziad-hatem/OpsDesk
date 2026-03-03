import type { Metadata } from "next";
import "./globals.css";
import { RootLayoutShell } from "./layout-shell";

const APP_NAME = "OpsDesk";
const APP_DESCRIPTION =
  "OpsDesk is an enterprise support operations platform that unifies tickets, orders, incidents, and customer communication in one workspace with SLA visibility and automation.";

function resolveMetadataBase() {
  const fallbackUrl = "http://localhost:3000";
  const configuredUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? fallbackUrl;

  try {
    return new URL(configuredUrl);
  } catch {
    return new URL(fallbackUrl);
  }
}

export const metadata: Metadata = {
  metadataBase: resolveMetadataBase(),
  applicationName: APP_NAME,
  title: {
    default: `${APP_NAME} | Support Operations Console`,
    template: `%s | ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
  keywords: [
    "support operations",
    "help desk",
    "customer support",
    "incident management",
    "ticketing system",
    "opsdesk",
  ],
  referrer: "origin-when-cross-origin",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "/",
    siteName: APP_NAME,
    title: `${APP_NAME} | Support Operations Console`,
    description: APP_DESCRIPTION,
    images: [
      {
        url: "/og-image.webp",
        width: 1200,
        height: 630,
        alt: "OpsDesk support operations workspace",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${APP_NAME} | Support Operations Console`,
    description: APP_DESCRIPTION,
    images: ["/og-image.webp"],
  },
  icons: {
    icon: [
      { url: "/favicon_io/favicon.ico", type: "image/x-icon" },
      { url: "/favicon_io/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon_io/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [{ url: "/favicon_io/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    shortcut: ["/favicon_io/favicon.ico"],
  },
  manifest: "/favicon_io/site.webmanifest",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex h-screen bg-background text-foreground">
        <RootLayoutShell>{children}</RootLayoutShell>
      </body>
    </html>
  );
}
