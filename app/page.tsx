"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { KPICard } from "./components/KPICard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { Button } from "./components/ui/button";
import { Calendar } from "./components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  DollarSign,
  AlertCircle,
  Ticket as TicketIcon,
  CalendarIcon,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";
import { toast } from "sonner";
import { useAppSelector } from "@/lib/store/hooks";
import { selectTopbarActiveOrganizationId } from "@/lib/store/slices/topbar-slice";
import type { DashboardResponse } from "@/lib/dashboard/types";
import { StatusBadge } from "./components/StatusBadge";

function formatMoney(cents: number, currency = "USD") {
  const normalizedCurrency = currency.trim().toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: normalizedCurrency,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${normalizedCurrency}`;
  }
}

function toTicketCode(ticketId: string) {
  return `TKT-${ticketId.slice(0, 8).toUpperCase()}`;
}

export default function DashboardPage() {
  const activeOrgId = useAppSelector(selectTopbarActiveOrganizationId);

  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - 29);
    return { from, to };
  });
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadDashboard = useCallback(async () => {
    if (!dateRange?.from || !dateRange?.to) {
      return;
    }

    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        from: dateRange.from.toISOString(),
        to: dateRange.to.toISOString(),
      });
      const response = await fetch(`/api/dashboard?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string };
        throw new Error(errorData.error ?? "Failed to load dashboard");
      }

      const payload = (await response.json()) as DashboardResponse;
      setDashboard(payload);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to load dashboard";
      toast.error(message);
      setDashboard(null);
    } finally {
      setIsLoading(false);
    }
  }, [dateRange?.from, dateRange?.to]);

  useEffect(() => {
    void loadDashboard();
  }, [activeOrgId, loadDashboard]);

  const chartData = useMemo(() => dashboard?.chart ?? [], [dashboard?.chart]);
  const slaComplianceTrend = useMemo(
    () => dashboard?.slaComplianceTrend ?? [],
    [dashboard?.slaComplianceTrend],
  );
  const recentOrders = useMemo(() => dashboard?.recentOrders ?? [], [dashboard?.recentOrders]);
  const highPriorityTickets = useMemo(
    () => dashboard?.highPriorityTickets ?? [],
    [dashboard?.highPriorityTickets],
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900">Dashboard</h1>
          <p className="text-slate-600 mt-1">
            Live metrics for your active organization.
          </p>
        </div>
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
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <KPICard
          title="Total Revenue"
          value={formatMoney(dashboard?.kpis.totalRevenueAmount ?? 0)}
          icon={DollarSign}
          trend="up"
        />
        <KPICard
          title="Open Tickets"
          value={dashboard?.kpis.openTicketsCount ?? 0}
          icon={TicketIcon}
          trend="neutral"
        />
        <KPICard
          title="SLA Breaches"
          value={dashboard?.kpis.slaBreachesCount ?? 0}
          icon={AlertCircle}
          trend="down"
        />
        <KPICard
          title="SLA Compliance"
          value={`${(dashboard?.kpis.slaComplianceRate ?? 100).toFixed(1)}%`}
          icon={ShieldCheck}
          trend="up"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Revenue Overview</CardTitle>
          <CardDescription>Current period vs previous period</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-[400px] flex items-center justify-center text-slate-500">
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              Loading chart...
            </div>
          ) : chartData.length === 0 ? (
            <div className="h-[400px] flex items-center justify-center text-slate-500">
              No revenue data for this date range.
            </div>
          ) : (
            <div className="h-[400px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" stroke="#64748b" />
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
                  <Line
                    type="monotone"
                    dataKey="previous"
                    stroke="#94a3b8"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    name="Previous Period"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>SLA Compliance Trend</CardTitle>
          <CardDescription>Daily resolved tickets vs SLA breaches</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-[260px] flex items-center justify-center text-slate-500">
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              Loading SLA trend...
            </div>
          ) : slaComplianceTrend.length === 0 ? (
            <div className="h-[260px] flex items-center justify-center text-slate-500">
              No SLA trend data for this date range.
            </div>
          ) : (
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={slaComplianceTrend}>
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Recent Orders</CardTitle>
            <CardDescription>Latest 5 orders from customers</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="py-10 flex items-center justify-center text-slate-500">
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Loading orders...
              </div>
            ) : recentOrders.length === 0 ? (
              <div className="py-10 text-center text-slate-500">No orders found.</div>
            ) : (
              <div className="space-y-4">
                {recentOrders.map((order) => (
                  <div
                    key={order.id}
                    className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0"
                  >
                    <div>
                      <p className="font-medium text-slate-900">{order.order_number}</p>
                      <p className="text-sm text-slate-600">{order.customer_name ?? "Unknown customer"}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-slate-900">
                        {formatMoney(order.total_amount, order.currency)}
                      </p>
                      <div className="mt-1">
                        <StatusBadge status={order.status} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>High Priority Tickets</CardTitle>
            <CardDescription>Tickets requiring immediate attention</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="py-10 flex items-center justify-center text-slate-500">
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Loading tickets...
              </div>
            ) : highPriorityTickets.length === 0 ? (
              <div className="py-10 text-center text-slate-500">
                No high priority open tickets.
              </div>
            ) : (
              <div className="space-y-4">
                {highPriorityTickets.map((ticket) => (
                  <div
                    key={ticket.id}
                    className="flex items-start justify-between py-2 border-b border-slate-100 last:border-0"
                  >
                    <div className="flex-1">
                      <p className="font-medium text-slate-900">{toTicketCode(ticket.id)}</p>
                      <p className="text-sm text-slate-700">{ticket.title}</p>
                      <p className="text-xs text-slate-600 mt-1">
                        {ticket.customer_name ?? "No customer linked"}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <StatusBadge status={ticket.priority} />
                      <StatusBadge status={ticket.status} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
