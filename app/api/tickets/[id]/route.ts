import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/server/audit-logs";
import { getTicketRequestContext } from "@/lib/server/ticket-context";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  getUniqueRecipientIds,
  insertAppNotifications,
} from "@/lib/server/notifications";
import type {
  TicketCustomer,
  TicketDetailResponse,
  TicketListItem,
  TicketText,
  TicketTextWithAttachments,
  TicketUser,
  TicketAttachment,
} from "@/lib/tickets/types";
import {
  isTicketPriority,
  isTicketStatus,
} from "@/lib/tickets/validation";
import {
  isMissingTableInSchemaCache,
  missingTableMessage,
  missingTableMessageWithMigration,
} from "@/lib/tickets/errors";

type TicketRow = Omit<TicketListItem, "assignee" | "creator" | "customer">;
type TicketTextRow = Omit<TicketText, "author">;
type TicketAttachmentRow = Omit<TicketAttachment, "uploader">;
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

type RouteContext = {
  params: Promise<{ id: string }>;
};

type UpdateTicketBody = {
  title?: string;
  description?: string | null;
  status?: string;
  priority?: string;
  assigneeId?: string | null;
  slaDueAt?: string | null;
  customerId?: string | null;
};

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length ? normalized : null;
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

function normalizeMembershipUser(row: MembershipUserRow): UserRow | null {
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

function toLabel(value: string): string {
  return value
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

async function loadAssignees(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  organizationId: string,
) {
  const { data, error } = await supabase
    .from("organization_memberships")
    .select("user_id, users(id, name, email, avatar_url)")
    .eq("organization_id", organizationId)
    .returns<MembershipUserRow[]>();

  if (error) {
    return {
      ok: false as const,
      error: `Failed to load assignees: ${error.message}`,
    };
  }

  return {
    ok: true as const,
    assignees: (data ?? [])
      .map(normalizeMembershipUser)
      .filter((user): user is UserRow => user !== null),
  };
}

async function buildTicketDetailResponse(params: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  activeOrgId: string;
  ticketId: string;
  userId: string;
}): Promise<
  { ok: true; data: TicketDetailResponse } | { ok: false; status: number; error: string }
> {
  const { supabase, activeOrgId, ticketId, userId } = params;

  const { data: ticketRow, error: ticketError } = await supabase
    .from("tickets")
    .select(
      "id, organization_id, customer_id, order_id, title, description, status, priority, assignee_id, created_by, sla_due_at, created_at, updated_at, closed_at",
    )
    .eq("id", ticketId)
    .eq("organization_id", activeOrgId)
    .maybeSingle<TicketRow>();

  if (ticketError) {
    if (isMissingTableInSchemaCache(ticketError, "tickets")) {
      return {
        ok: false,
        status: 500,
        error: missingTableMessage("tickets"),
      };
    }
    return {
      ok: false,
      status: 500,
      error: `Failed to load ticket: ${ticketError.message}`,
    };
  }

  if (!ticketRow) {
    return {
      ok: false,
      status: 404,
      error: "Ticket not found",
    };
  }

  const [{ data: textRows, error: textError }, { data: attachmentRows, error: attachmentError }] =
    await Promise.all([
      supabase
        .from("ticket_texts")
        .select(
          "id, organization_id, ticket_id, author_id, type, body, created_at, updated_at",
        )
        .eq("organization_id", activeOrgId)
        .eq("ticket_id", ticketId)
        .order("created_at", { ascending: true })
        .returns<TicketTextRow[]>(),
      supabase
        .from("ticket_attachments")
        .select(
          "id, organization_id, ticket_id, ticket_text_id, file_name, file_size, mime_type, storage_key, uploaded_by, created_at",
        )
        .eq("organization_id", activeOrgId)
        .eq("ticket_id", ticketId)
        .order("created_at", { ascending: true })
        .returns<TicketAttachmentRow[]>(),
    ]);

  if (textError) {
    if (isMissingTableInSchemaCache(textError, "ticket_texts")) {
      return {
        ok: false,
        status: 500,
        error: missingTableMessage("ticket_texts"),
      };
    }
    return {
      ok: false,
      status: 500,
      error: `Failed to load ticket messages: ${textError.message}`,
    };
  }
  if (attachmentError) {
    if (isMissingTableInSchemaCache(attachmentError, "ticket_attachments")) {
      return {
        ok: false,
        status: 500,
        error: missingTableMessage("ticket_attachments"),
      };
    }
    return {
      ok: false,
      status: 500,
      error: `Failed to load ticket attachments: ${attachmentError.message}`,
    };
  }

  const ticketTexts = textRows ?? [];
  const ticketAttachmentsRaw = attachmentRows ?? [];

  const userIds = Array.from(
    new Set(
      [
        ticketRow.created_by,
        ticketRow.assignee_id,
        ...ticketTexts.map((text) => text.author_id),
        ...ticketAttachmentsRaw.map((attachment) => attachment.uploaded_by),
      ]
        .filter(Boolean)
        .map((id) => id as string),
    ),
  );

  let usersById = new Map<string, UserRow>();
  if (userIds.length > 0) {
    const { data: users, error: usersError } = await supabase
      .from("users")
      .select("id, name, email, avatar_url")
      .in("id", userIds)
      .returns<UserRow[]>();

    if (usersError) {
      return {
        ok: false,
        status: 500,
        error: `Failed to load ticket users: ${usersError.message}`,
      };
    }

    usersById = new Map((users ?? []).map((user) => [user.id, user]));
  }

  const assigneesResult = await loadAssignees(supabase, activeOrgId);
  if (!assigneesResult.ok) {
    return { ok: false, status: 500, error: assigneesResult.error };
  }

  const attachments: TicketAttachment[] = ticketAttachmentsRaw.map((attachment) => ({
    ...attachment,
    uploader: usersById.get(attachment.uploaded_by) ?? null,
  }));

  const attachmentsByTextId = new Map<string, TicketAttachment[]>();
  for (const attachment of attachments) {
    if (!attachment.ticket_text_id) {
      continue;
    }
    const existing = attachmentsByTextId.get(attachment.ticket_text_id);
    if (existing) {
      existing.push(attachment);
    } else {
      attachmentsByTextId.set(attachment.ticket_text_id, [attachment]);
    }
  }

  const texts: TicketTextWithAttachments[] = ticketTexts.map((text) => ({
    ...text,
    author: usersById.get(text.author_id) ?? null,
    attachments: attachmentsByTextId.get(text.id) ?? [],
  }));

  const ticket: TicketListItem = {
    ...ticketRow,
    assignee: ticketRow.assignee_id ? usersById.get(ticketRow.assignee_id) ?? null : null,
    creator: usersById.get(ticketRow.created_by) ?? null,
    customer: null,
  };

  if (ticketRow.customer_id) {
    const { data: customerData, error: customerError } = await supabase
      .from("customers")
      .select("id, name, email")
      .eq("id", ticketRow.customer_id)
      .eq("organization_id", activeOrgId)
      .maybeSingle<CustomerRow>();

    if (customerError) {
      if (isMissingTableInSchemaCache(customerError, "customers")) {
        return {
          ok: false,
          status: 500,
          error: missingTableMessageWithMigration("customers", "db/customers-schema.sql"),
        };
      }
      return {
        ok: false,
        status: 500,
        error: `Failed to load ticket customer: ${customerError.message}`,
      };
    }

    ticket.customer = customerData ?? null;
  }

  return {
    ok: true,
    data: {
      ticket,
      texts,
      attachments,
      assignees: assigneesResult.assignees,
      activeOrgId,
      currentUserId: userId,
    },
  };
}

async function resolveTicketId(context: RouteContext) {
  const params = await context.params;
  return params.id?.trim() ?? "";
}

export async function GET(_req: Request, context: RouteContext) {
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

  const ticketId = await resolveTicketId(context);
  if (!ticketId) {
    return NextResponse.json({ error: "Ticket id is required" }, { status: 400 });
  }

  const detailResult = await buildTicketDetailResponse({
    supabase,
    activeOrgId,
    ticketId,
    userId,
  });
  if (!detailResult.ok) {
    return NextResponse.json({ error: detailResult.error }, { status: detailResult.status });
  }

  return NextResponse.json(detailResult.data, { status: 200 });
}

export async function PATCH(req: Request, context: RouteContext) {
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

  const ticketId = await resolveTicketId(context);
  if (!ticketId) {
    return NextResponse.json({ error: "Ticket id is required" }, { status: 400 });
  }

  let body: UpdateTicketBody;
  try {
    body = (await req.json()) as UpdateTicketBody;
  } catch {
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }

  const { data: existingTicket, error: existingTicketError } = await supabase
    .from("tickets")
    .select(
      "id, organization_id, customer_id, order_id, title, description, status, priority, assignee_id, created_by, sla_due_at, created_at, updated_at, closed_at",
    )
    .eq("id", ticketId)
    .eq("organization_id", activeOrgId)
    .maybeSingle<TicketRow>();

  if (existingTicketError) {
    if (isMissingTableInSchemaCache(existingTicketError, "tickets")) {
      return NextResponse.json(
        { error: missingTableMessage("tickets") },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to load ticket: ${existingTicketError.message}` },
      { status: 500 },
    );
  }
  if (!existingTicket) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }

  const updatePayload: Partial<TicketRow> = {};
  const systemMessages: string[] = [];
  let statusChange: { from: string; to: string } | null = null;
  let priorityChange: { from: string; to: string } | null = null;
  let assigneeChange: { from: string | null; to: string | null } | null = null;
  let effectiveAssigneeId = existingTicket.assignee_id;

  const hasTitle = Object.prototype.hasOwnProperty.call(body, "title");
  if (hasTitle) {
    const title = normalizeText(body.title);
    if (!title) {
      return NextResponse.json(
        { error: "Title cannot be empty when provided" },
        { status: 400 },
      );
    }
    if (title !== existingTicket.title) {
      updatePayload.title = title;
      systemMessages.push("Title updated");
    }
  }

  const hasDescription = Object.prototype.hasOwnProperty.call(body, "description");
  if (hasDescription) {
    const description = normalizeText(body.description);
    if (description !== existingTicket.description) {
      updatePayload.description = description;
      systemMessages.push("Description updated");
    }
  }

  const hasStatus = Object.prototype.hasOwnProperty.call(body, "status");
  if (hasStatus) {
    if (!body.status || !isTicketStatus(body.status)) {
      return NextResponse.json({ error: "Invalid ticket status" }, { status: 400 });
    }
    if (body.status !== existingTicket.status) {
      updatePayload.status = body.status;
      statusChange = {
        from: existingTicket.status,
        to: body.status,
      };
      systemMessages.push(
        `Status changed from ${toLabel(existingTicket.status)} to ${toLabel(body.status)}`,
      );
      if (body.status === "closed") {
        updatePayload.closed_at = new Date().toISOString();
      } else if (existingTicket.status === "closed") {
        updatePayload.closed_at = null;
      }
    }
  }

  const hasPriority = Object.prototype.hasOwnProperty.call(body, "priority");
  if (hasPriority) {
    if (!body.priority || !isTicketPriority(body.priority)) {
      return NextResponse.json({ error: "Invalid ticket priority" }, { status: 400 });
    }
    if (body.priority !== existingTicket.priority) {
      updatePayload.priority = body.priority;
      priorityChange = {
        from: existingTicket.priority,
        to: body.priority,
      };
      systemMessages.push(
        `Priority changed from ${toLabel(existingTicket.priority)} to ${toLabel(body.priority)}`,
      );
    }
  }

  const hasAssignee = Object.prototype.hasOwnProperty.call(body, "assigneeId");
  if (hasAssignee) {
    const assigneeId = normalizeText(body.assigneeId);
    if (assigneeId) {
      const { count, error: membershipError } = await supabase
        .from("organization_memberships")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", activeOrgId)
        .eq("user_id", assigneeId);

      if (membershipError) {
        return NextResponse.json(
          { error: `Failed to verify assignee membership: ${membershipError.message}` },
          { status: 500 },
        );
      }
      if (!count) {
        return NextResponse.json(
          { error: "Selected assignee is not a member of this organization" },
          { status: 400 },
        );
      }
    }

    if (assigneeId !== existingTicket.assignee_id) {
      updatePayload.assignee_id = assigneeId;
      assigneeChange = {
        from: existingTicket.assignee_id,
        to: assigneeId,
      };
      effectiveAssigneeId = assigneeId;
      systemMessages.push("Assignee updated");
    }
  }

  const hasCustomer = Object.prototype.hasOwnProperty.call(body, "customerId");
  if (hasCustomer) {
    const customerId = normalizeText(body.customerId);
    if (!customerId && existingTicket.order_id) {
      return NextResponse.json(
        {
          error:
            "Cannot unlink customer while ticket is linked to an order. Keep customer aligned with the order.",
        },
        { status: 400 },
      );
    }

    if (existingTicket.order_id) {
      const { data: orderData, error: orderError } = await supabase
        .from("orders")
        .select("id, customer_id")
        .eq("organization_id", activeOrgId)
        .eq("id", existingTicket.order_id)
        .maybeSingle<OrderAccessRow>();

      if (orderError) {
        if (isMissingTableInSchemaCache(orderError, "orders")) {
          return NextResponse.json(
            { error: missingTableMessageWithMigration("orders", "db/orders-schema.sql") },
            { status: 500 },
          );
        }
        return NextResponse.json(
          { error: `Failed to verify linked order: ${orderError.message}` },
          { status: 500 },
        );
      }

      if (!orderData) {
        return NextResponse.json(
          { error: "Ticket is linked to an order that was not found in this organization" },
          { status: 400 },
        );
      }

      if (customerId && customerId !== orderData.customer_id) {
        return NextResponse.json(
          {
            error:
              "Selected customer does not match the linked order customer",
          },
          { status: 400 },
        );
      }
    }

    if (customerId) {
      const { count, error: customerAccessError } = await supabase
        .from("customers")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", activeOrgId)
        .eq("id", customerId);

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

    if (customerId !== existingTicket.customer_id) {
      updatePayload.customer_id = customerId;
      systemMessages.push("Customer updated");
    }
  }

  const hasSlaDueAt = Object.prototype.hasOwnProperty.call(body, "slaDueAt");
  if (hasSlaDueAt) {
    const slaDueAt = body.slaDueAt ? normalizeIsoDate(body.slaDueAt) : null;
    if (body.slaDueAt && !slaDueAt) {
      return NextResponse.json(
        { error: "slaDueAt must be a valid date-time string" },
        { status: 400 },
      );
    }
    if (slaDueAt !== existingTicket.sla_due_at) {
      updatePayload.sla_due_at = slaDueAt;
      systemMessages.push("SLA due date updated");
    }
  }

  if (Object.keys(updatePayload).length > 0) {
    const ticketTitleForNotifications = updatePayload.title ?? existingTicket.title;

    const { error: updateError } = await supabase
      .from("tickets")
      .update(updatePayload)
      .eq("id", ticketId)
      .eq("organization_id", activeOrgId);

    if (updateError) {
      if (isMissingTableInSchemaCache(updateError, "tickets")) {
        return NextResponse.json(
          { error: missingTableMessage("tickets") },
          { status: 500 },
        );
      }
      return NextResponse.json(
        { error: `Failed to update ticket: ${updateError.message}` },
        { status: 500 },
      );
    }

    if (systemMessages.length > 0) {
      const timelineRows = systemMessages.map((bodyText) => ({
        organization_id: activeOrgId,
        ticket_id: ticketId,
        author_id: userId,
        type: "system" as const,
        body: bodyText,
      }));
      const { error: timelineError } = await supabase
        .from("ticket_texts")
        .insert(timelineRows);

      if (timelineError) {
        if (isMissingTableInSchemaCache(timelineError, "ticket_texts")) {
          return NextResponse.json(
            { error: missingTableMessage("ticket_texts") },
            { status: 500 },
          );
        }
        return NextResponse.json(
          { error: `Ticket updated but failed to record timeline: ${timelineError.message}` },
          { status: 500 },
        );
      }
    }

    if (assigneeChange?.to) {
      const recipients = getUniqueRecipientIds([assigneeChange.to], userId);
      if (recipients.length > 0) {
        await insertAppNotifications(
          supabase,
          recipients.map((recipientId) => ({
            userId: recipientId,
            organizationId: activeOrgId,
            type: "ticket",
            title: "Ticket assigned to you",
            body: `Ticket "${ticketTitleForNotifications}" has been assigned to you.`,
            entityType: "ticket",
            entityId: ticketId,
          })),
        );
      }
    }

    if (assigneeChange?.from && assigneeChange.from !== assigneeChange.to) {
      const recipients = getUniqueRecipientIds([assigneeChange.from], userId);
      if (recipients.length > 0) {
        const title = assigneeChange.to ? "Ticket reassigned" : "Ticket unassigned";
        await insertAppNotifications(
          supabase,
          recipients.map((recipientId) => ({
            userId: recipientId,
            organizationId: activeOrgId,
            type: "ticket",
            title,
            body: `Ticket "${ticketTitleForNotifications}" is no longer assigned to you.`,
            entityType: "ticket",
            entityId: ticketId,
          })),
        );
      }
    }

    if (statusChange) {
      const recipients = getUniqueRecipientIds(
        [existingTicket.created_by, effectiveAssigneeId],
        userId,
      );
      if (recipients.length > 0) {
        await insertAppNotifications(
          supabase,
          recipients.map((recipientId) => ({
            userId: recipientId,
            organizationId: activeOrgId,
            type: "ticket",
            title: "Ticket status updated",
            body: `Ticket "${ticketTitleForNotifications}" moved from ${toLabel(statusChange.from)} to ${toLabel(statusChange.to)}.`,
            entityType: "ticket",
            entityId: ticketId,
          })),
        );
      }
    }

    if (priorityChange) {
      const recipients = getUniqueRecipientIds(
        [existingTicket.created_by, effectiveAssigneeId],
        userId,
      );
      if (recipients.length > 0) {
        await insertAppNotifications(
          supabase,
          recipients.map((recipientId) => ({
            userId: recipientId,
            organizationId: activeOrgId,
            type: "ticket",
            title: "Ticket priority updated",
            body: `Ticket "${ticketTitleForNotifications}" priority changed from ${toLabel(priorityChange.from)} to ${toLabel(priorityChange.to)}.`,
            entityType: "ticket",
            entityId: ticketId,
          })),
        );
      }
    }

    if (assigneeChange) {
      const assigneeAction =
        assigneeChange.from && assigneeChange.to
          ? "ticket.assignee.reassigned"
          : assigneeChange.to
            ? "ticket.assignee.assigned"
            : "ticket.assignee.unassigned";

      await writeAuditLog({
        supabase,
        organizationId: activeOrgId,
        actorUserId: userId,
        action: assigneeAction,
        entityType: "ticket",
        entityId: ticketId,
        targetUserId: assigneeChange.to ?? assigneeChange.from,
        details: {
          fromAssigneeId: assigneeChange.from,
          toAssigneeId: assigneeChange.to,
        },
      });
    }

    if (statusChange) {
      await writeAuditLog({
        supabase,
        organizationId: activeOrgId,
        actorUserId: userId,
        action: "ticket.status.changed",
        entityType: "ticket",
        entityId: ticketId,
        details: {
          fromStatus: statusChange.from,
          toStatus: statusChange.to,
        },
      });
    }

    if (priorityChange) {
      await writeAuditLog({
        supabase,
        organizationId: activeOrgId,
        actorUserId: userId,
        action: "ticket.priority.changed",
        entityType: "ticket",
        entityId: ticketId,
        details: {
          fromPriority: priorityChange.from,
          toPriority: priorityChange.to,
        },
      });
    }
  }

  const detailResult = await buildTicketDetailResponse({
    supabase,
    activeOrgId,
    ticketId,
    userId,
  });
  if (!detailResult.ok) {
    return NextResponse.json({ error: detailResult.error }, { status: detailResult.status });
  }

  return NextResponse.json(detailResult.data, { status: 200 });
}
