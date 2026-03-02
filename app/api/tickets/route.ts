import { NextResponse } from "next/server";
import { getTicketRequestContext } from "@/lib/server/ticket-context";
import type {
  TicketCustomer,
  TicketListItem,
  TicketUser,
  TicketsListResponse,
} from "@/lib/tickets/types";
import {
  isTicketPriority,
  isTicketStatus,
  normalizeTicketPriority,
  normalizeTicketStatus,
} from "@/lib/tickets/validation";
import {
  isMissingTableInSchemaCache,
  missingTableMessage,
  missingTableMessageWithMigration,
} from "@/lib/tickets/errors";

type TicketRow = Omit<TicketListItem, "assignee" | "creator" | "customer">;
type UserRow = TicketUser;
type CustomerRow = TicketCustomer;
type OrderAccessRow = {
  id: string;
  customer_id: string;
};

type MembershipUserRow = {
  user_id: string;
  users:
    | {
        id: string;
        name: string | null;
        email: string;
        avatar_url: string | null;
      }
    | Array<{
        id: string;
        name: string | null;
        email: string;
        avatar_url: string | null;
      }>
    | null;
};

type CreateTicketBody = {
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  assigneeId?: string | null;
  customerId?: string | null;
  orderId?: string | null;
  slaDueAt?: string | null;
};

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeIsoDate(value: unknown): string | null {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function normalizeUserFromMembership(row: MembershipUserRow): UserRow | null {
  const user = Array.isArray(row.users) ? row.users[0] : row.users;
  if (!user) {
    return null;
  }
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatar_url: user.avatar_url,
  };
}

