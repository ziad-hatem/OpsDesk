"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";
import { CalendarIcon, Download, Loader2, Plus, Trash2 } from "lucide-react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Calendar } from "../components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { Badge } from "../components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { useAppSelector } from "@/lib/store/hooks";
import { selectTopbarActiveOrganizationId } from "@/lib/store/slices/topbar-slice";
import type {
  ReportsCompareWith,
  ReportsMetricValue,
  ReportsResponse,
  ReportsScheduleFrequency,
  ReportsScheduleItem,
  ReportsScheduleRunItem,
  ReportsSchedulesResponse,
} from "@/lib/reports/types";

function formatMoney(cents: number) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} USD`;
  }
}

function toCsvSafe(value: string) {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function formatMinutes(value: number | null): string {
  if (value === null) {
    return "N/A";
  }
  if (value < 60) {
    return `${value.toFixed(1)}m`;
  }
  const hours = Math.floor(value / 60);
  const minutes = Math.round(value % 60);
  if (minutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${minutes}m`;
}

function formatPercent(value: number | null): string {
  if (value === null) {
    return "N/A";
  }
  return `${value.toFixed(1)}%`;
}

function formatCount(value: number | null): string {
  if (value === null) {
    return "N/A";
  }
  return String(Math.round(value));
}

