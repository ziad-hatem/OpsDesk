"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { addDays, format, isBefore, startOfDay } from "date-fns";
import { Calendar as CalendarIcon, Loader2, ShoppingCart, Ticket } from "lucide-react";
import { toast } from "sonner";
import { useAppSelector } from "@/lib/store/hooks";
import { selectTopbarActiveOrganizationId } from "@/lib/store/slices/topbar-slice";
import type { OrdersListResponse, OrderListItem } from "@/lib/orders/types";
import type { TicketListItem, TicketsListResponse } from "@/lib/tickets/types";
import { Calendar } from "../components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { StatusBadge } from "../components/StatusBadge";

type CalendarEvent = {
  id: string;
  type: "ticket" | "order";
  title: string;
  subtitle: string;
  status: string;
  priority: string | null;
  at: string;
  href: string;
};

function toDayKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function parseIsoDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dayKeyToDate(dayKey: string): Date {
  const [year, month, day] = dayKey.split("-").map((part) => Number(part));
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

function formatDateTime(isoDate: string): string {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }
  return format(parsed, "PPp");
}

async function readApiError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload.error) {
      return payload.error;
    }
  } catch {
    // Ignore parse errors and fallback.
  }
  return response.statusText || `Request failed with status ${response.status}`;
}

function mapTicketToEvent(ticket: TicketListItem): CalendarEvent | null {
  const eventDate = parseIsoDate(ticket.sla_due_at);
  if (!eventDate) {
    return null;
  }

  return {
    id: `ticket-${ticket.id}`,
    type: "ticket",
    title: ticket.title,
    subtitle: ticket.customer?.name ?? "No customer",
    status: ticket.status,
    priority: ticket.priority,
    at: eventDate.toISOString(),
    href: `/tickets/${ticket.id}`,
  };
}

function mapOrderToEvent(order: OrderListItem): CalendarEvent {
  const baseDate =
    parseIsoDate(order.placed_at) ??
    parseIsoDate(order.created_at) ??
    new Date();

  return {
    id: `order-${order.id}`,
    type: "order",
    title: order.order_number,
    subtitle: order.customer?.name ?? "No customer",
    status: order.status,
    priority: null,
    at: baseDate.toISOString(),
    href: `/orders/${order.id}`,
  };
}

