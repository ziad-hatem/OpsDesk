import { Card, CardContent } from "./ui/card";
import { LucideIcon } from "lucide-react";
import { cn } from "./ui/utils";

interface KPICardProps {
  title: string;
  value: string | number;
  change?: {
    value: number;
    type: "increase" | "decrease";
  };
  icon?: LucideIcon;
  trend?: "up" | "down" | "neutral";
}

export function KPICard({ title, value, change, icon: Icon, trend }: KPICardProps) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <p className="text-sm text-slate-600">{title}</p>
            <p className="text-3xl font-semibold text-slate-900">{value}</p>
            {change && (
              <div className="flex items-center gap-1">
                <span
                  className={cn(
                    "text-sm font-medium",
                    change.type === "increase" && trend !== "down" && "text-green-600",
                    change.type === "decrease" && trend !== "up" && "text-red-600",
                    trend === "neutral" && "text-slate-600"
                  )}
                >
                  {change.type === "increase" ? "+" : "-"}
                  {Math.abs(change.value)}%
                </span>
                <span className="text-sm text-slate-500">vs last period</span>
              </div>
            )}
          </div>
          {Icon && (
            <div className="p-2 bg-slate-100 rounded-lg">
              <Icon className="w-5 h-5 text-slate-700" />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
