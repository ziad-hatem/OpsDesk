"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  DollarSign,
  Dot,
  Mail,
  Ticket as TicketIcon,
  Loader2,
  Package,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { StatusBadge } from "../../components/StatusBadge";
import { Badge } from "../../components/ui/badge";
import { useAppSelector } from "@/lib/store/hooks";
import { selectTopbarActiveOrganizationId } from "@/lib/store/slices/topbar-slice";
import type { CustomerDetailResponse } from "@/lib/customers/types";

function formatDateTime(isoDate: string | null) {
  if (!isoDate) {
    return "-";
  }
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString();
}

function toTicketCode(ticketId: string) {
  return `TKT-${ticketId.slice(0, 8).toUpperCase()}`;
}

function formatMoney(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency || "USD"}`;
  }
}

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const activeOrgId = useAppSelector(selectTopbarActiveOrganizationId);

  const [detail, setDetail] = useState<CustomerDetailResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadCustomer = useCallback(async () => {
    if (!id) {
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/customers/${id}`, {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string };
        throw new Error(errorData.error ?? "Failed to load customer");
      }

      const payload = (await response.json()) as CustomerDetailResponse;
      setDetail(payload);
    } catch (loadError: unknown) {
      const message =
        loadError instanceof Error ? loadError.message : "Failed to load customer";
      setError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadCustomer();
  }, [activeOrgId, loadCustomer]);

  const customer = detail?.customer ?? null;
  const tickets = useMemo(() => detail?.tickets ?? [], [detail?.tickets]);
  const orders = useMemo(() => detail?.orders ?? [], [detail?.orders]);
  const activity = useMemo(() => detail?.activity ?? [], [detail?.activity]);

  if (isLoading) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="flex items-center justify-center py-12 text-slate-500">
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            Loading customer...
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="p-6 space-y-4">
        <Button variant="outline" onClick={() => router.push("/customers")}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Customers
        </Button>
        <Card>
          <CardContent className="py-10 text-center text-slate-600">
            {error ?? "Customer not found."}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="outline"
          size="icon"
          onClick={() => router.push("/customers")}
          className="focus:ring-2 focus:ring-slate-900"
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold text-slate-900">{customer.name}</h1>
            <StatusBadge status={customer.status} />
          </div>
          <p className="text-slate-600 mt-1">Customer ID: {customer.id}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-slate-100 rounded-lg">
                <Mail className="w-5 h-5 text-slate-700" />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-slate-600">Email</p>
                <p className="font-medium text-slate-900 break-all">{customer.email ?? "-"}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-slate-100 rounded-lg">
                <Package className="w-5 h-5 text-slate-700" />
              </div>
              <div>
                <p className="text-sm text-slate-600">Total Orders</p>
                <p className="font-medium text-slate-900">{customer.total_orders_count}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-slate-100 rounded-lg">
                <DollarSign className="w-5 h-5 text-slate-700" />
              </div>
              <div>
                <p className="text-sm text-slate-600">Total Revenue</p>
                <p className="font-medium text-slate-900">
                  {formatMoney(customer.total_revenue_amount, "USD")}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-slate-100 rounded-lg">
                <TicketIcon className="w-5 h-5 text-slate-700" />
              </div>
              <div>
                <p className="text-sm text-slate-600">Open Tickets</p>
                <p className="font-medium text-slate-900">{customer.open_tickets_count}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="activity">Activity Log</TabsTrigger>
          <TabsTrigger value="tickets">Tickets</TabsTrigger>
          <TabsTrigger value="orders">Orders</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Customer Information</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <p className="text-sm text-slate-600 mb-1">Name</p>
                <p className="font-medium text-slate-900">{customer.name}</p>
              </div>
              <div>
                <p className="text-sm text-slate-600 mb-1">Email</p>
                <p className="font-medium text-slate-900 break-all">{customer.email ?? "-"}</p>
              </div>
              <div>
                <p className="text-sm text-slate-600 mb-1">Open Tickets</p>
                <p className="font-medium text-slate-900">{customer.open_tickets_count}</p>
              </div>
              <div>
                <p className="text-sm text-slate-600 mb-1">External ID</p>
                <p className="font-medium text-slate-900">{customer.external_id ?? "-"}</p>
              </div>
              <div>
                <p className="text-sm text-slate-600 mb-1">Total Orders</p>
                <p className="font-medium text-slate-900">{customer.total_orders_count}</p>
              </div>
              <div>
                <p className="text-sm text-slate-600 mb-1">Total Revenue</p>
                <p className="font-medium text-slate-900">
                  {formatMoney(customer.total_revenue_amount, "USD")}
                </p>
              </div>
              <div>
                <p className="text-sm text-slate-600 mb-1">Created At</p>
                <p className="font-medium text-slate-900">{formatDateTime(customer.created_at)}</p>
              </div>
              <div>
                <p className="text-sm text-slate-600 mb-1">Updated At</p>
                <p className="font-medium text-slate-900">{formatDateTime(customer.updated_at)}</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity">
          <Card>
            <CardHeader>
              <CardTitle>Activity Log</CardTitle>
            </CardHeader>
            <CardContent>
              {activity.length === 0 ? (
                <p className="text-sm text-slate-500">No activity found for this customer.</p>
              ) : (
                <div className="space-y-4">
                  {activity.map((item) => (
                    <div key={item.id} className="rounded-lg border border-slate-200 p-4">
                      <p className="font-medium text-slate-900">{item.title}</p>
                      <div className="mt-2 flex flex-wrap items-center text-xs text-slate-600">
                        <span>{formatDateTime(item.occurred_at)}</span>
                        <Dot className="h-4 w-4" />
                        <span>{item.actor?.name ?? item.actor?.email ?? "System"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tickets">
          <Card>
            <CardHeader>
              <CardTitle>Support Tickets</CardTitle>
            </CardHeader>
            <CardContent>
              {tickets.length === 0 ? (
                <p className="text-sm text-slate-500">No tickets linked to this customer.</p>
              ) : (
                <div className="space-y-4">
                  {tickets.map((ticket) => (
                    <div
                      key={ticket.id}
                      className="flex items-start justify-between p-4 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
                      onClick={() => router.push(`/tickets/${ticket.id}`)}
                    >
                      <div className="flex-1">
                        <p className="font-medium text-slate-900">{toTicketCode(ticket.id)}</p>
                        <p className="text-sm text-slate-700 mt-1">{ticket.title}</p>
                        <p className="text-xs text-slate-600 mt-2">
                          Created: {formatDateTime(ticket.created_at)}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <StatusBadge status={ticket.status} />
                        <StatusBadge status={ticket.priority} />
                        {ticket.assignee && (
                          <Badge variant="secondary" className="text-xs">
                            {ticket.assignee.name ?? ticket.assignee.email}
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="orders">
          <Card>
            <CardHeader>
              <CardTitle>Orders</CardTitle>
            </CardHeader>
            <CardContent>
              {orders.length === 0 ? (
                <p className="text-sm text-slate-500">No orders linked to this customer.</p>
              ) : (
                <div className="space-y-4">
                  {orders.map((order) => (
                    <div
                      key={order.id}
                      className="flex items-start justify-between p-4 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
                      onClick={() => router.push(`/orders/${order.id}`)}
                    >
                      <div className="flex-1">
                        <p className="font-medium text-slate-900">{order.order_number}</p>
                        <p className="text-xs text-slate-600 mt-2">
                          Created: {formatDateTime(order.created_at)}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <StatusBadge status={order.status} />
                        <Badge variant="secondary" className="text-xs">
                          {formatMoney(order.total_amount, order.currency)}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