export async function GET(req: Request) {
  const ctxResult = await getTicketRequestContext();
  if (!ctxResult.ok) {
    return NextResponse.json({ error: ctxResult.error }, { status: ctxResult.status });
  }

  const { supabase, activeOrgId, userId } = ctxResult.context;
  if (!activeOrgId) {
    return NextResponse.json(
      { error: "No active organization selected. Create or join an organization first." },
      { status: 400 },
    );
  }

  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const priority = searchParams.get("priority");
    const assigneeId = searchParams.get("assigneeId");
    const search = searchParams.get("search")?.trim() ?? "";

    let query = supabase
      .from("tickets")
      .select(
        "id, organization_id, customer_id, order_id, title, description, status, priority, assignee_id, created_by, sla_due_at, created_at, updated_at, closed_at",
      )
      .eq("organization_id", activeOrgId)
      .order("created_at", { ascending: false })
      .limit(500);

    if (status && status !== "all" && isTicketStatus(status)) {
      query = query.eq("status", status);
    }
    if (priority && priority !== "all" && isTicketPriority(priority)) {
      query = query.eq("priority", priority);
    }
    if (assigneeId && assigneeId !== "all") {
      query = query.eq("assignee_id", assigneeId);
    }
    if (search.length > 0) {
      const safeSearch = search.replace(/[%_,]/g, "");
      if (safeSearch.length > 0) {
        query = query.or(
          `title.ilike.%${safeSearch}%,description.ilike.%${safeSearch}%`,
        );
      }
    }

    const { data: ticketsData, error: ticketsError } = await query.returns<TicketRow[]>();

    if (ticketsError) {
      if (isMissingTableInSchemaCache(ticketsError, "tickets")) {
        return NextResponse.json(
          { error: missingTableMessage("tickets") },
          { status: 500 },
        );
      }
      return NextResponse.json(
        { error: `Failed to load tickets: ${ticketsError.message}` },
        { status: 500 },
      );
    }

    const tickets = ticketsData ?? [];
    const userIds = Array.from(
      new Set(
        tickets
          .flatMap((ticket) => [ticket.created_by, ticket.assignee_id].filter(Boolean))
          .map((id) => id as string),
      ),
    );

    let usersById = new Map<string, UserRow>();
    if (userIds.length > 0) {
      const { data: usersData, error: usersError } = await supabase
        .from("users")
        .select("id, name, email, avatar_url")
        .in("id", userIds)
        .returns<UserRow[]>();

      if (usersError) {
        return NextResponse.json(
          { error: `Failed to load ticket users: ${usersError.message}` },
          { status: 500 },
        );
      }

      usersById = new Map((usersData ?? []).map((user) => [user.id, user]));
    }

    const customerIds = Array.from(
      new Set(
        tickets
          .map((ticket) => ticket.customer_id)
          .filter((id): id is string => Boolean(id)),
      ),
    );

    let customersById = new Map<string, CustomerRow>();
    if (customerIds.length > 0) {
      const { data: customersData, error: customersError } = await supabase
        .from("customers")
        .select("id, name, email")
        .in("id", customerIds)
        .eq("organization_id", activeOrgId)
        .returns<CustomerRow[]>();

      if (customersError) {
        if (isMissingTableInSchemaCache(customersError, "customers")) {
          return NextResponse.json(
            { error: missingTableMessageWithMigration("customers", "db/customers-schema.sql") },
            { status: 500 },
          );
        }
        return NextResponse.json(
          { error: `Failed to load ticket customers: ${customersError.message}` },
          { status: 500 },
        );
      }

      customersById = new Map(
        (customersData ?? []).map((customer) => [customer.id, customer]),
      );
    }

    const { data: membershipUsersData, error: membershipUsersError } = await supabase
      .from("organization_memberships")
      .select("user_id, users(id, name, email, avatar_url)")
      .eq("organization_id", activeOrgId)
      .returns<MembershipUserRow[]>();

    if (membershipUsersError) {
      return NextResponse.json(
        { error: `Failed to load assignees: ${membershipUsersError.message}` },
        { status: 500 },
      );
    }

    const assignees = (membershipUsersData ?? [])
      .map(normalizeUserFromMembership)
      .filter((user): user is UserRow => user !== null);

    const responseTickets: TicketListItem[] = tickets.map((ticket) => ({
      ...ticket,
      assignee: ticket.assignee_id ? usersById.get(ticket.assignee_id) ?? null : null,
      creator: usersById.get(ticket.created_by) ?? null,
      customer: ticket.customer_id ? customersById.get(ticket.customer_id) ?? null : null,
    }));

    const response: TicketsListResponse = {
      tickets: responseTickets,
      assignees,
      activeOrgId,
      currentUserId: userId,
    };

    return NextResponse.json(
      response,
      { status: 200 },
    );
  } catch {
    return NextResponse.json({ error: "Failed to load tickets" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const ctxResult = await getTicketRequestContext();
  if (!ctxResult.ok) {
    return NextResponse.json({ error: ctxResult.error }, { status: ctxResult.status });
  }

  const { supabase, activeOrgId, userId } = ctxResult.context;
  if (!activeOrgId) {
    return NextResponse.json(
      { error: "No active organization selected. Create or join an organization first." },
      { status: 400 },
    );
  }

  try {
    const body = (await req.json()) as CreateTicketBody;

    const title = normalizeText(body.title);
    const description = normalizeText(body.description);
    const status = normalizeTicketStatus(body.status, "open");
    const priority = normalizeTicketPriority(body.priority, "medium");
    const assigneeId = normalizeText(body.assigneeId);
    const customerId = normalizeText(body.customerId);
    const orderId = normalizeText(body.orderId);
    let resolvedCustomerId = customerId;
    const slaDueAtRaw = body.slaDueAt;
    const slaDueAt = normalizeIsoDate(slaDueAtRaw);

    if (!title) {
      return NextResponse.json({ error: "Ticket title is required" }, { status: 400 });
    }
    if (slaDueAtRaw && !slaDueAt) {
      return NextResponse.json(
        { error: "slaDueAt must be a valid date-time string" },
        { status: 400 },
      );
    }

    if (assigneeId) {
      const { count, error: assigneeAccessError } = await supabase
        .from("organization_memberships")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", activeOrgId)
        .eq("user_id", assigneeId);

      if (assigneeAccessError) {
        return NextResponse.json(
          { error: `Failed to verify assignee access: ${assigneeAccessError.message}` },
          { status: 500 },
        );
      }

      if (!count) {
        return NextResponse.json(
          { error: "Selected assignee is not part of this organization" },
          { status: 400 },
        );
      }
    }

    if (orderId) {
      const { data: orderData, error: orderAccessError } = await supabase
        .from("orders")
        .select("id, customer_id")
        .eq("organization_id", activeOrgId)
        .eq("id", orderId)
        .maybeSingle<OrderAccessRow>();

      if (orderAccessError) {
        if (isMissingTableInSchemaCache(orderAccessError, "orders")) {
          return NextResponse.json(
            { error: missingTableMessageWithMigration("orders", "db/orders-schema.sql") },
            { status: 500 },
          );
        }
        return NextResponse.json(
          { error: `Failed to verify order access: ${orderAccessError.message}` },
          { status: 500 },
        );
      }

      if (!orderData) {
        return NextResponse.json(
          { error: "Selected order is not part of this organization" },
          { status: 400 },
        );
      }

      if (resolvedCustomerId && resolvedCustomerId !== orderData.customer_id) {
        return NextResponse.json(
          {
            error:
              "Selected customer does not match the selected order customer",
          },
          { status: 400 },
        );
      }

      resolvedCustomerId = orderData.customer_id;
    }

    if (resolvedCustomerId) {
      const { count, error: customerAccessError } = await supabase
        .from("customers")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", activeOrgId)
        .eq("id", resolvedCustomerId);

      if (customerAccessError) {
        if (isMissingTableInSchemaCache(customerAccessError, "customers")) {
          return NextResponse.json(
            { error: missingTableMessageWithMigration("customers", "db/customers-schema.sql") },
            { status: 500 },
          );
        }
        return NextResponse.json(
          { error: `Failed to verify customer access: ${customerAccessError.message}` },
          { status: 500 },
        );
      }

      if (!count) {
        return NextResponse.json(
          { error: "Selected customer is not part of this organization" },
          { status: 400 },
        );
      }
    }

    const { data: insertedTicket, error: ticketInsertError } = await supabase
      .from("tickets")
      .insert({
        organization_id: activeOrgId,
        customer_id: resolvedCustomerId,
        order_id: orderId,
        title,
        description,
        status,
        priority,
        assignee_id: assigneeId,
        created_by: userId,
        sla_due_at: slaDueAt,
      })
      .select(
        "id, organization_id, customer_id, order_id, title, description, status, priority, assignee_id, created_by, sla_due_at, created_at, updated_at, closed_at",
      )
      .single<TicketRow>();

    if (ticketInsertError || !insertedTicket) {
      if (isMissingTableInSchemaCache(ticketInsertError, "tickets")) {
        return NextResponse.json(
          { error: missingTableMessage("tickets") },
          { status: 500 },
        );
      }
      return NextResponse.json(
        { error: `Failed to create ticket: ${ticketInsertError?.message ?? "Unknown error"}` },
        { status: 500 },
      );
    }

    await supabase.from("ticket_texts").insert({
      organization_id: activeOrgId,
      ticket_id: insertedTicket.id,
      author_id: userId,
      type: "system",
      body: "Ticket created",
    });

    const userIds = [insertedTicket.created_by, insertedTicket.assignee_id]
      .filter(Boolean)
      .map((id) => id as string);
    const { data: users } = await supabase
      .from("users")
      .select("id, name, email, avatar_url")
      .in("id", userIds)
      .returns<UserRow[]>();

    const usersById = new Map((users ?? []).map((user) => [user.id, user]));
    let customer: TicketCustomer | null = null;
    if (insertedTicket.customer_id) {
      const { data: customerData, error: customerError } = await supabase
        .from("customers")
        .select("id, name, email")
        .eq("id", insertedTicket.customer_id)
        .eq("organization_id", activeOrgId)
        .maybeSingle<CustomerRow>();

      if (customerError) {
        if (isMissingTableInSchemaCache(customerError, "customers")) {
          return NextResponse.json(
            { error: missingTableMessageWithMigration("customers", "db/customers-schema.sql") },
            { status: 500 },
          );
        }
        return NextResponse.json(
          { error: `Ticket created but failed to load customer: ${customerError.message}` },
          { status: 500 },
        );
      }
      customer = customerData ?? null;
    }

    const ticket: TicketListItem = {
      ...insertedTicket,
      assignee: insertedTicket.assignee_id
        ? usersById.get(insertedTicket.assignee_id) ?? null
        : null,
      creator: usersById.get(insertedTicket.created_by) ?? null,
      customer,
    };

    return NextResponse.json({ ticket }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }
}
