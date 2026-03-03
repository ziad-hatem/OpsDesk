import { NextResponse } from "next/server";
import { getTicketRequestContext } from "@/lib/server/ticket-context";
import { type GlobalSearchItem, type GlobalSearchResponse } from "@/lib/search/types";
import { isMissingTableInSchemaCache } from "@/lib/tickets/errors";
import { isMissingTeamSchema } from "@/lib/team/errors";
import type { OrganizationRole } from "@/lib/topbar/types";

type TicketRow = {
  id: string;
  title: string;
  status: string;
  priority: string;
  created_at: string;
};

type CustomerRow = {
  id: string;
  name: string;
  email: string | null;
  status: string;
  created_at: string;
};

type OrderRow = {
  id: string;
  order_number: string;
  status: string;
  payment_status: string;
  total_amount: number;
  currency: string;
  created_at: string;
};

type UserRow = {
  id: string;
  name: string | null;
  email: string;
};

type MembershipRow = {
  id: string;
  user_id: string;
  role: OrganizationRole;
  status: "active" | "suspended";
  joined_at: string | null;
  created_at: string;
};

type MembershipFallbackRow = Omit<MembershipRow, "status">;

function sanitizeSearchTerm(value: string): string {
  return value
    .replace(/[%_,()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function normalizeLimit(value: string | null): number {
  const parsed = Number(value ?? "");
  if (!Number.isFinite(parsed)) {
    return 6;
  }
  return Math.min(Math.max(Math.floor(parsed), 1), 12);
}

function toDisplayLabel(value: string): string {
  return value
    .split("_")
    .join(" ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatMoney(cents: number, currency: string): string {
  const normalizedCurrency = currency.trim().toUpperCase() || "USD";
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

function toTicketCode(ticketId: string): string {
  return `TCK-${ticketId.slice(0, 8).toUpperCase()}`;
}

export async function GET(req: Request) {
  const ctxResult = await getTicketRequestContext();
  if (!ctxResult.ok) {
    return NextResponse.json({ error: ctxResult.error }, { status: ctxResult.status });
  }

  const { supabase, activeOrgId } = ctxResult.context;
  if (!activeOrgId) {
    return NextResponse.json(
      { error: "No active organization selected. Create or join an organization first." },
      { status: 400 },
    );
  }

  const { searchParams } = new URL(req.url);
  const query = sanitizeSearchTerm(searchParams.get("q") ?? "");
  const limitPerType = normalizeLimit(searchParams.get("limit"));

  if (query.length < 2) {
    const emptyResponse: GlobalSearchResponse = {
      query,
      items: [],
    };
    return NextResponse.json(emptyResponse, { status: 200 });
  }

  const likePattern = `%${query}%`;
  const usersLimit = Math.max(limitPerType * 4, 20);

  const [ticketsResult, customersResult, ordersResult, usersResult] = await Promise.all([
    supabase
      .from("tickets")
      .select("id, title, status, priority, created_at")
      .eq("organization_id", activeOrgId)
      .or(`title.ilike.${likePattern},description.ilike.${likePattern}`)
      .order("updated_at", { ascending: false })
      .limit(limitPerType)
      .returns<TicketRow[]>(),
    supabase
      .from("customers")
      .select("id, name, email, status, created_at")
      .eq("organization_id", activeOrgId)
      .or(`name.ilike.${likePattern},email.ilike.${likePattern},external_id.ilike.${likePattern}`)
      .order("updated_at", { ascending: false })
      .limit(limitPerType)
      .returns<CustomerRow[]>(),
    supabase
      .from("orders")
      .select("id, order_number, status, payment_status, total_amount, currency, created_at")
      .eq("organization_id", activeOrgId)
      .or(`order_number.ilike.${likePattern},notes.ilike.${likePattern}`)
      .order("updated_at", { ascending: false })
      .limit(limitPerType)
      .returns<OrderRow[]>(),
    supabase
      .from("users")
      .select("id, name, email")
      .or(`name.ilike.${likePattern},email.ilike.${likePattern}`)
      .limit(usersLimit)
      .returns<UserRow[]>(),
  ]);

  if (ticketsResult.error && !isMissingTableInSchemaCache(ticketsResult.error, "tickets")) {
    return NextResponse.json(
      { error: `Failed to search tickets: ${ticketsResult.error.message}` },
      { status: 500 },
    );
  }

  if (
    customersResult.error &&
    !isMissingTableInSchemaCache(customersResult.error, "customers")
  ) {
    return NextResponse.json(
      { error: `Failed to search customers: ${customersResult.error.message}` },
      { status: 500 },
    );
  }

  if (ordersResult.error && !isMissingTableInSchemaCache(ordersResult.error, "orders")) {
    return NextResponse.json(
      { error: `Failed to search orders: ${ordersResult.error.message}` },
      { status: 500 },
    );
  }

  if (usersResult.error) {
    return NextResponse.json(
      { error: `Failed to search team members: ${usersResult.error.message}` },
      { status: 500 },
    );
  }

  const items: GlobalSearchItem[] = [];

  for (const ticket of ticketsResult.data ?? []) {
    items.push({
      id: ticket.id,
      type: "ticket",
      title: ticket.title,
      subtitle: `${toTicketCode(ticket.id)} | ${toDisplayLabel(ticket.status)} | ${toDisplayLabel(ticket.priority)} priority`,
      href: `/tickets/${ticket.id}`,
      createdAt: ticket.created_at,
    });
  }

  for (const customer of customersResult.data ?? []) {
    items.push({
      id: customer.id,
      type: "customer",
      title: customer.name,
      subtitle: `${customer.email ?? "No email"} | ${toDisplayLabel(customer.status)}`,
      href: `/customers/${customer.id}`,
      createdAt: customer.created_at,
    });
  }

  for (const order of ordersResult.data ?? []) {
    items.push({
      id: order.id,
      type: "order",
      title: order.order_number,
      subtitle: `${toDisplayLabel(order.status)} | ${toDisplayLabel(order.payment_status)} | ${formatMoney(order.total_amount, order.currency)}`,
      href: `/orders/${order.id}`,
      createdAt: order.created_at,
    });
  }

  const users = usersResult.data ?? [];
  if (users.length > 0) {
    const userIds = users.map((user) => user.id);
    const membershipsWithStatusResult = await supabase
      .from("organization_memberships")
      .select("id, user_id, role, status, joined_at, created_at")
      .eq("organization_id", activeOrgId)
      .in("user_id", userIds)
      .returns<MembershipRow[]>();

    let membershipRows: MembershipRow[] = [];

    if (membershipsWithStatusResult.error) {
      const isMissingStatusColumn = membershipsWithStatusResult.error.message
        .toLowerCase()
        .includes("organization_memberships.status");

      if (!isMissingStatusColumn && !isMissingTeamSchema(membershipsWithStatusResult.error)) {
        return NextResponse.json(
          { error: `Failed to search team members: ${membershipsWithStatusResult.error.message}` },
          { status: 500 },
        );
      }

      if (isMissingStatusColumn) {
        const membershipsFallbackResult = await supabase
          .from("organization_memberships")
          .select("id, user_id, role, joined_at, created_at")
          .eq("organization_id", activeOrgId)
          .in("user_id", userIds)
          .returns<MembershipFallbackRow[]>();

        if (
          membershipsFallbackResult.error &&
          !isMissingTeamSchema(membershipsFallbackResult.error)
        ) {
          return NextResponse.json(
            { error: `Failed to search team members: ${membershipsFallbackResult.error.message}` },
            { status: 500 },
          );
        }

        membershipRows = (membershipsFallbackResult.data ?? []).map((membership) => ({
          ...membership,
          status: "active",
        }));
      }
    } else {
      membershipRows = membershipsWithStatusResult.data ?? [];
    }

    if (membershipRows.length > 0) {
      const usersById = new Map(users.map((user) => [user.id, user]));
      const teamItems = membershipRows
        .map((membership): GlobalSearchItem | null => {
          const member = usersById.get(membership.user_id);
          if (!member) {
            return null;
          }

          const displayName = member.name?.trim() || member.email;
          return {
            id: membership.id,
            type: "team_member",
            title: displayName,
            subtitle: `${member.email} | ${toDisplayLabel(membership.role)} | ${toDisplayLabel(membership.status)}`,
            href: `/settings/team?memberId=${membership.id}`,
            createdAt: membership.joined_at ?? membership.created_at,
          };
        })
        .filter((entry): entry is GlobalSearchItem => entry !== null)
        .sort((left, right) => left.title.localeCompare(right.title))
        .slice(0, limitPerType);

      items.push(...teamItems);
    }
  }

  const response: GlobalSearchResponse = {
    query,
    items,
  };

  return NextResponse.json(response, { status: 200 });
}