export default function CalendarPage() {
  const router = useRouter();
  const activeOrgId = useAppSelector(selectTopbarActiveOrganizationId);

  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadCalendarData = useCallback(async () => {
    if (!activeOrgId) {
      setEvents([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const [ticketsResponse, ordersResponse] = await Promise.all([
        fetch("/api/tickets", { method: "GET", cache: "no-store" }),
        fetch("/api/orders?limit=500", { method: "GET", cache: "no-store" }),
      ]);

      if (!ticketsResponse.ok) {
        throw new Error(await readApiError(ticketsResponse));
      }
      if (!ordersResponse.ok) {
        throw new Error(await readApiError(ordersResponse));
      }

      const ticketsPayload = (await ticketsResponse.json()) as TicketsListResponse;
      const ordersPayload = (await ordersResponse.json()) as OrdersListResponse;

      const ticketEvents = (ticketsPayload.tickets ?? [])
        .map(mapTicketToEvent)
        .filter((event): event is CalendarEvent => event !== null);
      const orderEvents = (ordersPayload.orders ?? []).map(mapOrderToEvent);

      const merged = [...ticketEvents, ...orderEvents].sort((a, b) =>
        a.at.localeCompare(b.at),
      );
      setEvents(merged);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to load calendar data";
      toast.error(message);
      setEvents([]);
    } finally {
      setIsLoading(false);
    }
  }, [activeOrgId]);

  useEffect(() => {
    void loadCalendarData();
  }, [loadCalendarData]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      const dayKey = toDayKey(new Date(event.at));
      const existing = map.get(dayKey) ?? [];
      existing.push(event);
      map.set(dayKey, existing);
    }
    return map;
  }, [events]);

  const selectedDayKey = useMemo(() => toDayKey(selectedDate), [selectedDate]);
  const selectedDayEvents = useMemo(
    () =>
      [...(eventsByDay.get(selectedDayKey) ?? [])].sort((a, b) =>
        a.at.localeCompare(b.at),
      ),
    [eventsByDay, selectedDayKey],
  );

  const eventDays = useMemo(
    () => Array.from(eventsByDay.keys()).map(dayKeyToDate),
    [eventsByDay],
  );

  const todayKey = toDayKey(new Date());
  const todayEventsCount = eventsByDay.get(todayKey)?.length ?? 0;
  const overdueTicketsCount = events.filter((event) => {
    if (event.type !== "ticket") {
      return false;
    }
    const eventDate = parseIsoDate(event.at);
    if (!eventDate) {
      return false;
    }
    return (
      (event.status === "open" || event.status === "pending") &&
      isBefore(startOfDay(eventDate), startOfDay(new Date()))
    );
  }).length;
  const nextSevenDaysCount = events.filter((event) => {
    const eventDate = parseIsoDate(event.at);
    if (!eventDate) {
      return false;
    }
    const now = startOfDay(new Date());
    const nextWeek = addDays(now, 7);
    return !isBefore(startOfDay(eventDate), now) && isBefore(startOfDay(eventDate), nextWeek);
  }).length;

  if (!activeOrgId) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-6 text-slate-600">
            Select or create an organization to view calendar events.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-slate-900">Calendar</h1>
        <p className="text-slate-600 mt-1">
          Track SLA due tickets and order activity by date.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-slate-600">Events Today</p>
            <p className="text-2xl font-semibold text-slate-900 mt-1">{todayEventsCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-slate-600">Overdue Tickets</p>
            <p className="text-2xl font-semibold text-slate-900 mt-1">{overdueTicketsCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-slate-600">Next 7 Days</p>
            <p className="text-2xl font-semibold text-slate-900 mt-1">{nextSevenDaysCount}</p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarIcon className="h-4 w-4" />
              Date Picker
            </CardTitle>
            <CardDescription>Days with events are highlighted.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="py-10 flex items-center justify-center text-slate-500">
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                Loading calendar...
              </div>
            ) : (
              <Calendar
                className="w-full"
                mode="single"
                selected={selectedDate}
                onSelect={(date) => setSelectedDate(date ?? new Date())}
                classNames={{
                  months: "w-full",
                  month: "w-full",
                  month_grid: "w-full table-fixed border-collapse",
                  weekdays: "grid grid-cols-7",
                  week: "mt-2 grid grid-cols-7",
                  weekday:
                    "text-muted-foreground text-center font-normal text-[0.8rem] py-2",
                  day_button: "h-10 w-full p-0 font-normal aria-selected:opacity-100",
                }}
                modifiers={{ hasEvents: eventDays }}
                modifiersClassNames={{
                  hasEvents:
                    "after:absolute after:bottom-1 after:left-1/2 after:h-1 after:w-1 after:-translate-x-1/2 after:rounded-full after:bg-slate-900",
                }}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Events for {format(selectedDate, "PPP")}</CardTitle>
            <CardDescription>
              {selectedDayEvents.length} event{selectedDayEvents.length === 1 ? "" : "s"} on this day.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="py-12 flex items-center justify-center text-slate-500">
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                Loading events...
              </div>
            ) : selectedDayEvents.length === 0 ? (
              <div className="py-12 text-center text-slate-500">No events for this date.</div>
            ) : (
              <div className="space-y-3">
                {selectedDayEvents.map((event) => (
                  <button
                    key={event.id}
                    onClick={() => router.push(event.href)}
                    className="w-full text-left rounded-lg border border-slate-200 p-4 hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {event.type === "ticket" ? (
                            <Ticket className="h-4 w-4 text-slate-600" />
                          ) : (
                            <ShoppingCart className="h-4 w-4 text-slate-600" />
                          )}
                          <p className="font-medium text-slate-900 truncate">{event.title}</p>
                        </div>
                        <p className="text-sm text-slate-600 truncate">{event.subtitle}</p>
                        <p className="text-xs text-slate-500 mt-2">{formatDateTime(event.at)}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <Badge variant="secondary" className="capitalize">
                          {event.type}
                        </Badge>
                        <StatusBadge status={event.status} />
                        {event.priority ? <StatusBadge status={event.priority} /> : null}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button variant="outline" onClick={() => void loadCalendarData()}>
          Refresh
        </Button>
      </div>
    </div>
  );
}