function formatScheduleFrequency(value: ReportsScheduleFrequency): string {
  if (value === "daily") {
    return "Daily";
  }
  if (value === "weekly") {
    return "Weekly";
  }
  return "Monthly";
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "N/A";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "N/A";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function getMetricBaseline(metric: ReportsMetricValue, compareWith: ReportsCompareWith) {
  if (compareWith === "year") {
    return metric.year;
  }
  if (compareWith === "previous") {
    return metric.previous;
  }
  return null;
}

function getDeltaPercent(current: number | null, baseline: number | null): number | null {
  if (current === null || baseline === null) {
    return null;
  }
  if (baseline === 0) {
    return current === 0 ? 0 : null;
  }
  return ((current - baseline) / Math.abs(baseline)) * 100;
}

function formatTrendText(
  deltaPercent: number | null,
  compareWith: ReportsCompareWith,
): string {
  if (compareWith === "none") {
    return "Comparison hidden";
  }
  if (deltaPercent === null) {
    return "Not enough data for comparison";
  }
  if (deltaPercent === 0) {
    return "No change";
  }

  const label = compareWith === "year" ? "last year" : "last period";
  const sign = deltaPercent > 0 ? "+" : "";
  return `${sign}${deltaPercent.toFixed(1)}% vs ${label}`;
}

function getTrendClass(
  deltaPercent: number | null,
  direction: "higher-better" | "lower-better",
): string {
  if (deltaPercent === null || deltaPercent === 0) {
    return "text-slate-500";
  }
  const improved = direction === "higher-better" ? deltaPercent > 0 : deltaPercent < 0;
  return improved ? "text-green-600" : "text-red-600";
}

export default function ReportsPage() {
  const activeOrgId = useAppSelector(selectTopbarActiveOrganizationId);
  const initialScheduleForm = {
    name: "",
    frequency: "weekly" as ReportsScheduleFrequency,
    compareWith: "previous" as ReportsCompareWith,
    rangeDays: "30",
    timezone: "UTC",
    recipients: "",
  };

  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - 179);
    return { from, to };
  });
  const [compareWith, setCompareWith] = useState<ReportsCompareWith>("previous");
  const [reports, setReports] = useState<ReportsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [schedules, setSchedules] = useState<ReportsScheduleItem[]>([]);
  const [recentRuns, setRecentRuns] = useState<ReportsScheduleRunItem[]>([]);
  const [isSchedulesLoading, setIsSchedulesLoading] = useState(true);
  const [isScheduleDialogOpen, setIsScheduleDialogOpen] = useState(false);
  const [isSubmittingSchedule, setIsSubmittingSchedule] = useState(false);
  const [scheduleForm, setScheduleForm] = useState(initialScheduleForm);

  const loadReports = useCallback(async () => {
    if (!dateRange?.from || !dateRange?.to) {
      return;
    }

    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        from: dateRange.from.toISOString(),
        to: dateRange.to.toISOString(),
      });
      const response = await fetch(`/api/reports?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string };
        throw new Error(errorData.error ?? "Failed to load reports");
      }

      const payload = (await response.json()) as ReportsResponse;
      setReports(payload);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to load reports";
      toast.error(message);
      setReports(null);
    } finally {
      setIsLoading(false);
    }
  }, [dateRange?.from, dateRange?.to]);

  const loadSchedules = useCallback(async () => {
    if (!activeOrgId) {
      setSchedules([]);
      setRecentRuns([]);
      setIsSchedulesLoading(false);
      return;
    }

    setIsSchedulesLoading(true);
    try {
      const response = await fetch(`/api/orgs/${activeOrgId}/reports/schedules`, {
        method: "GET",
        cache: "no-store",
      });
      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string };
        throw new Error(errorData.error ?? "Failed to load report schedules");
      }
      const payload = (await response.json()) as ReportsSchedulesResponse;
      setSchedules(payload.schedules ?? []);
      setRecentRuns(payload.recentRuns ?? []);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to load report schedules";
      toast.error(message);
      setSchedules([]);
      setRecentRuns([]);
    } finally {
      setIsSchedulesLoading(false);
    }
  }, [activeOrgId]);

  useEffect(() => {
    if (!activeOrgId) {
      setReports(null);
      setIsLoading(false);
      return;
    }
    void loadReports();
  }, [activeOrgId, loadReports]);

  useEffect(() => {
    void loadSchedules();
  }, [loadSchedules]);

  const revenueData = useMemo(() => reports?.revenueTrend ?? [], [reports?.revenueTrend]);
  const ticketVolumeData = useMemo(() => reports?.ticketVolume ?? [], [reports?.ticketVolume]);
  const customerGrowthData = useMemo(() => reports?.customerGrowth ?? [], [reports?.customerGrowth]);
  const slaComplianceData = useMemo(
    () => reports?.slaComplianceTrend ?? [],
    [reports?.slaComplianceTrend],
  );

  const comparisonDataKey = compareWith === "year" ? "year" : "previous";
  const comparisonLabel = compareWith === "year" ? "Last Year" : "Previous Period";

  const metrics = reports?.metrics;

  const avgResponseBaseline = metrics
    ? getMetricBaseline(metrics.avgResponseTimeMinutes, compareWith)
    : null;
  const avgResponseDelta = metrics
    ? getDeltaPercent(metrics.avgResponseTimeMinutes.current, avgResponseBaseline)
    : null;

  const satisfactionBaseline = metrics
    ? getMetricBaseline(metrics.customerSatisfactionScore, compareWith)
    : null;
  const satisfactionDelta = metrics
    ? getDeltaPercent(metrics.customerSatisfactionScore.current, satisfactionBaseline)
    : null;

  const fcrBaseline = metrics
    ? getMetricBaseline(metrics.firstContactResolutionRate, compareWith)
    : null;
  const fcrDelta = metrics
    ? getDeltaPercent(metrics.firstContactResolutionRate.current, fcrBaseline)
    : null;

  const backlogBaseline = metrics
    ? getMetricBaseline(metrics.ticketBacklogCount, compareWith)
    : null;
  const backlogDelta = metrics
    ? getDeltaPercent(metrics.ticketBacklogCount.current, backlogBaseline)
    : null;
  const slaComplianceBaseline = metrics
    ? getMetricBaseline(metrics.slaComplianceRate, compareWith)
    : null;
  const slaComplianceDelta = metrics
    ? getDeltaPercent(metrics.slaComplianceRate.current, slaComplianceBaseline)
    : null;
  const avgResolutionBaseline = metrics
    ? getMetricBaseline(metrics.avgResolutionTimeMinutes, compareWith)
    : null;
  const avgResolutionDelta = metrics
    ? getDeltaPercent(metrics.avgResolutionTimeMinutes.current, avgResolutionBaseline)
    : null;
  const incidentMttrBaseline = metrics
    ? getMetricBaseline(metrics.incidentMttrMinutes, compareWith)
    : null;
  const incidentMttrDelta = metrics
    ? getDeltaPercent(metrics.incidentMttrMinutes.current, incidentMttrBaseline)
    : null;

  const handleCreateSchedule = async () => {
    if (!activeOrgId) {
      return;
    }
    setIsSubmittingSchedule(true);
    try {
      const response = await fetch(`/api/orgs/${activeOrgId}/reports/schedules`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: scheduleForm.name,
          frequency: scheduleForm.frequency,
          compareWith: scheduleForm.compareWith,
          rangeDays: Number(scheduleForm.rangeDays),
          timezone: scheduleForm.timezone,
          recipients: scheduleForm.recipients
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
        }),
      });
      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string };
        throw new Error(errorData.error ?? "Failed to create schedule");
      }

      toast.success("Report schedule created");
      setIsScheduleDialogOpen(false);
      setScheduleForm(initialScheduleForm);
      await loadSchedules();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to create schedule";
      toast.error(message);
    } finally {
      setIsSubmittingSchedule(false);
    }
  };

  const handleToggleSchedule = async (schedule: ReportsScheduleItem, checked: boolean) => {
    if (!activeOrgId) {
      return;
    }
    try {
      const response = await fetch(
        `/api/orgs/${activeOrgId}/reports/schedules/${schedule.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ isEnabled: checked }),
        },
      );
      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string };
        throw new Error(errorData.error ?? "Failed to update schedule");
      }
      setSchedules((current) =>
        current.map((item) =>
          item.id === schedule.id ? { ...item, is_enabled: checked } : item,
        ),
      );
      toast.success("Schedule updated");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to update schedule";
      toast.error(message);
    }
  };

  const handleDeleteSchedule = async (schedule: ReportsScheduleItem) => {
    if (!activeOrgId) {
      return;
    }
    try {
      const response = await fetch(
        `/api/orgs/${activeOrgId}/reports/schedules/${schedule.id}`,
        {
          method: "DELETE",
        },
      );
      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string };
        throw new Error(errorData.error ?? "Failed to delete schedule");
      }
      setSchedules((current) => current.filter((item) => item.id !== schedule.id));
      toast.success("Schedule deleted");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to delete schedule";
      toast.error(message);
    }
  };

  const handleExportCsv = () => {
    if (!reports) {
      toast.error("No report data to export");
      return;
    }

    const metricRows = [
      [
        "Avg Response Time (min)",
        reports.metrics.avgResponseTimeMinutes.current?.toFixed(1) ?? "",
        reports.metrics.avgResponseTimeMinutes.previous?.toFixed(1) ?? "",
        reports.metrics.avgResponseTimeMinutes.year?.toFixed(1) ?? "",
      ],
      [
        "Avg Resolution Time (min)",
        reports.metrics.avgResolutionTimeMinutes.current?.toFixed(1) ?? "",
        reports.metrics.avgResolutionTimeMinutes.previous?.toFixed(1) ?? "",
        reports.metrics.avgResolutionTimeMinutes.year?.toFixed(1) ?? "",
      ],
      [
        "Incident MTTR (min)",
        reports.metrics.incidentMttrMinutes.current?.toFixed(1) ?? "",
        reports.metrics.incidentMttrMinutes.previous?.toFixed(1) ?? "",
        reports.metrics.incidentMttrMinutes.year?.toFixed(1) ?? "",
      ],
      [
        "Customer Satisfaction Proxy (%)",
        reports.metrics.customerSatisfactionScore.current?.toFixed(1) ?? "",
        reports.metrics.customerSatisfactionScore.previous?.toFixed(1) ?? "",
        reports.metrics.customerSatisfactionScore.year?.toFixed(1) ?? "",
      ],
      [
        "First Contact Resolution (%)",
        reports.metrics.firstContactResolutionRate.current?.toFixed(1) ?? "",
        reports.metrics.firstContactResolutionRate.previous?.toFixed(1) ?? "",
        reports.metrics.firstContactResolutionRate.year?.toFixed(1) ?? "",
      ],
      [
        "Ticket Backlog",
        reports.metrics.ticketBacklogCount.current?.toFixed(0) ?? "",
        reports.metrics.ticketBacklogCount.previous?.toFixed(0) ?? "",
        reports.metrics.ticketBacklogCount.year?.toFixed(0) ?? "",
      ],
      [
        "SLA Compliance (%)",
        reports.metrics.slaComplianceRate.current?.toFixed(1) ?? "",
        reports.metrics.slaComplianceRate.previous?.toFixed(1) ?? "",
        reports.metrics.slaComplianceRate.year?.toFixed(1) ?? "",
      ],
    ];

    const rows: string[][] = [
      ["Revenue Trend"],
      ["Month", "Current", "Previous Period", "Last Year"],
      ...reports.revenueTrend.map((point) => [
        point.label,
        String(point.current),
        String(point.previous),
        String(point.year),
      ]),
      [""],
      ["Ticket Volume"],
      ["Day", "Created", "Resolved"],
      ...reports.ticketVolume.map((point) => [
        point.day,
        String(point.tickets),
        String(point.resolved),
      ]),
      [""],
      ["Customer Growth"],
      ["Month", "Active Customers"],
      ...reports.customerGrowth.map((point) => [
        point.month,
        String(point.customers),
      ]),
      [""],
      ["SLA Compliance Trend"],
      ["Month", "Resolved", "Breaches", "Compliance (%)"],
      ...reports.slaComplianceTrend.map((point) => [
        point.label,
        String(point.resolved),
        String(point.breaches),
        point.compliance.toFixed(1),
      ]),
      [""],
      ["Key Metrics"],
      ["Metric", "Current", "Previous Period", "Last Year"],
      ...metricRows,
    ];

    const csv = rows.map((row) => row.map((value) => toCsvSafe(value)).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `reports-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  if (!activeOrgId) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-6 text-slate-600">
            Select or create an organization to view reports.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900">Analytics</h1>
          <p className="text-slate-600 mt-1">Insights and performance metrics</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={compareWith}
            onValueChange={(value) => setCompareWith(value as ReportsCompareWith)}
          >
            <SelectTrigger className="w-[180px] focus:ring-2 focus:ring-slate-900">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="previous">vs Previous Period</SelectItem>
              <SelectItem value="year">vs Last Year</SelectItem>
              <SelectItem value="none">No Comparison</SelectItem>
            </SelectContent>
          </Select>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="gap-2 focus:ring-2 focus:ring-slate-900">
                <CalendarIcon className="w-4 h-4" />
                {dateRange?.from ? (
                  dateRange.to ? (
                    <>
                      {format(dateRange.from, "LLL dd, y")} -{" "}
                      {format(dateRange.to, "LLL dd, y")}
                    </>
                  ) : (
                    format(dateRange.from, "LLL dd, y")
                  )
                ) : (
                  <span>Pick a date</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                initialFocus
                mode="range"
                defaultMonth={dateRange?.from}
                selected={dateRange}
                onSelect={setDateRange}
                numberOfMonths={2}
              />
            </PopoverContent>
          </Popover>
          <Button
            variant="outline"
            className="gap-2 focus:ring-2 focus:ring-slate-900"
            onClick={handleExportCsv}
            disabled={isLoading || !reports}
          >
            <Download className="w-4 h-4" />
            Export CSV
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Scheduled Executive Reports</CardTitle>
            <CardDescription>
              Auto-deliver KPI summaries (SLA, CSAT, revenue, resolution, MTTR) to leadership.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => setIsScheduleDialogOpen(true)}
          >
            <Plus className="h-4 w-4" />
            New Schedule
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {isSchedulesLoading ? (
            <div className="flex items-center text-slate-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading schedules...
            </div>
          ) : schedules.length === 0 ? (
            <p className="text-sm text-slate-600">
              No schedules yet. Create one to email executive analytics automatically.
            </p>
          ) : (
            <div className="space-y-3">
              {schedules.map((schedule) => (
                <div
                  key={schedule.id}
                  className="rounded-lg border border-slate-200 bg-slate-50/70 p-3"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-slate-900">{schedule.name}</p>
                        <Badge variant={schedule.is_enabled ? "default" : "outline"}>
                          {schedule.is_enabled ? "Enabled" : "Disabled"}
                        </Badge>
                        <Badge variant="outline">
                          {formatScheduleFrequency(schedule.frequency)}
                        </Badge>
                        <Badge variant="outline">{schedule.range_days}d range</Badge>
                      </div>
                      <p className="text-xs text-slate-600">
                        Next run: {formatDateTime(schedule.next_run_at)} | Last run:{" "}
                        {formatDateTime(schedule.last_run_at)}
                      </p>
                      <p className="text-xs text-slate-500">
                        Recipients: {schedule.recipients.join(", ")}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2 text-xs text-slate-600">
                        <Switch
                          checked={schedule.is_enabled}
                          onCheckedChange={(checked) => {
                            void handleToggleSchedule(schedule, checked);
                          }}
                        />
                        Active
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          void handleDeleteSchedule(schedule);
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {recentRuns.length > 0 ? (
            <div className="border-t border-slate-200 pt-4">
              <p className="mb-2 text-sm font-medium text-slate-800">Recent Deliveries</p>
              <div className="space-y-2">
                {recentRuns.slice(0, 5).map((run) => (
                  <div
                    key={run.id}
                    className="flex flex-col gap-1 rounded-md border border-slate-200 p-2 text-xs sm:flex-row sm:items-center sm:justify-between"
                  >
                    <p className="text-slate-700">
                      {run.status === "success" ? "Delivered" : "Failed"} |{" "}
                      {formatDateTime(run.created_at)}
                    </p>
                    <p className="text-slate-500">
                      {run.recipients.length} recipient(s)
                      {run.error_message ? ` | ${run.error_message}` : ""}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={isScheduleDialogOpen} onOpenChange={setIsScheduleDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Executive Report Schedule</DialogTitle>
            <DialogDescription>
              Configure recurring KPI delivery for leaders and stakeholders.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="schedule-name">Name</Label>
              <Input
                id="schedule-name"
                value={scheduleForm.name}
                onChange={(event) =>
                  setScheduleForm((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="Weekly leadership digest"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Frequency</Label>
                <Select
                  value={scheduleForm.frequency}
                  onValueChange={(value) =>
                    setScheduleForm((current) => ({
                      ...current,
                      frequency: value as ReportsScheduleFrequency,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Comparison</Label>
                <Select
                  value={scheduleForm.compareWith}
                  onValueChange={(value) =>
                    setScheduleForm((current) => ({
                      ...current,
                      compareWith: value as ReportsCompareWith,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="previous">Previous period</SelectItem>
                    <SelectItem value="year">Last year</SelectItem>
                    <SelectItem value="none">No comparison</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="schedule-range">Range (days)</Label>
                <Input
                  id="schedule-range"
                  type="number"
                  min={1}
                  max={365}
                  value={scheduleForm.rangeDays}
                  onChange={(event) =>
                    setScheduleForm((current) => ({
                      ...current,
                      rangeDays: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="schedule-timezone">Timezone</Label>
                <Input
                  id="schedule-timezone"
                  value={scheduleForm.timezone}
                  onChange={(event) =>
                    setScheduleForm((current) => ({ ...current, timezone: event.target.value }))
                  }
                  placeholder="UTC"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="schedule-recipients">Recipients (comma separated)</Label>
              <Input
                id="schedule-recipients"
                value={scheduleForm.recipients}
                onChange={(event) =>
                  setScheduleForm((current) => ({
                    ...current,
                    recipients: event.target.value,
                  }))
                }
                placeholder="ceo@company.com, ops@company.com"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsScheduleDialogOpen(false);
              }}
              disabled={isSubmittingSchedule}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                void handleCreateSchedule();
              }}
              disabled={isSubmittingSchedule}
            >
              {isSubmittingSchedule ? "Creating..." : "Create Schedule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle>Revenue Trend</CardTitle>
          <CardDescription>
            Monthly revenue comparison with selected baseline
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-[400px] flex items-center justify-center text-slate-500">
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              Loading chart...
            </div>
          ) : revenueData.length === 0 ? (
            <div className="h-[400px] flex items-center justify-center text-slate-500">
              No revenue data for this range.
            </div>
          ) : (
            <div className="h-[400px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={revenueData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" stroke="#64748b" />
                  <YAxis stroke="#64748b" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "white",
                      border: "1px solid #e2e8f0",
                      borderRadius: "8px",
                    }}
                    formatter={(value: number) => formatMoney(value)}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="current"
                    stroke="#0f172a"
                    strokeWidth={2}
                    name="Current Period"
                  />
                  {compareWith !== "none" && (
                    <Line
                      type="monotone"
                      dataKey={comparisonDataKey}
                      stroke="#94a3b8"
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      name={comparisonLabel}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Ticket Volume</CardTitle>
            <CardDescription>Weekly ticket creation vs resolution</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-[300px] flex items-center justify-center text-slate-500">
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Loading ticket volume...
              </div>
            ) : ticketVolumeData.length === 0 ? (
              <div className="h-[300px] flex items-center justify-center text-slate-500">
                No ticket activity in this range.
              </div>
            ) : (
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={ticketVolumeData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="day" stroke="#64748b" />
                    <YAxis stroke="#64748b" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "white",
                        border: "1px solid #e2e8f0",
                        borderRadius: "8px",
                      }}
                    />
                    <Legend />
                    <Bar dataKey="tickets" fill="#0f172a" name="Created" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="resolved" fill="#94a3b8" name="Resolved" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Customer Growth</CardTitle>
            <CardDescription>Total active customers by month</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-[300px] flex items-center justify-center text-slate-500">
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Loading customer growth...
              </div>
            ) : customerGrowthData.length === 0 ? (
              <div className="h-[300px] flex items-center justify-center text-slate-500">
                No customer data in this range.
              </div>
            ) : (
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={customerGrowthData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="month" stroke="#64748b" />
                    <YAxis stroke="#64748b" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "white",
                        border: "1px solid #e2e8f0",
                        borderRadius: "8px",
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="customers"
                      stroke="#0f172a"
                      strokeWidth={2}
                      name="Customers"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>SLA Compliance Trend</CardTitle>
          <CardDescription>
            Monthly percentage of resolved tickets that met SLA targets
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-[300px] flex items-center justify-center text-slate-500">
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              Loading SLA trend...
            </div>
          ) : slaComplianceData.length === 0 ? (
            <div className="h-[300px] flex items-center justify-center text-slate-500">
              No SLA data in this range.
            </div>
          ) : (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={slaComplianceData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" stroke="#64748b" />
                  <YAxis stroke="#64748b" domain={[0, 100]} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "white",
                      border: "1px solid #e2e8f0",
                      borderRadius: "8px",
                    }}
                    formatter={(value: number) => `${value.toFixed(1)}%`}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="compliance"
                    stroke="#0f172a"
                    strokeWidth={2}
                    name="Compliance %"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-slate-600 mb-1">Avg Response Time</p>
            <p className="text-2xl font-semibold text-slate-900">
              {formatMinutes(metrics?.avgResponseTimeMinutes.current ?? null)}
            </p>
            <p className={`text-xs mt-1 ${getTrendClass(avgResponseDelta, "lower-better")}`}>
              {formatTrendText(avgResponseDelta, compareWith)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-slate-600 mb-1">Avg Resolution Time</p>
            <p className="text-2xl font-semibold text-slate-900">
              {formatMinutes(metrics?.avgResolutionTimeMinutes.current ?? null)}
            </p>
            <p className={`text-xs mt-1 ${getTrendClass(avgResolutionDelta, "lower-better")}`}>
              {formatTrendText(avgResolutionDelta, compareWith)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-slate-600 mb-1">Incident MTTR</p>
            <p className="text-2xl font-semibold text-slate-900">
              {formatMinutes(metrics?.incidentMttrMinutes.current ?? null)}
            </p>
            <p className={`text-xs mt-1 ${getTrendClass(incidentMttrDelta, "lower-better")}`}>
              {formatTrendText(incidentMttrDelta, compareWith)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-slate-600 mb-1">Customer Satisfaction</p>
            <p className="text-2xl font-semibold text-slate-900">
              {formatPercent(metrics?.customerSatisfactionScore.current ?? null)}
            </p>
            <p className={`text-xs mt-1 ${getTrendClass(satisfactionDelta, "higher-better")}`}>
              {formatTrendText(satisfactionDelta, compareWith)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-slate-600 mb-1">First Contact Resolution</p>
            <p className="text-2xl font-semibold text-slate-900">
              {formatPercent(metrics?.firstContactResolutionRate.current ?? null)}
            </p>
            <p className={`text-xs mt-1 ${getTrendClass(fcrDelta, "higher-better")}`}>
              {formatTrendText(fcrDelta, compareWith)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-slate-600 mb-1">Ticket Backlog</p>
            <p className="text-2xl font-semibold text-slate-900">
              {formatCount(metrics?.ticketBacklogCount.current ?? null)}
            </p>
            <p className={`text-xs mt-1 ${getTrendClass(backlogDelta, "lower-better")}`}>
              {formatTrendText(backlogDelta, compareWith)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-slate-600 mb-1">SLA Compliance</p>
            <p className="text-2xl font-semibold text-slate-900">
              {formatPercent(metrics?.slaComplianceRate.current ?? null)}
            </p>
            <p className={`text-xs mt-1 ${getTrendClass(slaComplianceDelta, "higher-better")}`}>
              {formatTrendText(slaComplianceDelta, compareWith)}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
