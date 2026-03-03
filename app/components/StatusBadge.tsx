import { Badge } from "./ui/badge";
import { cn } from "./ui/utils";

type StatusType =
  | "active"
  | "inactive"
  | "blocked"
  | "draft"
  | "unpaid"
  | "payment_link_sent"
  | "failed"
  | "expired"
  | "pending"
  | "paid"
  | "fulfilled"
  | "completed"
  | "cancelled"
  | "refunded"
  | "open"
  | "resolved"
  | "closed"
  | "in_progress"
  | "high"
  | "medium"
  | "low"
  | "urgent";

interface StatusBadgeProps {
  status: StatusType | string;
  className?: string;
}

const statusConfig: Record<string, { label: string; variant: string; className: string }> = {
  active: { label: "Active", variant: "default", className: "bg-green-100 text-green-800 hover:bg-green-100" },
  inactive: { label: "Inactive", variant: "secondary", className: "bg-slate-100 text-slate-800 hover:bg-slate-100" },
  blocked: { label: "Blocked", variant: "secondary", className: "bg-red-100 text-red-800 hover:bg-red-100" },
  draft: { label: "Draft", variant: "secondary", className: "bg-slate-100 text-slate-700 hover:bg-slate-100" },
  unpaid: { label: "Unpaid", variant: "secondary", className: "bg-orange-100 text-orange-800 hover:bg-orange-100" },
  payment_link_sent: { label: "Link Sent", variant: "secondary", className: "bg-cyan-100 text-cyan-800 hover:bg-cyan-100" },
  failed: { label: "Failed", variant: "secondary", className: "bg-rose-100 text-rose-800 hover:bg-rose-100" },
  expired: { label: "Expired", variant: "secondary", className: "bg-neutral-200 text-neutral-800 hover:bg-neutral-200" },
  pending: { label: "Pending", variant: "secondary", className: "bg-amber-100 text-amber-800 hover:bg-amber-100" },
  paid: { label: "Paid", variant: "default", className: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" },
  fulfilled: { label: "Fulfilled", variant: "default", className: "bg-green-100 text-green-800 hover:bg-green-100" },
  completed: { label: "Completed", variant: "default", className: "bg-green-100 text-green-800 hover:bg-green-100" },
  cancelled: { label: "Cancelled", variant: "secondary", className: "bg-red-100 text-red-800 hover:bg-red-100" },
  refunded: { label: "Refunded", variant: "secondary", className: "bg-indigo-100 text-indigo-800 hover:bg-indigo-100" },
  open: { label: "Open", variant: "default", className: "bg-blue-100 text-blue-800 hover:bg-blue-100" },
  resolved: { label: "Resolved", variant: "default", className: "bg-green-100 text-green-800 hover:bg-green-100" },
  closed: { label: "Closed", variant: "secondary", className: "bg-slate-100 text-slate-800 hover:bg-slate-100" },
  in_progress: { label: "In Progress", variant: "default", className: "bg-amber-100 text-amber-800 hover:bg-amber-100" },
  high: { label: "High", variant: "default", className: "bg-orange-100 text-orange-800 hover:bg-orange-100" },
  medium: { label: "Medium", variant: "default", className: "bg-yellow-100 text-yellow-800 hover:bg-yellow-100" },
  low: { label: "Low", variant: "secondary", className: "bg-slate-100 text-slate-800 hover:bg-slate-100" },
  urgent: { label: "Urgent", variant: "default", className: "bg-red-100 text-red-800 hover:bg-red-100" },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status] || {
    label: status,
    variant: "secondary",
    className: "bg-slate-100 text-slate-800 hover:bg-slate-100",
  };

  return (
    <Badge className={cn("font-medium", config.className, className)}>
      {config.label}
    </Badge>
  );
}
