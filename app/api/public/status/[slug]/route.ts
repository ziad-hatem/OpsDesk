import { NextResponse } from "next/server";
import type { PublicStatusResponse, IncidentServiceHealth } from "@/lib/incidents/types";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isMissingIncidentsSchema } from "@/lib/server/incidents";
import { missingTableMessageWithMigration } from "@/lib/tickets/errors";

type RouteContext = {
  params: Promise<{ slug: string }>;
};

type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
};

type ServiceRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  current_status: IncidentServiceHealth;
};

type IncidentRow = {
  id: string;
  title: string;
  summary: string | null;
  status: "investigating" | "identified" | "monitoring" | "resolved";
  severity: "critical" | "high" | "medium" | "low";
  started_at: string;
  resolved_at: string | null;
};

type ImpactRow = {
  incident_id: string;
  service_id: string;
  impact_level: IncidentServiceHealth;
};

type UpdateRow = {
  id: string;
  incident_id: string;
  message: string;
  status: "investigating" | "identified" | "monitoring" | "resolved" | null;
  created_at: string;
};

const HEALTH_RANK: Record<IncidentServiceHealth, number> = {
  operational: 0,
  maintenance: 1,
  degraded: 2,
  partial_outage: 3,
  major_outage: 4,
};

function rankHealth(status: IncidentServiceHealth): number {
  return HEALTH_RANK[status] ?? 0;
}

async function resolveSlug(context: RouteContext): Promise<string> {
  const params = await context.params;
  return params.slug?.trim().toLowerCase() ?? "";
}

export async function GET(_req: Request, context: RouteContext) {
  const organizationSlug = await resolveSlug(context);
  if (!organizationSlug) {
    return NextResponse.json({ error: "Organization slug is required" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();

  const { data: organization, error: organizationError } = await supabase
    .from("organizations")
    .select("id, name, slug")
    .eq("slug", organizationSlug)
    .maybeSingle<OrganizationRow>();

  if (organizationError) {
    return NextResponse.json(
      { error: `Failed to load organization: ${organizationError.message}` },
      { status: 500 },
    );
  }

  if (!organization) {
    return NextResponse.json({ error: "Status page not found" }, { status: 404 });
  }

  const [{ data: services, error: servicesError }, { data: incidents, error: incidentsError }] =
    await Promise.all([
      supabase
        .from("status_services")
        .select("id, name, slug, description, current_status")
        .eq("organization_id", organization.id)
        .eq("is_public", true)
        .order("display_order", { ascending: true })
        .order("name", { ascending: true })
        .returns<ServiceRow[]>(),
      supabase
        .from("incidents")
        .select("id, title, summary, status, severity, started_at, resolved_at")
        .eq("organization_id", organization.id)
        .eq("is_public", true)
        .order("started_at", { ascending: false })
        .limit(50)
        .returns<IncidentRow[]>(),
    ]);

  if (servicesError) {
    if (isMissingIncidentsSchema(servicesError)) {
      return NextResponse.json(
        { error: missingTableMessageWithMigration("status_services", "db/incidents-schema.sql") },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to load status services: ${servicesError.message}` },
      { status: 500 },
    );
  }

  if (incidentsError) {
    if (isMissingIncidentsSchema(incidentsError)) {
      return NextResponse.json(
        { error: missingTableMessageWithMigration("incidents", "db/incidents-schema.sql") },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to load incidents: ${incidentsError.message}` },
      { status: 500 },
    );
  }

  const incidentIds = (incidents ?? []).map((incident) => incident.id);
  let impacts: ImpactRow[] = [];
  let updates: UpdateRow[] = [];

  if (incidentIds.length > 0) {
    const [{ data: impactRows, error: impactsError }, { data: updateRows, error: updatesError }] =
      await Promise.all([
        supabase
          .from("incident_impacts")
          .select("incident_id, service_id, impact_level")
          .eq("organization_id", organization.id)
          .in("incident_id", incidentIds)
          .returns<ImpactRow[]>(),
        supabase
          .from("incident_updates")
          .select("id, incident_id, message, status, created_at")
          .eq("organization_id", organization.id)
          .eq("is_public", true)
          .in("incident_id", incidentIds)
          .order("created_at", { ascending: true })
          .returns<UpdateRow[]>(),
      ]);

    if (impactsError) {
      if (isMissingIncidentsSchema(impactsError)) {
        return NextResponse.json(
          { error: missingTableMessageWithMigration("incident_impacts", "db/incidents-schema.sql") },
          { status: 500 },
        );
      }
      return NextResponse.json(
        { error: `Failed to load incident impacts: ${impactsError.message}` },
        { status: 500 },
      );
    }

    if (updatesError) {
      if (isMissingIncidentsSchema(updatesError)) {
        return NextResponse.json(
          { error: missingTableMessageWithMigration("incident_updates", "db/incidents-schema.sql") },
          { status: 500 },
        );
      }
      return NextResponse.json(
        { error: `Failed to load incident updates: ${updatesError.message}` },
        { status: 500 },
      );
    }

    impacts = impactRows ?? [];
    updates = updateRows ?? [];
  }

  const publicServices = services ?? [];
  const serviceById = new Map(publicServices.map((service) => [service.id, service]));
  const impactsByIncidentId = new Map<string, PublicStatusResponse["incidents"][number]["impacts"]>();
  for (const row of impacts) {
    const service = serviceById.get(row.service_id);
    if (!service) {
      continue;
    }
    const existing = impactsByIncidentId.get(row.incident_id);
    const impact = {
      service_id: service.id,
      service_name: service.name,
      impact_level: row.impact_level,
    };
    if (existing) {
      existing.push(impact);
    } else {
      impactsByIncidentId.set(row.incident_id, [impact]);
    }
  }

  const updatesByIncidentId = new Map<string, PublicStatusResponse["incidents"][number]["updates"]>();
  for (const row of updates) {
    const existing = updatesByIncidentId.get(row.incident_id);
    const update = {
      id: row.id,
      message: row.message,
      status: row.status,
      created_at: row.created_at,
    };
    if (existing) {
      existing.push(update);
    } else {
      updatesByIncidentId.set(row.incident_id, [update]);
    }
  }

  const publicIncidents = (incidents ?? []).map((incident) => ({
    id: incident.id,
    title: incident.title,
    summary: incident.summary,
    status: incident.status,
    severity: incident.severity,
    started_at: incident.started_at,
    resolved_at: incident.resolved_at,
    impacts: impactsByIncidentId.get(incident.id) ?? [],
    updates: updatesByIncidentId.get(incident.id) ?? [],
  }));

  const overallStatus = publicServices.reduce<IncidentServiceHealth>(
    (current, service) =>
      rankHealth(service.current_status) > rankHealth(current)
        ? service.current_status
        : current,
    "operational",
  );

  const payload: PublicStatusResponse = {
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
    },
    generated_at: new Date().toISOString(),
    overall_status: overallStatus,
    services: publicServices,
    incidents: publicIncidents,
  };

  return NextResponse.json(payload, { status: 200 });
}

