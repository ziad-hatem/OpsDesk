import { NextResponse } from "next/server";
import { getTicketRequestContext } from "@/lib/server/ticket-context";
import {
  computeResolutionDueAtFromPolicy,
  getSlaPolicyByPriority,
  runSlaEscalationEngine,
} from "@/lib/server/sla-engine";
import {
  getUniqueRecipientIds,
  insertAppNotifications,
} from "@/lib/server/notifications";
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
import { isOrganizationRole } from "@/lib/team/validation";
import {
  isMissingTableInSchemaCache,
  missingTableMessage,
  missingTableMessageWithMigration,
} from "@/lib/tickets/errors";
import type { OrganizationRole } from "@/lib/topbar/types";

type TicketRow = Omit<TicketListItem, "assignee" | "creator" | "customer">;
type UserRow = TicketUser;
type CustomerRow = TicketCustomer;
type OrderAccessRow = {
  id: string;
  customer_id: string;
};

type MembershipUserRow = {
  user_id: string;
  role?: OrganizationRole;
  status?: "active" | "suspended" | null;
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

type MembershipRoleRow = {
  user_id: string;
  role: OrganizationRole;
  status?: "active" | "suspended" | null;
};

type MembershipRoleFallbackRow = Omit<MembershipRoleRow, "status">;

type TicketTagRow = {
  id: string;
};

type TicketTagAssignmentRow = {
  ticket_id: string;
  tag_id: string;
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

function normalizeIsoDateQueryParam(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function normalizeUuidListQueryParam(value: string | null): string[] {
  if (!value) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}

function isMissingTicketTagsSchema(error: { message?: string } | null | undefined): boolean {
  const message = (error?.message ?? "").toLowerCase();
  return (
    (message.includes("ticket_tags") || message.includes("ticket_tag_assignments")) &&
    (message.includes("schema cache") || message.includes("does not exist"))
  );
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
    const assigneeRoleRaw = searchParams.get("assigneeRole");
    const customerId = searchParams.get("customerId");
    const tagIds = normalizeUuidListQueryParam(searchParams.get("tagIds"));
    const createdFrom = normalizeIsoDateQueryParam(searchParams.get("createdFrom"));
    const createdTo = normalizeIsoDateQueryParam(searchParams.get("createdTo"));
    const search = searchParams.get("search")?.trim() ?? "";
    const assigneeRole =
      assigneeRoleRaw && assigneeRoleRaw !== "all" ? assigneeRoleRaw : null;

    if (assigneeRole && !isOrganizationRole(assigneeRole)) {
      return NextResponse.json(
        { error: "assigneeRole must be one of admin, manager, support, read_only" },
        { status: 400 },
      );
    }

    let roleFilteredAssigneeIds: string[] | null = null;
    if (assigneeRole) {
      const membershipQueryWithStatus = await supabase
        .from("organization_memberships")
        .select("user_id, role, status")
        .eq("organization_id", activeOrgId)
        .eq("role", assigneeRole)
        .eq("status", "active")
        .returns<MembershipRoleRow[]>();

      let membershipRows = membershipQueryWithStatus.data ?? [];
      let membershipError = membershipQueryWithStatus.error;

      const isMissingStatusColumn =
        membershipError?.message?.toLowerCase().includes("organization_memberships.status") ??
        false;
      if (membershipError && isMissingStatusColumn) {
        const fallbackMembershipQuery = await supabase
          .from("organization_memberships")
          .select("user_id, role")
          .eq("organization_id", activeOrgId)
          .eq("role", assigneeRole)
          .returns<MembershipRoleFallbackRow[]>();

        membershipRows = fallbackMembershipQuery.data ?? [];
        membershipError = fallbackMembershipQuery.error;
      }

      if (membershipError) {
        return NextResponse.json(
          { error: `Failed to filter by assignee role: ${membershipError.message}` },
          { status: 500 },
        );
      }

      roleFilteredAssigneeIds = Array.from(
        new Set(membershipRows.map((row) => row.user_id)),
      );
    }

    let tagFilteredTicketIds: string[] | null = null;
    if (tagIds.length > 0) {
      const { data: tagRows, error: tagsError } = await supabase
        .from("ticket_tags")
        .select("id")
        .eq("organization_id", activeOrgId)
        .in("id", tagIds)
        .returns<TicketTagRow[]>();

      if (tagsError) {
        if (isMissingTicketTagsSchema(tagsError)) {
          return NextResponse.json(
            {
              error: missingTableMessageWithMigration(
                "ticket_tags",
                "db/ticket-tags-schema.sql",
              ),
            },
            { status: 500 },
          );
        }

        return NextResponse.json(
          { error: `Failed to validate ticket tags: ${tagsError.message}` },
          { status: 500 },
        );
      }

      if ((tagRows ?? []).length !== tagIds.length) {
        return NextResponse.json(
          { error: "One or more tag ids are invalid for this organization" },
          { status: 400 },
        );
      }

      const { data: assignmentRows, error: assignmentsError } = await supabase
        .from("ticket_tag_assignments")
        .select("ticket_id, tag_id")
        .eq("organization_id", activeOrgId)
        .in("tag_id", tagIds)
        .returns<TicketTagAssignmentRow[]>();

      if (assignmentsError) {
        if (isMissingTicketTagsSchema(assignmentsError)) {
          return NextResponse.json(
            {
              error: missingTableMessageWithMigration(
                "ticket_tag_assignments",
                "db/ticket-tags-schema.sql",
              ),
            },
            { status: 500 },
          );
        }

        return NextResponse.json(
          { error: `Failed to filter tickets by tags: ${assignmentsError.message}` },
          { status: 500 },
        );
      }

      const matchedTagsByTicketId = new Map<string, Set<string>>();
      for (const row of assignmentRows ?? []) {
        const existing = matchedTagsByTicketId.get(row.ticket_id);
        if (existing) {
          existing.add(row.tag_id);
          continue;
        }
        matchedTagsByTicketId.set(row.ticket_id, new Set([row.tag_id]));
      }

      tagFilteredTicketIds = Array.from(matchedTagsByTicketId.entries())
        .filter(([, matchedTagIds]) => matchedTagIds.size === tagIds.length)
        .map(([ticketId]) => ticketId);
    }

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

    let shouldSkipTicketFetch = false;
    if (assigneeId && assigneeId !== "all") {
      if (
        roleFilteredAssigneeIds &&
        !roleFilteredAssigneeIds.includes(assigneeId)
      ) {
        shouldSkipTicketFetch = true;
      } else {
        query = query.eq("assignee_id", assigneeId);
      }
    } else if (roleFilteredAssigneeIds) {
      if (roleFilteredAssigneeIds.length === 0) {
        shouldSkipTicketFetch = true;
      } else {
        query = query.in("assignee_id", roleFilteredAssigneeIds);
      }
    }

    if (customerId && customerId !== "all") {
      query = query.eq("customer_id", customerId);
    }
    if (tagFilteredTicketIds) {
      if (tagFilteredTicketIds.length === 0) {
        shouldSkipTicketFetch = true;
      } else {
        query = query.in("id", tagFilteredTicketIds);
      }
    }
    if (createdFrom) {
      query = query.gte("created_at", createdFrom);
    }
    if (createdTo) {
      query = query.lte("created_at", createdTo);
    }
    if (search.length > 0) {
      const safeSearch = search.replace(/[%_,]/g, "");
      if (safeSearch.length > 0) {
        query = query.or(
          `title.ilike.%${safeSearch}%,description.ilike.%${safeSearch}%`,
        );
      }
    }

    let tickets: TicketRow[] = [];
    if (!shouldSkipTicketFetch) {
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

      tickets = ticketsData ?? [];
    }

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
    const ticketCreatedAt = new Date().toISOString();
    let resolvedSlaDueAt = slaDueAt;

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

    if (!resolvedSlaDueAt) {
      const policy = await getSlaPolicyByPriority({
        supabase,
        organizationId: activeOrgId,
        priority,
      });
      if (policy) {
        resolvedSlaDueAt = computeResolutionDueAtFromPolicy({
          createdAt: ticketCreatedAt,
          policy,
        });
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
        sla_due_at: resolvedSlaDueAt,
        created_at: ticketCreatedAt,
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

    const assigneeRecipients = getUniqueRecipientIds(
      [insertedTicket.assignee_id],
      userId,
    );
    if (assigneeRecipients.length > 0) {
      await insertAppNotifications(
        supabase,
        assigneeRecipients.map((recipientId) => ({
          userId: recipientId,
          organizationId: activeOrgId,
          type: "ticket",
          title: "New ticket assigned",
          body: `Ticket "${insertedTicket.title}" has been assigned to you.`,
          entityType: "ticket",
          entityId: insertedTicket.id,
        })),
      );
    }

    await runSlaEscalationEngine({
      supabase,
      organizationId: activeOrgId,
      actorUserId: userId,
      ticketId: insertedTicket.id,
    });

    return NextResponse.json({ ticket }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }
}
