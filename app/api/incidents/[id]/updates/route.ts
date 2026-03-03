import { NextResponse } from "next/server";
import { getTicketRequestContext } from "@/lib/server/ticket-context";
import { writeAuditLog } from "@/lib/server/audit-logs";
import { isIncidentStatus } from "@/lib/incidents/validation";
import {
  canManageIncidents,
  isMissingIncidentsSchema,
  normalizeText,
  recalculateServiceStatuses,
  resolveOrganizationRole,
} from "@/lib/server/incidents";
import { missingTableMessageWithMigration } from "@/lib/tickets/errors";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type CreateIncidentUpdateBody = {
  message?: string;
  status?: string;
  isPublic?: boolean;
};

type IncidentRow = {
  id: string;
  status: "investigating" | "identified" | "monitoring" | "resolved";
};

async function resolveIncidentId(context: RouteContext): Promise<string> {
  const params = await context.params;
  return params.id?.trim() ?? "";
}

export async function POST(req: Request, context: RouteContext) {
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
      { error: "Only admin, manager, or support can post incident updates" },
      { status: 403 },
    );
  }

  const incidentId = await resolveIncidentId(context);
  if (!incidentId) {
    return NextResponse.json({ error: "Incident id is required" }, { status: 400 });
  }

  let body: CreateIncidentUpdateBody = {};
  try {
    body = (await req.json()) as CreateIncidentUpdateBody;
  } catch {
    body = {};
  }

  const message = normalizeText(body.message);
  const hasStatusInput = Object.prototype.hasOwnProperty.call(body, "status");
  if (hasStatusInput && !isIncidentStatus(body.status)) {
    return NextResponse.json({ error: "Invalid incident status" }, { status: 400 });
  }

  if (!message && !hasStatusInput) {
    return NextResponse.json(
      { error: "Provide a message or status to create a timeline update" },
      { status: 400 },
    );
  }

  const { data: incident, error: incidentError } = await supabase
    .from("incidents")
    .select("id, status")
    .eq("organization_id", activeOrgId)
    .eq("id", incidentId)
    .maybeSingle<IncidentRow>();

  if (incidentError) {
    if (isMissingIncidentsSchema(incidentError)) {
      return NextResponse.json(
        { error: missingTableMessageWithMigration("incidents", "db/incidents-schema.sql") },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to load incident: ${incidentError.message}` },
      { status: 500 },
    );
  }

  if (!incident) {
    return NextResponse.json({ error: "Incident not found" }, { status: 404 });
  }

  const nextStatus = hasStatusInput ? (body.status as IncidentRow["status"]) : incident.status;
  const statusChanged = nextStatus !== incident.status;
  const timelineMessage = message ?? (statusChanged ? `Status changed to ${nextStatus}.` : null);
  if (!timelineMessage) {
    return NextResponse.json(
      { error: "Provide a timeline message when status is unchanged" },
      { status: 400 },
    );
  }

  const { error: insertUpdateError } = await supabase.from("incident_updates").insert({
    organization_id: activeOrgId,
    incident_id: incidentId,
    message: timelineMessage,
    status: hasStatusInput ? nextStatus : null,
    is_public: body.isPublic !== false,
    created_by: userId,
  });

  if (insertUpdateError) {
    if (isMissingIncidentsSchema(insertUpdateError)) {
      return NextResponse.json(
        { error: missingTableMessageWithMigration("incident_updates", "db/incidents-schema.sql") },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to create incident update: ${insertUpdateError.message}` },
      { status: 500 },
    );
  }

  if (statusChanged) {
    const { error: updateIncidentError } = await supabase
      .from("incidents")
      .update({
        status: nextStatus,
        resolved_at: nextStatus === "resolved" ? new Date().toISOString() : null,
      })
      .eq("organization_id", activeOrgId)
      .eq("id", incidentId);

    if (updateIncidentError) {
      return NextResponse.json(
        {
          error: `Timeline update created but failed to update incident status: ${updateIncidentError.message}`,
        },
        { status: 500 },
      );
    }

    const { data: impacts } = await supabase
      .from("incident_impacts")
      .select("service_id")
      .eq("organization_id", activeOrgId)
      .eq("incident_id", incidentId)
      .returns<Array<{ service_id: string }>>();

    const serviceIds = Array.from(new Set((impacts ?? []).map((impact) => impact.service_id)));
    if (serviceIds.length > 0) {
      await recalculateServiceStatuses({
        supabase,
        organizationId: activeOrgId,
        serviceIds,
      });
    }
  }

  await writeAuditLog({
    supabase,
    organizationId: activeOrgId,
    actorUserId: userId,
    action: "incident.timeline.updated",
    entityType: "incident",
    entityId: incidentId,
    details: {
      statusChanged,
      status: hasStatusInput ? nextStatus : null,
      isPublic: body.isPublic !== false,
    },
  });

  return NextResponse.json({ success: true }, { status: 201 });
}

