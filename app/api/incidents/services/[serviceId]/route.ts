import { NextResponse } from "next/server";
import { getTicketRequestContext } from "@/lib/server/ticket-context";
import { writeAuditLog } from "@/lib/server/audit-logs";
import { isIncidentServiceHealth } from "@/lib/incidents/validation";
import {
  canManageIncidents,
  isMissingIncidentsSchema,
  normalizeText,
  resolveOrganizationRole,
} from "@/lib/server/incidents";
import { missingTableMessageWithMigration } from "@/lib/tickets/errors";

type RouteContext = {
  params: Promise<{ serviceId: string }>;
};

type UpdateServiceBody = {
  name?: string;
  description?: string | null;
  currentStatus?: string;
  isPublic?: boolean;
  displayOrder?: number;
};

async function resolveServiceId(context: RouteContext): Promise<string> {
  const params = await context.params;
  return params.serviceId?.trim() ?? "";
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

  const role = await resolveOrganizationRole({
    supabase,
    organizationId: activeOrgId,
    userId,
  });
  if (!canManageIncidents(role)) {
    return NextResponse.json(
      { error: "Only admin, manager, or support can edit services" },
      { status: 403 },
    );
  }

  const serviceId = await resolveServiceId(context);
  if (!serviceId) {
    return NextResponse.json({ error: "serviceId is required" }, { status: 400 });
  }

  let body: UpdateServiceBody = {};
  try {
    body = (await req.json()) as UpdateServiceBody;
  } catch {
    body = {};
  }

  const patch: Record<string, unknown> = {};

  if (Object.prototype.hasOwnProperty.call(body, "name")) {
    const name = normalizeText(body.name);
    if (!name) {
      return NextResponse.json({ error: "Service name cannot be empty" }, { status: 400 });
    }
    patch.name = name;
  }

  if (Object.prototype.hasOwnProperty.call(body, "description")) {
    patch.description = normalizeText(body.description);
  }

  if (Object.prototype.hasOwnProperty.call(body, "currentStatus")) {
    if (!isIncidentServiceHealth(body.currentStatus)) {
      return NextResponse.json({ error: "Invalid service health status" }, { status: 400 });
    }
    patch.current_status = body.currentStatus;
  }

  if (Object.prototype.hasOwnProperty.call(body, "isPublic")) {
    patch.is_public = body.isPublic !== false;
  }

  if (Object.prototype.hasOwnProperty.call(body, "displayOrder")) {
    if (
      typeof body.displayOrder !== "number" ||
      !Number.isFinite(body.displayOrder) ||
      !Number.isInteger(body.displayOrder)
    ) {
      return NextResponse.json(
        { error: "displayOrder must be an integer number" },
        { status: 400 },
      );
    }
    patch.display_order = body.displayOrder;
  }

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "No changes provided" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("status_services")
    .update(patch)
    .eq("organization_id", activeOrgId)
    .eq("id", serviceId)
    .select(
      "id, organization_id, name, slug, description, current_status, is_public, display_order, created_by, created_at, updated_at",
    )
    .maybeSingle();

  if (error) {
    if (isMissingIncidentsSchema(error)) {
      return NextResponse.json(
        { error: missingTableMessageWithMigration("status_services", "db/incidents-schema.sql") },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to update service: ${error.message}` },
      { status: 500 },
    );
  }

  if (!data) {
    return NextResponse.json({ error: "Service not found" }, { status: 404 });
  }

  await writeAuditLog({
    supabase,
    organizationId: activeOrgId,
    actorUserId: userId,
    action: "incident.service.updated",
    entityType: "status_service",
    entityId: serviceId,
    details: patch,
  });

  return NextResponse.json({ service: data }, { status: 200 });
}

export async function DELETE(_req: Request, context: RouteContext) {
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

  const role = await resolveOrganizationRole({
    supabase,
    organizationId: activeOrgId,
    userId,
  });
  if (!canManageIncidents(role)) {
    return NextResponse.json(
      { error: "Only admin, manager, or support can delete services" },
      { status: 403 },
    );
  }

  const serviceId = await resolveServiceId(context);
  if (!serviceId) {
    return NextResponse.json({ error: "serviceId is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("status_services")
    .delete()
    .eq("organization_id", activeOrgId)
    .eq("id", serviceId);

  if (error) {
    if (isMissingIncidentsSchema(error)) {
      return NextResponse.json(
        { error: missingTableMessageWithMigration("status_services", "db/incidents-schema.sql") },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to delete service: ${error.message}` },
      { status: 500 },
    );
  }

  await writeAuditLog({
    supabase,
    organizationId: activeOrgId,
    actorUserId: userId,
    action: "incident.service.deleted",
    entityType: "status_service",
    entityId: serviceId,
  });

  return NextResponse.json({ success: true }, { status: 200 });
}

