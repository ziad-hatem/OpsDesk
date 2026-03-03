"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/app/components/ui/utils";

const SETTINGS_ITEMS = [
  { label: "Team", href: "/settings/team" },
  { label: "Activity", href: "/settings/activity" },
];

export default function SettingsNav() {
  const pathname = usePathname();

  return (
    <div className="inline-flex w-fit items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
      {SETTINGS_ITEMS.map((item) => {
        const isActive = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-slate-900 text-white"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
