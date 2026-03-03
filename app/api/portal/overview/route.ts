import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getCustomerPortalContext } from "@/lib/server/customer-portal-auth";
import type { PortalOrderSummary, PortalOverviewResponse, PortalTicketSummary } from "@/lib/portal/types";
import { isMissingTableInSchemaCache, missingTableMessageWithMigration } from "@/lib/tickets/errors";

type TicketSummaryRow = Omit<PortalTicketSummary, "latest_message_at" | "attachments_count">;
type TicketTextRow = {
  ticket_id: string;
  created_at: string;
};
type TicketAttachmentRow = {
  ticket_id: string;
};
type OrderSummaryRow = PortalOrderSummary;

function normalizeCurrencyForResponse(currency: string): string {
  return currency.trim().toUpperCase();
}

export async function GET() {
  const portalContext = await getCustomerPortalContext();
  if (!portalContext) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  const { organizationId, customerId } = portalContext;

  const [{ data: tickets, error: ticketsError }, { data: orders, error: ordersError }] =
    await Promise.all([
      supabase
        .from("tickets")
        .select(
          "id, organization_id, customer_id, order_id, title, description, status, priority, created_at, updated_at, closed_at",
        )
        .eq("organization_id", organizationId)
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false })
        .limit(200)
        .returns<TicketSummaryRow[]>(),
      supabase
        .from("orders")
        .select(
          "id, organization_id, customer_id, order_number, status, payment_status, currency, total_amount, created_at, paid_at, payment_link_url",
        )
        .eq("organization_id", organizationId)
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false })
        .limit(200)
        .returns<OrderSummaryRow[]>(),
    ]);

  if (ticketsError) {
    if (isMissingTableInSchemaCache(ticketsError, "tickets")) {
      return NextResponse.json(
        { error: missingTableMessageWithMigration("tickets", "db/tickets-schema.sql") },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to load portal tickets: ${ticketsError.message}` },
      { status: 500 },
    );
  }

  if (ordersError) {
    if (isMissingTableInSchemaCache(ordersError, "orders")) {
      return NextResponse.json(
        { error: missingTableMessageWithMigration("orders", "db/orders-schema.sql") },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to load portal orders: ${ordersError.message}` },
      { status: 500 },
    );
  }

  const ticketRows = tickets ?? [];
  const ticketIds = ticketRows.map((ticket) => ticket.id);
  const latestMessageByTicketId = new Map<string, string>();
  const attachmentCountByTicketId = new Map<string, number>();

  if (ticketIds.length > 0) {
    const [{ data: textRows }, { data: attachmentRows }] = await Promise.all([
      supabase
        .from("ticket_texts")
        .select("ticket_id, created_at")
        .eq("organization_id", organizationId)
        .in("ticket_id", ticketIds)
        .returns<TicketTextRow[]>(),
      supabase
        .from("ticket_attachments")
        .select("ticket_id")
        .eq("organization_id", organizationId)
        .in("ticket_id", ticketIds)
        .returns<TicketAttachmentRow[]>(),
    ]);

    for (const row of textRows ?? []) {
      const current = latestMessageByTicketId.get(row.ticket_id);
      if (!current || new Date(row.created_at).getTime() > new Date(current).getTime()) {
        latestMessageByTicketId.set(row.ticket_id, row.created_at);
      }
    }

    for (const row of attachmentRows ?? []) {
      attachmentCountByTicketId.set(
        row.ticket_id,
        (attachmentCountByTicketId.get(row.ticket_id) ?? 0) + 1,
      );
    }
  }

  const responseTickets: PortalTicketSummary[] = ticketRows.map((ticket) => ({
    ...ticket,
    latest_message_at: latestMessageByTicketId.get(ticket.id) ?? null,
    attachments_count: attachmentCountByTicketId.get(ticket.id) ?? 0,
  }));

  const responseOrders: PortalOrderSummary[] = (orders ?? []).map((order) => ({
    ...order,
    currency: normalizeCurrencyForResponse(order.currency),
  }));

  const payload: PortalOverviewResponse = {
    organization: portalContext.organization,
    customer: portalContext.customer,
    tickets: responseTickets,
    orders: responseOrders,
  };

  return NextResponse.json(payload, { status: 200 });
}

