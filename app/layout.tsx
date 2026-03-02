"use client";
import { Suspense, useEffect } from "react";
import { SidebarInset, SidebarProvider } from "./components/ui/sidebar";
import { Toaster } from "./components/ui/sonner";
import "./globals.css";
import { AppProviders } from "./providers";
import { usePathname, useRouter } from "next/navigation";
import { Topbar } from "./components/Topbar";
import { useSession } from "next-auth/react";
import { AppSidebar } from "./components/AppSidebar";

const PUBLIC_AUTH_ROUTES = new Set([
  "/login",
  "/register",
  "/verify",
  "/forgot-password",
  "/reset-password",
]);

function LayoutShell({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const router = useRouter();
  const pathname = usePathname();
  const { status } = useSession();

  const isPublicAuthRoute = pathname
    ? PUBLIC_AUTH_ROUTES.has(pathname)
    : false;

  useEffect(() => {
    if (status === "loading") {
      return;
    }

    if (!isPublicAuthRoute && status === "unauthenticated") {
      router.replace("/login");
      return;
    }

    if (isPublicAuthRoute && status === "authenticated") {
      router.replace("/");
    }
  }, [isPublicAuthRoute, router, status]);

  if (!isPublicAuthRoute && status !== "authenticated") {
    return null;
  }

  if (isPublicAuthRoute) {
    return (
      <main className="flex-1 overflow-auto">
        {children}
        <Toaster />
      </main>
    );
  }

  return (
    <SidebarProvider defaultOpen>
      <AppSidebar />
      <SidebarInset className="overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-auto">
          {children}
          <Toaster />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="flex h-screen bg-slate-50">
        <AppProviders>
          <Suspense>
            <LayoutShell>{children}</LayoutShell>
          </Suspense>
        </AppProviders>
      </body>
    </html>
  );
}
