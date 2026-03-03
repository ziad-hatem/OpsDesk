import { NextResponse } from "next/server";
import { getTicketRequestContext } from "@/lib/server/ticket-context";
import type {
  CustomerListItem,
  CustomersListResponse,
} from "@/lib/customers/types";
import { isCustomerStatus, normalizeCustomerStatus } from "@/lib/customers/validation";
import { isMissingTableInSchemaCache, missingTableMessageWithMigration } from "@/lib/tickets/errors";
import type { TicketStatus } from "@/lib/tickets/types";
import type { OrderStatus } from "@/lib/orders/types";

type CustomerRow = Omit<
  CustomerListItem,
  "open_tickets_count" | "total_tickets_count" | "total_orders_count" | "total_revenue_amount"
>;

type TicketCountRow = {
  customer_id: string | null;
  status: TicketStatus;
};

type OrderCountRow = {
  customer_id: string | null;
  status: OrderStatus;
  total_amount: number;
};

type CreateCustomerBody = {
  name?: string;
  email?: string | null;
  phone?: string | null;
  status?: string;
  externalId?: string | null;
};

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeEmail(value: unknown): string | null {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  return normalized.toLowerCase();
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

function getRevenueDeltaFromOrder(row: OrderCountRow): number {
  if (row.status === "paid" || row.status === "fulfilled") {
    return row.total_amount;
  }
  if (row.status === "refunded") {
    return -row.total_amount;
  }
  return 0;
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
    const statusFilter = searchParams.get("status");
    const createdFrom = normalizeIsoDateQueryParam(searchParams.get("createdFrom"));
    const createdTo = normalizeIsoDateQueryParam(searchParams.get("createdTo"));
    const search = searchParams.get("search")?.trim() ?? "";
    const limitParam = Number(searchParams.get("limit") ?? "200");
    const limit = Number.isFinite(limitParam)
      ? Math.min(Math.max(limitParam, 1), 1000)
      : 200;

    let query = supabase
      .from("customers")
      .select("id, organization_id, name, email, phone, status, external_id, created_at, updated_at")
      .eq("organization_id", activeOrgId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (statusFilter && statusFilter !== "all" && isCustomerStatus(statusFilter)) {
      query = query.eq("status", statusFilter);
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
          `name.ilike.%${safeSearch}%,email.ilike.%${safeSearch}%,external_id.ilike.%${safeSearch}%`,
        );
      }
    }

    const { data: customersData, error: customersError } = await query.returns<CustomerRow[]>();
    if (customersError) {
      if (isMissingTableInSchemaCache(customersError, "customers")) {
        return NextResponse.json(
          { error: missingTableMessageWithMigration("customers", "db/customers-schema.sql") },
          { status: 500 },
        );
      }
      return NextResponse.json(
        { error: `Failed to load customers: ${customersError.message}` },
        { status: 500 },
      );
    }

    const customers = customersData ?? [];
    const customerIds = customers.map((customer) => customer.id);
    const openCountsByCustomerId = new Map<string, number>();
    const totalCountsByCustomerId = new Map<string, number>();
    const orderCountsByCustomerId = new Map<string, number>();
    const revenueByCustomerId = new Map<string, number>();

    if (customerIds.length > 0) {
      const { data: ticketCountsData, error: ticketCountsError } = await supabase
        .from("tickets")
        .select("customer_id, status")
        .eq("organization_id", activeOrgId)
        .in("customer_id", customerIds)
        .returns<TicketCountRow[]>();

      if (ticketCountsError && !isMissingTableInSchemaCache(ticketCountsError, "tickets")) {
        return NextResponse.json(
          { error: `Failed to load customer ticket counts: ${ticketCountsError.message}` },
          { status: 500 },
        );
      }

      for (const row of ticketCountsData ?? []) {
        if (!row.customer_id) {
          continue;
        }

        totalCountsByCustomerId.set(
          row.customer_id,
          (totalCountsByCustomerId.get(row.customer_id) ?? 0) + 1,
        );

        if (row.status === "open" || row.status === "pending") {
          openCountsByCustomerId.set(
            row.customer_id,
            (openCountsByCustomerId.get(row.customer_id) ?? 0) + 1,
          );
        }
      }

      const { data: orderCountsData, error: orderCountsError } = await supabase
        .from("orders")
        .select("customer_id, status, total_amount")
        .eq("organization_id", activeOrgId)
        .in("customer_id", customerIds)
        .returns<OrderCountRow[]>();

      if (orderCountsError && !isMissingTableInSchemaCache(orderCountsError, "orders")) {
        return NextResponse.json(
          { error: `Failed to load customer order counts: ${orderCountsError.message}` },
          { status: 500 },
        );
      }

      for (const row of orderCountsData ?? []) {
        if (!row.customer_id) {
          continue;
        }

        orderCountsByCustomerId.set(
          row.customer_id,
          (orderCountsByCustomerId.get(row.customer_id) ?? 0) + 1,
        );

        revenueByCustomerId.set(
          row.customer_id,
          (revenueByCustomerId.get(row.customer_id) ?? 0) + getRevenueDeltaFromOrder(row),
        );
      }
    }

    const responseCustomers: CustomerListItem[] = customers.map((customer) => ({
      ...customer,
      open_tickets_count: openCountsByCustomerId.get(customer.id) ?? 0,
      total_tickets_count: totalCountsByCustomerId.get(customer.id) ?? 0,
      total_orders_count: orderCountsByCustomerId.get(customer.id) ?? 0,
      total_revenue_amount: revenueByCustomerId.get(customer.id) ?? 0,
    }));

    const response: CustomersListResponse = {
      customers: responseCustomers,
      activeOrgId,
      currentUserId: userId,
    };

    return NextResponse.json(response, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Failed to load customers" }, { status: 500 });
  }
}

export async function POST(req: Request) {
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

  try {
    const body = (await req.json()) as CreateCustomerBody;
    const name = normalizeText(body.name);
    const email = normalizeEmail(body.email);
    const phone = normalizeText(body.phone);
    const externalId = normalizeText(body.externalId);
    const status = normalizeCustomerStatus(body.status, "active");

    if (!name) {
      return NextResponse.json({ error: "Customer name is required" }, { status: 400 });
    }

    const { data: insertedCustomer, error: insertError } = await supabase
      .from("customers")
      .insert({
        organization_id: activeOrgId,
        name,
        email,
        phone,
        status,
        external_id: externalId,
      })
      .select("id, organization_id, name, email, phone, status, external_id, created_at, updated_at")
      .single<CustomerRow>();

    if (insertError || !insertedCustomer) {
      if (isMissingTableInSchemaCache(insertError, "customers")) {
        return NextResponse.json(
          { error: missingTableMessageWithMigration("customers", "db/customers-schema.sql") },
          { status: 500 },
        );
      }
      return NextResponse.json(
        { error: `Failed to create customer: ${insertError?.message ?? "Unknown error"}` },
        { status: 500 },
      );
    }

    const customer: CustomerListItem = {
      ...insertedCustomer,
      open_tickets_count: 0,
      total_tickets_count: 0,
      total_orders_count: 0,
      total_revenue_amount: 0,
    };

    return NextResponse.json({ customer }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }
}
