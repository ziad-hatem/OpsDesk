import { Badge } from "./ui/badge";
import { cn } from "./ui/utils";

interface StatusBadgeProps {
  status: string;
  className?: string;
}

type BadgeTone = {
  label: string;
  className: string;
};

const BADGE_CONFIG: Record<string, BadgeTone> = {
  // Common statuses
  active: { label: "Active", className: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" },
  inactive: { label: "Inactive", className: "bg-muted text-foreground hover:bg-muted" },
  suspended: { label: "Suspended", className: "bg-rose-100 text-rose-800 hover:bg-rose-100" },
  blocked: { label: "Blocked", className: "bg-red-100 text-red-800 hover:bg-red-100" },

  // Ticket / workflow statuses
  open: { label: "Open", className: "bg-blue-100 text-blue-800 hover:bg-blue-100" },
  pending: { label: "Pending", className: "bg-amber-100 text-amber-800 hover:bg-amber-100" },
  in_progress: { label: "In Progress", className: "bg-cyan-100 text-cyan-800 hover:bg-cyan-100" },
  resolved: { label: "Resolved", className: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" },
  closed: { label: "Closed", className: "bg-muted text-foreground hover:bg-muted" },

  // Incident statuses
  investigating: { label: "Investigating", className: "bg-red-100 text-red-800 hover:bg-red-100" },
  identified: { label: "Identified", className: "bg-orange-100 text-orange-800 hover:bg-orange-100" },
  monitoring: { label: "Monitoring", className: "bg-blue-100 text-blue-800 hover:bg-blue-100" },

  // Severity / priority
  urgent: { label: "Urgent", className: "bg-red-100 text-red-800 hover:bg-red-100" },
  high: { label: "High", className: "bg-orange-100 text-orange-800 hover:bg-orange-100" },
  medium: { label: "Medium", className: "bg-amber-100 text-amber-800 hover:bg-amber-100" },
  low: { label: "Low", className: "bg-muted text-foreground hover:bg-muted" },

  // Order / payment statuses
  draft: { label: "Draft", className: "bg-muted text-foreground hover:bg-muted" },
  unpaid: { label: "Unpaid", className: "bg-orange-100 text-orange-800 hover:bg-orange-100" },
  payment_link_sent: { label: "Link Sent", className: "bg-cyan-100 text-cyan-800 hover:bg-cyan-100" },
  paid: { label: "Paid", className: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" },
  fulfilled: { label: "Fulfilled", className: "bg-green-100 text-green-800 hover:bg-green-100" },
  completed: { label: "Completed", className: "bg-green-100 text-green-800 hover:bg-green-100" },
  failed: { label: "Failed", className: "bg-rose-100 text-rose-800 hover:bg-rose-100" },
  expired: { label: "Expired", className: "bg-neutral-200 text-neutral-800 hover:bg-neutral-200" },
  cancelled: { label: "Cancelled", className: "bg-red-100 text-red-800 hover:bg-red-100" },
  refunded: { label: "Refunded", className: "bg-indigo-100 text-indigo-800 hover:bg-indigo-100" },

  // Incident service health
  operational: { label: "Operational", className: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" },
  degraded: { label: "Degraded", className: "bg-amber-100 text-amber-800 hover:bg-amber-100" },
  partial_outage: { label: "Partial Outage", className: "bg-orange-100 text-orange-800 hover:bg-orange-100" },
  major_outage: { label: "Major Outage", className: "bg-red-100 text-red-800 hover:bg-red-100" },
  maintenance: { label: "Maintenance", className: "bg-blue-100 text-blue-800 hover:bg-blue-100" },
};

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function toLabel(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const key = normalizeKey(status);
  const config = BADGE_CONFIG[key] ?? {
    label: toLabel(key),
    className: "bg-muted text-foreground hover:bg-muted",
  };

  return (
    <Badge className={cn("font-medium", config.className, className)}>
      {config.label}
    </Badge>
  );
}


