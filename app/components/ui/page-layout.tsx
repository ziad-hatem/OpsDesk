"use client";

import * as React from "react";
import { cn } from "./utils";

function PageShell({
  className,
  ...props
}: React.ComponentProps<"section">) {
  return (
    <section
      className={cn("mx-auto w-full max-w-screen-2xl space-y-6 p-6", className)}
      {...props}
    />
  );
}

function PageHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 border-b border-border/80 pb-4 md:flex-row md:items-end md:justify-between",
        className,
      )}
      {...props}
    />
  );
}

function PageTitle({
  className,
  ...props
}: React.ComponentProps<"h1">) {
  return (
    <h1
      className={cn("text-3xl font-semibold tracking-tight text-foreground", className)}
      {...props}
    />
  );
}

function PageDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p className={cn("text-sm text-muted-foreground", className)} {...props} />
  );
}

function StickyActionBar({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "sticky top-0 z-20 -mx-1 rounded-xl border border-border bg-background/90 p-3 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/80",
        className,
      )}
      {...props}
    />
  );
}

export { PageShell, PageHeader, PageTitle, PageDescription, StickyActionBar };


