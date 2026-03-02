"use client";
import { useState } from "react";
import { KPICard } from "./components/KPICard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { Button } from "./components/ui/button";
import { Calendar } from "./components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { DollarSign, AlertCircle, Ticket as TicketIcon, CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { DateRange } from "react-day-picker";

// Mock data
const mockChartData = [
  { date: "Jan 1", current: 4000, previous: 2400 },
  { date: "Jan 5", current: 3000, previous: 1398 },
  { date: "Jan 10", current: 2000, previous: 9800 },
  { date: "Jan 15", current: 2780, previous: 3908 },
  { date: "Jan 20", current: 1890, previous: 4800 },
  { date: "Jan 25", current: 2390, previous: 3800 },
  { date: "Jan 30", current: 3490, previous: 4300 },
];

export default function page() {
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: new Date(2026, 0, 1),
    to: new Date(2026, 0, 30),
  });

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900">Dashboard</h1>
          <p className="text-slate-600 mt-1">Welcome back! Here's what's happening today.</p>
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

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <KPICard
          title="Total Revenue"
          value="$45,231.89"
          change={{ value: 20.1, type: "increase" }}
          icon={DollarSign}
          trend="up"
        />
        <KPICard
          title="Open Tickets"
          value="127"
          change={{ value: 8.5, type: "increase" }}
          icon={TicketIcon}
          trend="neutral"
        />
        <KPICard
          title="SLA Breaches"
          value="3"
          change={{ value: 12.3, type: "decrease" }}
          icon={AlertCircle}
          trend="down"
        />
      </div>

      {/* Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Revenue Overview</CardTitle>
          <CardDescription>
            Comparing current period vs previous period
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={mockChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" stroke="#64748b" />
                <YAxis stroke="#64748b" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "white",
                    border: "1px solid #e2e8f0",
                    borderRadius: "8px",
                  }}
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
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Recent Orders</CardTitle>
            <CardDescription>Latest 5 orders from customers</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[
                { id: "ORD-001", customer: "Acme Corp", amount: "$1,234.56", status: "completed" },
                { id: "ORD-002", customer: "Globex Inc", amount: "$987.65", status: "pending" },
                { id: "ORD-003", customer: "Initech", amount: "$2,345.67", status: "completed" },
                { id: "ORD-004", customer: "Umbrella Corp", amount: "$567.89", status: "in_progress" },
                { id: "ORD-005", customer: "Stark Industries", amount: "$3,456.78", status: "completed" },
              ].map((order) => (
                <div key={order.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                  <div>
                    <p className="font-medium text-slate-900">{order.id}</p>
                    <p className="text-sm text-slate-600">{order.customer}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium text-slate-900">{order.amount}</p>
                    <p className="text-xs text-slate-600 capitalize">{order.status.replace("_", " ")}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>High Priority Tickets</CardTitle>
            <CardDescription>Tickets requiring immediate attention</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[
                { id: "TKT-456", title: "API integration failing", customer: "Acme Corp", priority: "urgent" },
                { id: "TKT-457", title: "Payment gateway timeout", customer: "Globex Inc", priority: "high" },
                { id: "TKT-458", title: "Dashboard not loading", customer: "Initech", priority: "high" },
                { id: "TKT-459", title: "Export feature broken", customer: "Umbrella Corp", priority: "urgent" },
                { id: "TKT-460", title: "Email notifications delayed", customer: "Stark Industries", priority: "high" },
              ].map((ticket) => (
                <div key={ticket.id} className="flex items-start justify-between py-2 border-b border-slate-100 last:border-0">
                  <div className="flex-1">
                    <p className="font-medium text-slate-900">{ticket.id}</p>
                    <p className="text-sm text-slate-700">{ticket.title}</p>
                    <p className="text-xs text-slate-600 mt-1">{ticket.customer}</p>
                  </div>
                  <span className={`text-xs font-medium px-2 py-1 rounded ${
                    ticket.priority === "urgent" ? "bg-red-100 text-red-800" : "bg-orange-100 text-orange-800"
                  }`}>
                    {ticket.priority}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
