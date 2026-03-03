"use client";

import * as React from "react";
import { Inbox } from "lucide-react";
import { cn } from "./utils";

type EmptyStateProps = React.ComponentProps<"div"> & {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
};

function EmptyState({
  className,
  title,
  description,
  icon,
  action,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-6 py-12 text-center",
        className,
      )}
      {...props}
    >
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm">
        {icon ?? <Inbox className="h-5 w-5" />}
      </div>
      <p className="text-base font-semibold text-slate-900">{title}</p>
      {description ? (
        <p className="mt-1 max-w-md text-sm text-slate-600">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export { EmptyState };

