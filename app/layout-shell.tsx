"use client";

import { Suspense, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { AppSidebar } from "./components/AppSidebar";
import { Topbar } from "./components/Topbar";
import { ThemeToggle } from "./components/ThemeToggle";
import { SidebarInset, SidebarProvider } from "./components/ui/sidebar";
import { Toaster } from "./components/ui/sonner";
import { AppProviders } from "./providers";

const PUBLIC_AUTH_ROUTES = new Set([
  "/login",
  "/register",
  "/verify",
  "/forgot-password",
  "/reset-password",
  "/auth/magic-link",
  "/payment/thank-you",
]);

function LayoutShell({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const router = useRouter();
  const pathname = usePathname();
  const { status } = useSession();

  const isPublicAuthRoute = pathname ? PUBLIC_AUTH_ROUTES.has(pathname) : false;
  const isInviteRoute = pathname ? pathname.startsWith("/invite/") : false;
  const isPortalRoute = pathname ? pathname.startsWith("/portal") : false;
  const isPublicStatusRoute = pathname ? pathname.startsWith("/status/") : false;
  const isPublicRoute =
    isPublicAuthRoute || isInviteRoute || isPortalRoute || isPublicStatusRoute;

  useEffect(() => {
    if (status === "loading") {
      return;
    }

    if (!isPublicRoute && status === "unauthenticated") {
      router.replace("/login");
      return;
    }

    if (isPublicAuthRoute && status === "authenticated") {
      router.replace("/");
    }
  }, [isPublicAuthRoute, isPublicRoute, router, status]);

  if (!isPublicRoute && status === "loading") {
    return (
      <main className="flex flex-1 items-center justify-center bg-background text-muted-foreground">
        <span className="inline-flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading workspace...
        </span>
      </main>
    );
  }

  if (!isPublicRoute && status !== "authenticated") {
    return null;
  }

  if (isPublicRoute) {
    return (
      <main className="relative flex-1 overflow-auto">
        <div className="fixed top-4 right-4 z-40">
          <ThemeToggle />
        </div>
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
        <main className="workspace-main flex-1 overflow-auto">
          {children}
          <Toaster />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

export function RootLayoutShell({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <AppProviders>
      <Suspense>
        <LayoutShell>{children}</LayoutShell>
      </Suspense>
    </AppProviders>
  );
}
