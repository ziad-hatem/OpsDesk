"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FileUp, Loader2, LogOut, MessageSquareText, ReceiptText } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/components/ui/card";
import { Badge } from "@/app/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/app/components/ui/tabs";
import { Textarea } from "@/app/components/ui/textarea";
import { Input } from "@/app/components/ui/input";
import type { PortalOrderSummary, PortalOverviewResponse, PortalTicketDetail, PortalTicketSummary } from "@/lib/portal/types";

function formatDateTime(value: string | null): string {
  if (!value) {
    return "N/A";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

function formatMoney(cents: number, currency: string): string {
  const normalized = (currency || "USD").trim().toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: normalized,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${normalized}`;
  }
}

function badgeVariantForTicketStatus(status: PortalTicketSummary["status"]) {
  if (status === "resolved" || status === "closed") {
    return "secondary";
  }
  if (status === "pending") {
    return "outline";
  }
  return "default";
}

function badgeVariantForPaymentStatus(status: PortalOrderSummary["payment_status"]) {
  if (status === "paid") {
    return "secondary";
  }
  if (status === "failed" || status === "expired" || status === "cancelled") {
    return "destructive";
  }
  return "outline";
}

export default function CustomerPortalPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab") === "orders" ? "orders" : "tickets";

  const [activeTab, setActiveTab] = useState<"tickets" | "orders">(initialTab);
  const [overview, setOverview] = useState<PortalOverviewResponse | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [isOverviewLoading, setIsOverviewLoading] = useState(true);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [ticketDetailById, setTicketDetailById] = useState<Record<string, PortalTicketDetail>>({});
  const [isTicketLoading, setIsTicketLoading] = useState(false);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [isPostingReply, setIsPostingReply] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [payingOrderId, setPayingOrderId] = useState<string | null>(null);

  const selectedTicket = useMemo(
    () => overview?.tickets.find((ticket) => ticket.id === selectedTicketId) ?? null,
    [overview?.tickets, selectedTicketId],
  );
  const selectedTicketDetail = selectedTicketId ? ticketDetailById[selectedTicketId] ?? null : null;

  const loadOverview = async () => {
    setIsOverviewLoading(true);
    setOverviewError(null);
    try {
      const response = await fetch("/api/portal/overview", {
        method: "GET",
        cache: "no-store",
      });
      if (response.status === 401) {
        router.replace("/portal/sign-in");
        return;
      }

      const payload = (await response.json()) as PortalOverviewResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load portal");
      }

      setOverview(payload);
      if (payload.tickets.length > 0) {
        setSelectedTicketId((current) =>
          current && payload.tickets.some((ticket) => ticket.id === current)
            ? current
            : payload.tickets[0]?.id ?? null,
        );
      } else {
        setSelectedTicketId(null);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to load portal";
      setOverviewError(message);
      setOverview(null);
      setSelectedTicketId(null);
    } finally {
      setIsOverviewLoading(false);
    }
  };

  const loadTicketDetail = async (ticketId: string) => {
    setIsTicketLoading(true);
    setTicketError(null);

    try {
      const response = await fetch(`/api/portal/tickets/${ticketId}`, {
        method: "GET",
        cache: "no-store",
      });
      const payload = (await response.json()) as PortalTicketDetail & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load ticket detail");
      }

      setTicketDetailById((prev) => ({ ...prev, [ticketId]: payload }));
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to load ticket detail";
      setTicketError(message);
    } finally {
      setIsTicketLoading(false);
    }
  };

  useEffect(() => {
    void loadOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedTicketId) {
      return;
    }
    if (ticketDetailById[selectedTicketId]) {
      return;
    }
    void loadTicketDetail(selectedTicketId);
  }, [selectedTicketId, ticketDetailById]);

  const handleReplySubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedTicketId || !replyBody.trim() || isPostingReply) {
      return;
    }

    setIsPostingReply(true);
    setTicketError(null);
    try {
      const response = await fetch(`/api/portal/tickets/${selectedTicketId}/reply`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ body: replyBody.trim() }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to post reply");
      }

      setReplyBody("");
      await Promise.all([loadTicketDetail(selectedTicketId), loadOverview()]);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to post reply";
      setTicketError(message);
    } finally {
      setIsPostingReply(false);
    }
  };

  const handleAttachmentUpload = async () => {
    if (!selectedTicketId || !selectedFile || isUploading) {
      return;
    }

    setIsUploading(true);
    setTicketError(null);

    try {
      const encodedFilename = encodeURIComponent(selectedFile.name);
      const response = await fetch(
        `/api/portal/tickets/${selectedTicketId}/attachments?filename=${encodedFilename}`,
        {
          method: "POST",
          headers: {
            "content-type": selectedFile.type || "application/octet-stream",
            "x-file-size": String(selectedFile.size),
          },
          body: selectedFile,
        },
      );

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to upload attachment");
      }

      setSelectedFile(null);
      await Promise.all([loadTicketDetail(selectedTicketId), loadOverview()]);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to upload attachment";
      setTicketError(message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleLogout = async () => {
    if (isLoggingOut) {
      return;
    }
    setIsLoggingOut(true);
    try {
      await fetch("/api/portal/auth/logout", { method: "POST" });
    } finally {
      router.replace("/portal/sign-in");
    }
  };

  const handlePayOrder = async (orderId: string) => {
    if (payingOrderId) {
      return;
    }
    setPayingOrderId(orderId);
    try {
      const response = await fetch(`/api/portal/orders/${orderId}/pay`, {
        method: "POST",
      });
      const payload = (await response.json()) as { checkoutUrl?: string; error?: string };
      if (!response.ok || !payload.checkoutUrl) {
        throw new Error(payload.error ?? "Failed to create payment checkout session");
      }

      window.location.assign(payload.checkoutUrl);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to initialize payment";
      setOverviewError(message);
    } finally {
      setPayingOrderId(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-7xl space-y-6">
        <Card>
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-2xl text-slate-900">Customer Portal</CardTitle>
              <CardDescription>
                Track your tickets, share updates, and pay related orders in one place.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {overview ? (
                <Badge variant="outline" className="rounded-full">
                  {overview.organization.name}
                </Badge>
              ) : null}
              <Button
                variant="outline"
                className="gap-2"
                onClick={handleLogout}
                disabled={isLoggingOut}
              >
                {isLoggingOut ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <LogOut className="h-4 w-4" />
                )}
                Sign out
              </Button>
            </div>
          </CardHeader>
          {overview ? (
            <CardContent className="pt-0 text-sm text-slate-600">
              Signed in as <span className="font-medium text-slate-900">{overview.customer.name}</span>
              {" • "}
              {overview.customer.email ?? "No email"}
            </CardContent>
          ) : null}
        </Card>

        {isOverviewLoading ? (
          <Card>
            <CardContent className="flex items-center gap-2 py-10 text-slate-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading portal data...
            </CardContent>
          </Card>
        ) : null}

        {overviewError ? (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="py-4 text-sm text-red-700">{overviewError}</CardContent>
          </Card>
        ) : null}

        {overview ? (
          <Tabs
            value={activeTab}
            onValueChange={(next) => setActiveTab(next as "tickets" | "orders")}
            className="space-y-4"
          >
            <TabsList>
              <TabsTrigger value="tickets" className="gap-2">
                <MessageSquareText className="h-4 w-4" />
                Tickets ({overview.tickets.length})
              </TabsTrigger>
              <TabsTrigger value="orders" className="gap-2">
                <ReceiptText className="h-4 w-4" />
                Orders ({overview.orders.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="tickets" className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_1fr]">
              <Card className="h-fit">
                <CardHeader>
                  <CardTitle className="text-base">Your Tickets</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {overview.tickets.length === 0 ? (
                    <p className="text-sm text-slate-500">No tickets found.</p>
                  ) : (
                    overview.tickets.map((ticket) => (
                      <button
                        key={ticket.id}
                        type="button"
                        onClick={() => setSelectedTicketId(ticket.id)}
                        className={`w-full rounded-md border p-3 text-left transition ${
                          selectedTicketId === ticket.id
                            ? "border-slate-900 bg-slate-50"
                            : "border-slate-200 hover:border-slate-300"
                        }`}
                      >
                        <p className="truncate text-sm font-medium text-slate-900">{ticket.title}</p>
                        <div className="mt-2 flex items-center gap-2">
                          <Badge variant={badgeVariantForTicketStatus(ticket.status)}>
                            {ticket.status}
                          </Badge>
                          <Badge variant="outline">{ticket.priority}</Badge>
                        </div>
                        <p className="mt-2 text-xs text-slate-500">
                          Updated {formatDateTime(ticket.updated_at)}
                        </p>
                      </button>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    {selectedTicket ? selectedTicket.title : "Select a ticket"}
                  </CardTitle>
                  {selectedTicket ? (
                    <CardDescription>
                      Status {selectedTicket.status} • Priority {selectedTicket.priority}
                    </CardDescription>
                  ) : null}
                </CardHeader>
                <CardContent className="space-y-4">
                  {selectedTicket && selectedTicket.description ? (
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                      {selectedTicket.description}
                    </div>
                  ) : null}

                  {isTicketLoading ? (
                    <p className="flex items-center gap-2 text-sm text-slate-600">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading ticket detail...
                    </p>
                  ) : null}

                  {ticketError ? (
                    <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {ticketError}
                    </p>
                  ) : null}

                  {selectedTicketDetail ? (
                    <>
                      <div className="space-y-3 rounded-md border border-slate-200 p-3">
                        {selectedTicketDetail.texts.length === 0 ? (
                          <p className="text-sm text-slate-500">No messages yet.</p>
                        ) : (
                          selectedTicketDetail.texts.map((text) => (
                            <div key={text.id} className="rounded-md border border-slate-200 p-3">
                              <div className="mb-2 flex items-center justify-between gap-2 text-xs text-slate-500">
                                <span>{text.author?.name ?? text.author?.email ?? "Unknown"}</span>
                                <span>{formatDateTime(text.created_at)}</span>
                              </div>
                              <p className="whitespace-pre-wrap text-sm text-slate-800">{text.body}</p>
                              {text.attachments.length > 0 ? (
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {text.attachments.map((attachment) => (
                                    <a
                                      key={attachment.id}
                                      className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                                      href={`/api/portal/tickets/${selectedTicketDetail.ticket.id}/attachments/${attachment.id}`}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      {attachment.file_name}
                                    </a>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          ))
                        )}
                      </div>

                      <form className="space-y-2" onSubmit={handleReplySubmit}>
                        <Textarea
                          value={replyBody}
                          onChange={(event) => setReplyBody(event.target.value)}
                          placeholder="Write a reply..."
                          rows={4}
                          disabled={isPostingReply}
                        />
                        <p className="text-xs text-slate-500">
                          Mention a support teammate with{" "}
                          <span className="font-medium">@handle</span>.
                        </p>
                        <div className="flex items-center justify-end">
                          <Button type="submit" disabled={isPostingReply || !replyBody.trim()}>
                            {isPostingReply ? (
                              <span className="inline-flex items-center gap-2">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Sending...
                              </span>
                            ) : (
                              "Send reply"
                            )}
                          </Button>
                        </div>
                      </form>

                      <div className="space-y-2 rounded-md border border-slate-200 p-3">
                        <p className="text-sm font-medium text-slate-800">Upload attachment</p>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Input
                            type="file"
                            onChange={(event) => {
                              const file = event.target.files?.[0] ?? null;
                              setSelectedFile(file);
                            }}
                            disabled={isUploading}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            className="gap-2"
                            onClick={() => void handleAttachmentUpload()}
                            disabled={!selectedFile || isUploading}
                          >
                            {isUploading ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <FileUp className="h-4 w-4" />
                            )}
                            Upload
                          </Button>
                        </div>
                        {selectedFile ? (
                          <p className="text-xs text-slate-500">
                            Selected: {selectedFile.name} ({Math.round(selectedFile.size / 1024)} KB)
                          </p>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-slate-500">
                      Select a ticket to view conversation and attachments.
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="orders">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Your Orders</CardTitle>
                  <CardDescription>View order status and complete payment securely.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {overview.orders.length === 0 ? (
                    <p className="text-sm text-slate-500">No orders found.</p>
                  ) : (
                    overview.orders.map((order) => {
                      const canPay =
                        order.payment_status !== "paid" &&
                        order.status !== "cancelled" &&
                        order.status !== "refunded";
                      return (
                        <div
                          key={order.id}
                          className="flex flex-col gap-3 rounded-md border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="space-y-1">
                            <p className="font-medium text-slate-900">Order {order.order_number}</p>
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="outline">{order.status}</Badge>
                              <Badge variant={badgeVariantForPaymentStatus(order.payment_status)}>
                                {order.payment_status}
                              </Badge>
                            </div>
                            <p className="text-sm text-slate-600">
                              {formatMoney(order.total_amount, order.currency)} • Created{" "}
                              {formatDateTime(order.created_at)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {order.payment_link_url ? (
                              <Button asChild variant="outline">
                                <a href={order.payment_link_url} target="_blank" rel="noreferrer">
                                  Open payment link
                                </a>
                              </Button>
                            ) : null}
                            <Button
                              onClick={() => void handlePayOrder(order.id)}
                              disabled={!canPay || payingOrderId === order.id}
                            >
                              {payingOrderId === order.id ? (
                                <span className="inline-flex items-center gap-2">
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  Redirecting...
                                </span>
                              ) : canPay ? (
                                "Pay now"
                              ) : (
                                "Paid"
                              )}
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        ) : null}
      </div>
    </div>
  );
}
