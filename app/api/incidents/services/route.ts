import { NextResponse } from "next/server";
import { getTicketRequestContext } from "@/lib/server/ticket-context";
import { writeAuditLog } from "@/lib/server/audit-logs";
import type { IncidentService } from "@/lib/incidents/types";
import { isIncidentServiceHealth } from "@/lib/incidents/validation";
import {
  canManageIncidents,
  generateUniqueServiceSlug,
  isMissingIncidentsSchema,
  normalizeText,
  resolveOrganizationRole,
} from "@/lib/server/incidents";
import { missingTableMessageWithMigration } from "@/lib/tickets/errors";

type CreateServiceBody = {
  name?: string;
  description?: string | null;
  isPublic?: boolean;
  displayOrder?: number;
  currentStatus?: string;
};

export async function GET() {
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

  const { data, error } = await supabase
    .from("status_services")
    .select(
      "id, organization_id, name, slug, description, current_status, is_public, display_order, created_by, created_at, updated_at",
    )
    .eq("organization_id", activeOrgId)
    .order("display_order", { ascending: true })
    .order("name", { ascending: true })
    .returns<IncidentService[]>();

  if (error) {
    if (isMissingIncidentsSchema(error)) {
      return NextResponse.json(
        { error: missingTableMessageWithMigration("status_services", "db/incidents-schema.sql") },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to load status services: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ services: data ?? [] }, { status: 200 });
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

  const role = await resolveOrganizationRole({
    supabase,
    organizationId: activeOrgId,
    userId,
  });
  if (!canManageIncidents(role)) {
    return NextResponse.json(
      { error: "Only admin, manager, or support can create services" },
      { status: 403 },
    );
  }

  let body: CreateServiceBody = {};
  try {
    body = (await req.json()) as CreateServiceBody;
  } catch {
    body = {};
  }

  const name = normalizeText(body.name);
  if (!name) {
    return NextResponse.json({ error: "Service name is required" }, { status: 400 });
  }

  const description = normalizeText(body.description);
  const isPublic = body.isPublic !== false;
  const currentStatus = isIncidentServiceHealth(body.currentStatus)
    ? body.currentStatus
    : "operational";
  const displayOrder =
    typeof body.displayOrder === "number" && Number.isFinite(body.displayOrder)
      ? Math.trunc(body.displayOrder)
      : 0;

  try {
    const slug = await generateUniqueServiceSlug({
      supabase,
      organizationId: activeOrgId,
      baseName: name,
    });

    const { data: insertedService, error: insertError } = await supabase
      .from("status_services")
      .insert({
        organization_id: activeOrgId,
        name,
        slug,
        description,
        current_status: currentStatus,
        is_public: isPublic,
        display_order: displayOrder,
        created_by: userId,
      })
      .select(
        "id, organization_id, name, slug, description, current_status, is_public, display_order, created_by, created_at, updated_at",
      )
      .maybeSingle<IncidentService>();

    if (insertError || !insertedService) {
      if (isMissingIncidentsSchema(insertError)) {
        return NextResponse.json(
          { error: missingTableMessageWithMigration("status_services", "db/incidents-schema.sql") },
          { status: 500 },
        );
      }
      return NextResponse.json(
        { error: `Failed to create service: ${insertError?.message ?? "Unknown error"}` },
        { status: 500 },
      );
    }

    await writeAuditLog({
      supabase,
      organizationId: activeOrgId,
      actorUserId: userId,
      action: "incident.service.created",
      entityType: "status_service",
      entityId: insertedService.id,
      details: {
        name: insertedService.name,
        slug: insertedService.slug,
      },
    });

    return NextResponse.json({ service: insertedService }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to create service";
    if (isMissingIncidentsSchema({ message })) {
      return NextResponse.json(
        { error: missingTableMessageWithMigration("status_services", "db/incidents-schema.sql") },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

