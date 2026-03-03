"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  AlertTriangle,
  DollarSign,
  Dot,
  MessageCircle,
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
import type {
  CustomerCommunicationItem,
  CustomerDetailResponse,
} from "@/lib/customers/types";

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

function channelLabel(channel: CustomerCommunicationItem["channel"]) {
  if (channel === "sms") {
    return "SMS";
  }
  if (channel === "whatsapp") {
    return "WhatsApp";
  }
  if (channel === "chat") {
    return "Chat";
  }
  return "Email";
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
  const communications = useMemo(
    () => detail?.communications ?? [],
    [detail?.communications],
  );
  const incidents = useMemo(() => detail?.incidents ?? [], [detail?.incidents]);
  const activity = useMemo(() => detail?.activity ?? [], [detail?.activity]);

  if (isLoading) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="flex items-center justify-center py-12 text-muted-foreground">
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
          <CardContent className="py-10 text-center text-muted-foreground">
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
          className="focus:ring-2 focus:ring-ring"
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold text-foreground">{customer.name}</h1>
            <StatusBadge status={customer.status} />
          </div>
          <p className="text-muted-foreground mt-1">Customer ID: {customer.id}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-muted rounded-lg">
                <Mail className="w-5 h-5 text-foreground" />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">Email</p>
                <p className="font-medium text-foreground break-all">{customer.email ?? "-"}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-muted rounded-lg">
                <Package className="w-5 h-5 text-foreground" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Orders</p>
                <p className="font-medium text-foreground">{customer.total_orders_count}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-muted rounded-lg">
                <DollarSign className="w-5 h-5 text-foreground" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Revenue</p>
                <p className="font-medium text-foreground">
                  {formatMoney(customer.total_revenue_amount, "USD")}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-muted rounded-lg">
                <TicketIcon className="w-5 h-5 text-foreground" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Open Tickets</p>
                <p className="font-medium text-foreground">{customer.open_tickets_count}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="conversations">Conversations</TabsTrigger>
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
                <p className="text-sm text-muted-foreground mb-1">Name</p>
                <p className="font-medium text-foreground">{customer.name}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Email</p>
                <p className="font-medium text-foreground break-all">{customer.email ?? "-"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Open Tickets</p>
                <p className="font-medium text-foreground">{customer.open_tickets_count}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">External ID</p>
                <p className="font-medium text-foreground">{customer.external_id ?? "-"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Total Orders</p>
                <p className="font-medium text-foreground">{customer.total_orders_count}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Total Revenue</p>
                <p className="font-medium text-foreground">
                  {formatMoney(customer.total_revenue_amount, "USD")}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Created At</p>
                <p className="font-medium text-foreground">{formatDateTime(customer.created_at)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Updated At</p>
                <p className="font-medium text-foreground">{formatDateTime(customer.updated_at)}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Service Incident Context</CardTitle>
            </CardHeader>
            <CardContent>
              {incidents.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recent incidents in this organization.</p>
              ) : (
                <div className="space-y-3">
                  {incidents.slice(0, 8).map((incident) => (
                    <div key={incident.id} className="rounded-lg border border-border p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                        <p className="font-medium text-foreground">{incident.title}</p>
                        <StatusBadge status={incident.status} />
                        <StatusBadge status={incident.severity} />
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Started: {formatDateTime(incident.started_at)}
                        {incident.resolved_at ? ` | Resolved: ${formatDateTime(incident.resolved_at)}` : ""}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="conversations">
          <Card>
            <CardHeader>
              <CardTitle>Omnichannel Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              {communications.length === 0 ? (
                <p className="text-sm text-muted-foreground">No communications recorded yet.</p>
              ) : (
                <div className="space-y-4">
                  {communications.map((item) => (
                    <div key={item.id} className="rounded-lg border border-border p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <MessageCircle className="h-4 w-4 text-muted-foreground" />
                        <Badge variant="outline">{channelLabel(item.channel)}</Badge>
                        <Badge variant={item.direction === "inbound" ? "secondary" : "default"}>
                          {item.direction === "inbound" ? "Inbound" : "Outbound"}
                        </Badge>
                        {item.subject ? (
                          <p className="text-sm font-medium text-foreground">{item.subject}</p>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm text-foreground whitespace-pre-wrap">{item.preview}</p>
                      <div className="mt-2 flex flex-wrap items-center text-xs text-muted-foreground gap-2">
                        <span>{formatDateTime(item.occurred_at)}</span>
                        {item.actor ? <span>By {item.actor.name ?? item.actor.email}</span> : null}
                        {item.sender_email || item.sender_phone ? (
                          <span>
                            From {item.sender_email ?? item.sender_phone}
                          </span>
                        ) : null}
                        {item.ticket_id ? <span>Ticket linked</span> : null}
                        {item.order_id ? <span>Order linked</span> : null}
                        {item.incident_id ? <span>Incident linked</span> : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
                <p className="text-sm text-muted-foreground">No activity found for this customer.</p>
              ) : (
                <div className="space-y-4">
                  {activity.map((item) => (
                    <div key={item.id} className="rounded-lg border border-border p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-foreground">{item.title}</p>
                        {item.kind === "communication" && item.channel ? (
                          <Badge variant="outline">{channelLabel(item.channel)}</Badge>
                        ) : null}
                        {item.kind === "communication" && item.direction ? (
                          <Badge variant={item.direction === "inbound" ? "secondary" : "default"}>
                            {item.direction === "inbound" ? "Inbound" : "Outbound"}
                          </Badge>
                        ) : null}
                      </div>
                      {item.preview ? (
                        <p className="mt-2 text-sm text-foreground">{item.preview}</p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap items-center text-xs text-muted-foreground">
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
                <p className="text-sm text-muted-foreground">No tickets linked to this customer.</p>
              ) : (
                <div className="space-y-4">
                  {tickets.map((ticket) => (
                    <div
                      key={ticket.id}
                      className="flex items-start justify-between p-4 border border-border rounded-lg hover:bg-muted/50 cursor-pointer"
                      onClick={() => router.push(`/tickets/${ticket.id}`)}
                    >
                      <div className="flex-1">
                        <p className="font-medium text-foreground">{toTicketCode(ticket.id)}</p>
                        <p className="text-sm text-foreground mt-1">{ticket.title}</p>
                        <p className="text-xs text-muted-foreground mt-2">
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
                <p className="text-sm text-muted-foreground">No orders linked to this customer.</p>
              ) : (
                <div className="space-y-4">
                  {orders.map((order) => (
                    <div
                      key={order.id}
                      className="flex items-start justify-between p-4 border border-border rounded-lg hover:bg-muted/50 cursor-pointer"
                      onClick={() => router.push(`/orders/${order.id}`)}
                    >
                      <div className="flex-1">
                        <p className="font-medium text-foreground">{order.order_number}</p>
                        <p className="text-xs text-muted-foreground mt-2">
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
