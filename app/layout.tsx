import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "./components/ui/sonner";
import { Suspense } from "react";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="flex h-screen bg-slate-50">
        <Suspense>
          <main className="flex-1 overflow-auto">
            {children}
            <Toaster />
          </main>
        </Suspense>
      </body>
    </html>
  );
}
