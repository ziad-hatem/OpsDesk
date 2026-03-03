"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/app/components/ui/utils";

const SETTINGS_ITEMS = [
  { label: "Team", href: "/settings/team" },
  { label: "Roles", href: "/settings/roles" },
  { label: "SLA", href: "/settings/sla" },
  { label: "Automation", href: "/settings/automation" },
  { label: "Activity", href: "/settings/activity" },
];

export default function SettingsNav() {
  const pathname = usePathname();

  return (
    <div className="inline-flex w-fit items-center gap-1 rounded-lg border border-border bg-background p-1">
      {SETTINGS_ITEMS.map((item) => {
        const isActive = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}

