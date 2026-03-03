import { NextResponse } from "next/server";
import { getTicketRequestContext } from "@/lib/server/ticket-context";
import { writeAuditLog } from "@/lib/server/audit-logs";
import { isIncidentImpactLevel, isIncidentSeverity, isIncidentStatus } from "@/lib/incidents/validation";
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

type IncidentRow = {
  id: string;
  organization_id: string;
  title: string;
  summary: string | null;
  status: "investigating" | "identified" | "monitoring" | "resolved";
  severity: "critical" | "high" | "medium" | "low";
  is_public: boolean;
  started_at: string;
  resolved_at: string | null;
};

type IncidentImpactRow = {
  id: string;
  service_id: string;
  impact_level: "degraded" | "partial_outage" | "major_outage" | "maintenance";
};

type ServiceRow = {
  id: string;
};

type UpdateIncidentBody = {
  title?: string;
  summary?: string | null;
  status?: string;
  severity?: string;
  isPublic?: boolean;
  serviceImpacts?: Array<{
    serviceId?: string;
    impactLevel?: string;
  }>;
  updateMessage?: string | null;
  updatePublic?: boolean;
};

async function resolveIncidentId(context: RouteContext): Promise<string> {
  const params = await context.params;
  return params.id?.trim() ?? "";
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
      { error: "Only admin, manager, or support can update incidents" },
      { status: 403 },
    );
  }

  const incidentId = await resolveIncidentId(context);
  if (!incidentId) {
    return NextResponse.json({ error: "Incident id is required" }, { status: 400 });
  }

  const { data: existingIncident, error: incidentError } = await supabase
    .from("incidents")
    .select("id, organization_id, title, summary, status, severity, is_public, started_at, resolved_at")
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
  if (!existingIncident) {
    return NextResponse.json({ error: "Incident not found" }, { status: 404 });
  }

  let body: UpdateIncidentBody = {};
  try {
    body = (await req.json()) as UpdateIncidentBody;
  } catch {
    body = {};
  }

  const patch: Record<string, unknown> = {};
  let nextStatus = existingIncident.status;
  let statusChanged = false;

  if (Object.prototype.hasOwnProperty.call(body, "title")) {
    const title = normalizeText(body.title);
    if (!title) {
      return NextResponse.json({ error: "Incident title cannot be empty" }, { status: 400 });
    }
    patch.title = title;
  }

  if (Object.prototype.hasOwnProperty.call(body, "summary")) {
    patch.summary = normalizeText(body.summary);
  }

  if (Object.prototype.hasOwnProperty.call(body, "severity")) {
    if (!isIncidentSeverity(body.severity)) {
      return NextResponse.json({ error: "Invalid incident severity" }, { status: 400 });
    }
    patch.severity = body.severity;
  }

  if (Object.prototype.hasOwnProperty.call(body, "status")) {
    if (!isIncidentStatus(body.status)) {
      return NextResponse.json({ error: "Invalid incident status" }, { status: 400 });
    }
    patch.status = body.status;
    nextStatus = body.status;
    statusChanged = body.status !== existingIncident.status;
  }

  if (Object.prototype.hasOwnProperty.call(body, "isPublic")) {
    patch.is_public = body.isPublic !== false;
  }

  if (statusChanged) {
    if (nextStatus === "resolved") {
      patch.resolved_at = new Date().toISOString();
    } else {
      patch.resolved_at = null;
    }
  }

  let impactedServiceIdsForRecalc: string[] = [];
  if (Array.isArray(body.serviceImpacts)) {
    const normalized = body.serviceImpacts
      .map((entry) => ({
        serviceId: normalizeText(entry?.serviceId),
        impactLevel: entry?.impactLevel,
      }))
      .filter((entry): entry is { serviceId: string; impactLevel: string | undefined } => Boolean(entry.serviceId));

    const serviceIds = Array.from(new Set(normalized.map((entry) => entry.serviceId)));
    if (serviceIds.length > 0) {
      const { data: services, error: serviceError } = await supabase
        .from("status_services")
        .select("id")
        .eq("organization_id", activeOrgId)
        .in("id", serviceIds)
        .returns<ServiceRow[]>();

      if (serviceError) {
        if (isMissingIncidentsSchema(serviceError)) {
          return NextResponse.json(
            { error: missingTableMessageWithMigration("status_services", "db/incidents-schema.sql") },
            { status: 500 },
          );
        }
        return NextResponse.json(
          { error: `Failed to validate impacted services: ${serviceError.message}` },
          { status: 500 },
        );
      }

      const existingServiceIds = new Set((services ?? []).map((service) => service.id));
      const invalidServiceId = serviceIds.find((id) => !existingServiceIds.has(id));
      if (invalidServiceId) {
        return NextResponse.json(
          { error: "One or more impacted services are invalid for this organization" },
          { status: 400 },
        );
      }
    }

    const { data: existingImpacts, error: existingImpactsError } = await supabase
      .from("incident_impacts")
      .select("id, service_id, impact_level")
      .eq("organization_id", activeOrgId)
      .eq("incident_id", incidentId)
      .returns<IncidentImpactRow[]>();

    if (existingImpactsError) {
      if (isMissingIncidentsSchema(existingImpactsError)) {
        return NextResponse.json(
          { error: missingTableMessageWithMigration("incident_impacts", "db/incidents-schema.sql") },
          { status: 500 },
        );
      }
      return NextResponse.json(
        { error: `Failed to load existing impacts: ${existingImpactsError.message}` },
        { status: 500 },
      );
    }

    const existingByServiceId = new Map(
      (existingImpacts ?? []).map((impact) => [impact.service_id, impact]),
    );

    const toUpsert = normalized.map((impact) => ({
      organization_id: activeOrgId,
      incident_id: incidentId,
      service_id: impact.serviceId,
      impact_level: isIncidentImpactLevel(impact.impactLevel)
        ? impact.impactLevel
        : "degraded",
    }));
    if (toUpsert.length > 0) {
      const { error: upsertError } = await supabase
        .from("incident_impacts")
        .upsert(toUpsert, { onConflict: "incident_id,service_id" });
      if (upsertError) {
        if (isMissingIncidentsSchema(upsertError)) {
          return NextResponse.json(
            { error: missingTableMessageWithMigration("incident_impacts", "db/incidents-schema.sql") },
            { status: 500 },
          );
        }
        return NextResponse.json(
          { error: `Failed to update incident impacts: ${upsertError.message}` },
          { status: 500 },
        );
      }
    }

    const incomingServiceIdSet = new Set(serviceIds);
    const removedServiceIds = Array.from(existingByServiceId.keys()).filter(
      (serviceId) => !incomingServiceIdSet.has(serviceId),
    );
    if (removedServiceIds.length > 0) {
      const { error: deleteError } = await supabase
        .from("incident_impacts")
        .delete()
        .eq("organization_id", activeOrgId)
        .eq("incident_id", incidentId)
        .in("service_id", removedServiceIds);

      if (deleteError) {
        if (isMissingIncidentsSchema(deleteError)) {
          return NextResponse.json(
            { error: missingTableMessageWithMigration("incident_impacts", "db/incidents-schema.sql") },
            { status: 500 },
          );
        }
        return NextResponse.json(
          { error: `Failed to remove old incident impacts: ${deleteError.message}` },
          { status: 500 },
        );
      }
    }

    impactedServiceIdsForRecalc = Array.from(
      new Set([...serviceIds, ...Array.from(existingByServiceId.keys())]),
    );
  } else {
    const { data: impacts } = await supabase
      .from("incident_impacts")
      .select("service_id")
      .eq("organization_id", activeOrgId)
      .eq("incident_id", incidentId)
      .returns<Array<{ service_id: string }>>();
    impactedServiceIdsForRecalc = Array.from(
      new Set((impacts ?? []).map((impact) => impact.service_id)),
    );
  }

  if (Object.keys(patch).length > 0) {
    const { error: updateError } = await supabase
      .from("incidents")
      .update(patch)
      .eq("organization_id", activeOrgId)
      .eq("id", incidentId);

    if (updateError) {
      if (isMissingIncidentsSchema(updateError)) {
        return NextResponse.json(
          { error: missingTableMessageWithMigration("incidents", "db/incidents-schema.sql") },
          { status: 500 },
        );
      }
      return NextResponse.json(
        { error: `Failed to update incident: ${updateError.message}` },
        { status: 500 },
      );
    }
  }

  const updateMessage = normalizeText(body.updateMessage);
  if (updateMessage || statusChanged) {
    const fallbackStatusMessage = statusChanged ? `Status changed to ${nextStatus}.` : null;
    const messageToWrite = updateMessage ?? fallbackStatusMessage;
    if (messageToWrite) {
      const { error: insertUpdateError } = await supabase
        .from("incident_updates")
        .insert({
          organization_id: activeOrgId,
          incident_id: incidentId,
          message: messageToWrite,
          status: statusChanged ? nextStatus : null,
          is_public: body.updatePublic !== false,
          created_by: userId,
        });

      if (insertUpdateError && !isMissingIncidentsSchema(insertUpdateError)) {
        return NextResponse.json(
          { error: `Incident updated but failed to append timeline: ${insertUpdateError.message}` },
          { status: 500 },
        );
      }
    }
  }

  if (impactedServiceIdsForRecalc.length > 0) {
    await recalculateServiceStatuses({
      supabase,
      organizationId: activeOrgId,
      serviceIds: impactedServiceIdsForRecalc,
    });
  }

  await writeAuditLog({
    supabase,
    organizationId: activeOrgId,
    actorUserId: userId,
    action: "incident.updated",
    entityType: "incident",
    entityId: incidentId,
    details: {
      patch,
      statusChanged,
      impactedServicesRecalculated: impactedServiceIdsForRecalc.length,
    },
  });

  return NextResponse.json({ success: true }, { status: 200 });
}

