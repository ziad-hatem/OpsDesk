"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner, ToasterProps } from "sonner";

const baseToastClassNames = {
  toast:
    "group toast group-[.toaster]:border-border/70 group-[.toaster]:bg-popover/95 group-[.toaster]:text-popover-foreground group-[.toaster]:shadow-lg",
  title: "group-[.toast]:text-foreground",
  description: "group-[.toast]:text-muted-foreground",
  actionButton:
    "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground group-[.toast]:hover:bg-primary/90",
  cancelButton:
    "group-[.toast]:border-border group-[.toast]:bg-background group-[.toast]:text-foreground group-[.toast]:hover:bg-muted",
  closeButton:
    "group-[.toast]:border-border/70 group-[.toast]:bg-background/80 group-[.toast]:text-muted-foreground group-[.toast]:hover:text-foreground",
  success:
    "group-[.toast]:border-emerald-500/35 group-[.toast]:bg-emerald-500/10 group-[.toast]:text-foreground",
  error:
    "group-[.toast]:border-destructive/45 group-[.toast]:bg-destructive/10 group-[.toast]:text-foreground",
  warning:
    "group-[.toast]:border-amber-500/35 group-[.toast]:bg-amber-500/10 group-[.toast]:text-foreground",
  info: "group-[.toast]:border-primary/35 group-[.toast]:bg-primary/10 group-[.toast]:text-foreground",
};

const Toaster = ({ toastOptions, ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();
  const mergedToastOptions: ToasterProps["toastOptions"] = {
    ...toastOptions,
    classNames: {
      ...baseToastClassNames,
      ...toastOptions?.classNames,
    },
  };

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={mergedToastOptions}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
