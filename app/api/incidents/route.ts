import { NextResponse } from "next/server";
import { getTicketRequestContext } from "@/lib/server/ticket-context";
import { writeAuditLog } from "@/lib/server/audit-logs";
import type { IncidentsResponse, IncidentServiceHealth } from "@/lib/incidents/types";
import {
  isIncidentImpactLevel,
  normalizeIncidentSeverity,
  normalizeIncidentStatus,
} from "@/lib/incidents/validation";
import {
  canManageIncidents,
  isMissingIncidentsSchema,
  loadIncidentsSnapshot,
  normalizeText,
  recalculateServiceStatuses,
  resolveOrganizationRole,
} from "@/lib/server/incidents";
import { missingTableMessageWithMigration } from "@/lib/tickets/errors";

type CreateIncidentBody = {
  title?: string;
  summary?: string | null;
  severity?: string;
  status?: string;
  isPublic?: boolean;
  startedAt?: string;
  serviceImpacts?: Array<{
    serviceId?: string;
    impactLevel?: string;
  }>;
  initialMessage?: string;
  initialUpdatePublic?: boolean;
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
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type ServiceRow = {
  id: string;
};

type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
};

function parseIsoDate(value: unknown): string | null {
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

function normalizeDefaultImpactForSeverity(severity: string): IncidentServiceHealth {
  if (severity === "critical") {
    return "major_outage";
  }
  if (severity === "high") {
    return "partial_outage";
  }
  return "degraded";
}

export async function GET() {
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
    const role = await resolveOrganizationRole({
      supabase,
      organizationId: activeOrgId,
      userId,
    });
    if (!role) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const snapshot = await loadIncidentsSnapshot({
      supabase,
      organizationId: activeOrgId,
    });

    const { data: organization } = await supabase
      .from("organizations")
      .select("id, name, slug")
      .eq("id", activeOrgId)
      .maybeSingle<OrganizationRow>();

    const payload: IncidentsResponse = {
      activeOrgId,
      organizationSlug: organization?.slug ?? null,
      organizationName: organization?.name ?? null,
      currentUserId: userId,
      currentUserRole: role,
      services: snapshot.services,
      incidents: snapshot.incidents,
    };
    return NextResponse.json(payload, { status: 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to load incidents";
    if (isMissingIncidentsSchema({ message })) {
      return NextResponse.json(
        { error: missingTableMessageWithMigration("incidents", "db/incidents-schema.sql") },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
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

  const role = await resolveOrganizationRole({
    supabase,
    organizationId: activeOrgId,
    userId,
  });
  if (!canManageIncidents(role)) {
    return NextResponse.json(
      { error: "Only admin, manager, or support can create incidents" },
      { status: 403 },
    );
  }

  let body: CreateIncidentBody = {};
  try {
    body = (await req.json()) as CreateIncidentBody;
  } catch {
    body = {};
  }

  const title = normalizeText(body.title);
  if (!title) {
    return NextResponse.json({ error: "Incident title is required" }, { status: 400 });
  }

  const summary = normalizeText(body.summary);
  const severity = normalizeIncidentSeverity(body.severity, "medium");
  const status = normalizeIncidentStatus(body.status, "investigating");
  const isPublic = body.isPublic !== false;
  const startedAt = parseIsoDate(body.startedAt) ?? new Date().toISOString();
  const resolvedAt = status === "resolved" ? new Date().toISOString() : null;
  const initialMessage =
    normalizeText(body.initialMessage) ??
    `Incident declared (${severity} severity).`;
  const initialUpdatePublic = body.initialUpdatePublic !== false;

  const impactsInput = Array.isArray(body.serviceImpacts) ? body.serviceImpacts : [];
  const normalizedImpacts = impactsInput
    .map((entry) => ({
      serviceId: normalizeText(entry?.serviceId),
      impactLevel: entry?.impactLevel,
    }))
    .filter((entry): entry is { serviceId: string; impactLevel: string | undefined } => Boolean(entry.serviceId));

  const serviceIds = Array.from(new Set(normalizedImpacts.map((entry) => entry.serviceId)));
  if (serviceIds.length > 0) {
    const { data: services, error: servicesError } = await supabase
      .from("status_services")
      .select("id")
      .eq("organization_id", activeOrgId)
      .in("id", serviceIds)
      .returns<ServiceRow[]>();

    if (servicesError) {
      const message = `Failed to validate impacted services: ${servicesError.message}`;
      if (isMissingIncidentsSchema(servicesError)) {
        return NextResponse.json(
          { error: missingTableMessageWithMigration("status_services", "db/incidents-schema.sql") },
          { status: 500 },
        );
      }
      return NextResponse.json({ error: message }, { status: 500 });
    }

    const existingServiceIds = new Set((services ?? []).map((service) => service.id));
    const invalidService = serviceIds.find((serviceId) => !existingServiceIds.has(serviceId));
    if (invalidService) {
      return NextResponse.json(
        { error: "One or more selected services are invalid for this organization" },
        { status: 400 },
      );
    }
  }

  try {
    const { data: insertedIncident, error: insertIncidentError } = await supabase
      .from("incidents")
      .insert({
        organization_id: activeOrgId,
        title,
        summary,
        status,
        severity,
        is_public: isPublic,
        started_at: startedAt,
        resolved_at: resolvedAt,
        created_by: userId,
      })
      .select(
        "id, organization_id, title, summary, status, severity, is_public, started_at, resolved_at, created_by, created_at, updated_at",
      )
      .maybeSingle<IncidentRow>();

    if (insertIncidentError || !insertedIncident) {
      if (isMissingIncidentsSchema(insertIncidentError)) {
        return NextResponse.json(
          { error: missingTableMessageWithMigration("incidents", "db/incidents-schema.sql") },
          { status: 500 },
        );
      }
      return NextResponse.json(
        { error: `Failed to create incident: ${insertIncidentError?.message ?? "Unknown error"}` },
        { status: 500 },
      );
    }

    if (normalizedImpacts.length > 0) {
      const impactRows = normalizedImpacts.map((impact) => ({
        organization_id: activeOrgId,
        incident_id: insertedIncident.id,
        service_id: impact.serviceId,
        impact_level: isIncidentImpactLevel(impact.impactLevel)
          ? impact.impactLevel
          : normalizeDefaultImpactForSeverity(severity),
      }));

      const { error: insertImpactsError } = await supabase
        .from("incident_impacts")
        .insert(impactRows);

      if (insertImpactsError) {
        if (isMissingIncidentsSchema(insertImpactsError)) {
          return NextResponse.json(
            { error: missingTableMessageWithMigration("incident_impacts", "db/incidents-schema.sql") },
            { status: 500 },
          );
        }
        return NextResponse.json(
          { error: `Incident created but failed to save impacts: ${insertImpactsError.message}` },
          { status: 500 },
        );
      }
    }

    const { error: insertUpdateError } = await supabase
      .from("incident_updates")
      .insert({
        organization_id: activeOrgId,
        incident_id: insertedIncident.id,
        message: initialMessage,
        status,
        is_public: initialUpdatePublic,
        created_by: userId,
      });

    if (insertUpdateError && !isMissingIncidentsSchema(insertUpdateError)) {
      return NextResponse.json(
        {
          error: `Incident created but failed to save initial timeline update: ${insertUpdateError.message}`,
        },
        { status: 500 },
      );
    }

    if (serviceIds.length > 0) {
      await recalculateServiceStatuses({
        supabase,
        organizationId: activeOrgId,
        serviceIds,
      });
    }

    await writeAuditLog({
      supabase,
      organizationId: activeOrgId,
      actorUserId: userId,
      action: "incident.created",
      entityType: "incident",
      entityId: insertedIncident.id,
      details: {
        title,
        status,
        severity,
        impactedServices: serviceIds.length,
      },
    });

    return NextResponse.json({ incident: insertedIncident }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to create incident";
    if (isMissingIncidentsSchema({ message })) {
      return NextResponse.json(
        { error: missingTableMessageWithMigration("incidents", "db/incidents-schema.sql") },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
