import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type {
  IncidentActor,
  IncidentImpact,
  IncidentItem,
  IncidentService,
  IncidentServiceHealth,
  IncidentUpdate,
} from "@/lib/incidents/types";
import { isIncidentImpactLevel } from "@/lib/incidents/validation";
import type { OrganizationRole } from "@/lib/topbar/types";

type SupabaseClient = ReturnType<typeof createSupabaseAdminClient>;

type MembershipRoleRow = {
  role: OrganizationRole;
  status?: "active" | "suspended" | null;
};

type MembershipRoleFallbackRow = Omit<MembershipRoleRow, "status">;

type IncidentServiceRow = IncidentService;

type IncidentRow = Omit<IncidentItem, "creator" | "impacts" | "updates">;

type IncidentImpactRow = Omit<IncidentImpact, "service">;

type IncidentUpdateRow = Omit<IncidentUpdate, "actor">;

type IncidentUserRow = IncidentActor;

const HEALTH_RANK: Record<IncidentServiceHealth, number> = {
  operational: 0,
  degraded: 1,
  partial_outage: 2,
  major_outage: 3,
  maintenance: 4,
};

export function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function isMissingIncidentsSchema(
  error: { message?: string } | null | undefined,
): boolean {
  const message = (error?.message ?? "").toLowerCase();
  if (!message) {
    return false;
  }
  return (
    (message.includes("incidents") ||
      message.includes("status_services") ||
      message.includes("incident_impacts") ||
      message.includes("incident_updates")) &&
    (message.includes("schema cache") || message.includes("does not exist"))
  );
}

export async function resolveOrganizationRole(params: {
  supabase: SupabaseClient;
  organizationId: string;
  userId: string;
}): Promise<OrganizationRole | null> {
  const { supabase, organizationId, userId } = params;

  const withStatus = await supabase
    .from("organization_memberships")
    .select("role, status")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle<MembershipRoleRow>();

  if (!withStatus.error) {
    const membership = withStatus.data;
    if (!membership || membership.status === "suspended") {
      return null;
    }
    return membership.role;
  }

  const isMissingStatusColumn = withStatus.error.message
    .toLowerCase()
    .includes("organization_memberships.status");
  if (!isMissingStatusColumn) {
    return null;
  }

  const fallback = await supabase
    .from("organization_memberships")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle<MembershipRoleFallbackRow>();

  return fallback.data?.role ?? null;
}

export function canManageIncidents(role: OrganizationRole | null): boolean {
  return role === "admin" || role === "manager" || role === "support";
}

export function toIncidentServiceSlug(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || "service"
  );
}

export async function generateUniqueServiceSlug(params: {
  supabase: SupabaseClient;
  organizationId: string;
  baseName: string;
}): Promise<string> {
  const { supabase, organizationId, baseName } = params;
  const baseSlug = toIncidentServiceSlug(baseName);

  const { data: existingRows, error } = await supabase
    .from("status_services")
    .select("slug")
    .eq("organization_id", organizationId)
    .ilike("slug", `${baseSlug}%`)
    .returns<Array<{ slug: string }>>();

  if (error) {
    throw new Error(`Failed to generate service slug: ${error.message}`);
  }

  const existing = new Set((existingRows ?? []).map((row) => row.slug));
  if (!existing.has(baseSlug)) {
    return baseSlug;
  }

  let suffix = 2;
  while (suffix <= 1000) {
    const candidate = `${baseSlug}-${suffix}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
    suffix += 1;
  }

  return `${baseSlug}-${Date.now()}`;
}

export async function loadIncidentsSnapshot(params: {
  supabase: SupabaseClient;
  organizationId: string;
}): Promise<{
  services: IncidentService[];
  incidents: IncidentItem[];
}> {
  const { supabase, organizationId } = params;

  const [{ data: serviceRows, error: servicesError }, { data: incidentRows, error: incidentsError }] =
    await Promise.all([
      supabase
        .from("status_services")
        .select(
          "id, organization_id, name, slug, description, current_status, is_public, display_order, created_by, created_at, updated_at",
        )
        .eq("organization_id", organizationId)
        .order("display_order", { ascending: true })
        .order("name", { ascending: true })
        .returns<IncidentServiceRow[]>(),
      supabase
        .from("incidents")
        .select(
          "id, organization_id, title, summary, status, severity, is_public, started_at, resolved_at, created_by, created_at, updated_at",
        )
        .eq("organization_id", organizationId)
        .order("started_at", { ascending: false })
        .limit(200)
        .returns<IncidentRow[]>(),
    ]);

  if (servicesError) {
    throw new Error(`Failed to load incident services: ${servicesError.message}`);
  }
  if (incidentsError) {
    throw new Error(`Failed to load incidents: ${incidentsError.message}`);
  }

  const services = serviceRows ?? [];
  const incidentsBase = incidentRows ?? [];
  if (incidentsBase.length === 0) {
    return { services, incidents: [] };
  }

  const incidentIds = incidentsBase.map((incident) => incident.id);
  const [{ data: impactRows, error: impactsError }, { data: updateRows, error: updatesError }] =
    await Promise.all([
      supabase
        .from("incident_impacts")
        .select("id, organization_id, incident_id, service_id, impact_level, created_at")
        .eq("organization_id", organizationId)
        .in("incident_id", incidentIds)
        .returns<IncidentImpactRow[]>(),
      supabase
        .from("incident_updates")
        .select("id, organization_id, incident_id, message, status, is_public, created_by, created_at")
        .eq("organization_id", organizationId)
        .in("incident_id", incidentIds)
        .order("created_at", { ascending: true })
        .returns<IncidentUpdateRow[]>(),
    ]);

  if (impactsError) {
    throw new Error(`Failed to load incident impacts: ${impactsError.message}`);
  }
  if (updatesError) {
    throw new Error(`Failed to load incident updates: ${updatesError.message}`);
  }

  const serviceById = new Map(services.map((service) => [service.id, service]));
  const userIds = Array.from(
    new Set(
      [
        ...incidentsBase.map((incident) => incident.created_by),
        ...(updateRows ?? []).map((update) => update.created_by),
      ].filter((value): value is string => typeof value === "string" && value.length > 0),
    ),
  );

  let usersById = new Map<string, IncidentActor>();
  if (userIds.length > 0) {
    const { data: userRows, error: usersError } = await supabase
      .from("users")
      .select("id, name, email, avatar_url")
      .in("id", userIds)
      .returns<IncidentUserRow[]>();

    if (usersError) {
      throw new Error(`Failed to load incident actors: ${usersError.message}`);
    }
    usersById = new Map((userRows ?? []).map((user) => [user.id, user]));
  }

  const impactsByIncidentId = new Map<string, IncidentImpact[]>();
  for (const row of impactRows ?? []) {
    const impact: IncidentImpact = {
      ...row,
      service: serviceById.get(row.service_id) ?? null,
    };
    const existing = impactsByIncidentId.get(row.incident_id);
    if (existing) {
      existing.push(impact);
    } else {
      impactsByIncidentId.set(row.incident_id, [impact]);
    }
  }

  const updatesByIncidentId = new Map<string, IncidentUpdate[]>();
  for (const row of updateRows ?? []) {
    const update: IncidentUpdate = {
      ...row,
      actor: row.created_by ? usersById.get(row.created_by) ?? null : null,
    };
    const existing = updatesByIncidentId.get(row.incident_id);
    if (existing) {
      existing.push(update);
    } else {
      updatesByIncidentId.set(row.incident_id, [update]);
    }
  }

  const incidents: IncidentItem[] = incidentsBase.map((row) => ({
    ...row,
    creator: row.created_by ? usersById.get(row.created_by) ?? null : null,
    impacts: impactsByIncidentId.get(row.id) ?? [],
    updates: updatesByIncidentId.get(row.id) ?? [],
  }));

  return { services, incidents };
}

export async function recalculateServiceStatuses(params: {
  supabase: SupabaseClient;
  organizationId: string;
  serviceIds: string[];
}): Promise<void> {
  const { supabase, organizationId } = params;
  const serviceIds = Array.from(new Set(params.serviceIds.filter(Boolean)));
  if (serviceIds.length === 0) {
    return;
  }

  const { data: impacts, error: impactsError } = await supabase
    .from("incident_impacts")
    .select("incident_id, service_id, impact_level")
    .eq("organization_id", organizationId)
    .in("service_id", serviceIds)
    .returns<Array<{ incident_id: string; service_id: string; impact_level: IncidentServiceHealth }>>();

  if (impactsError) {
    throw new Error(`Failed to recalculate service status: ${impactsError.message}`);
  }

  const incidentIds = Array.from(
    new Set((impacts ?? []).map((row) => row.incident_id).filter(Boolean)),
  );

  let activeIncidentIdSet = new Set<string>();
  if (incidentIds.length > 0) {
    const { data: activeIncidents, error: activeIncidentsError } = await supabase
      .from("incidents")
      .select("id")
      .eq("organization_id", organizationId)
      .in("id", incidentIds)
      .neq("status", "resolved")
      .returns<Array<{ id: string }>>();

    if (activeIncidentsError) {
      throw new Error(
        `Failed to load active incidents for service status calculation: ${activeIncidentsError.message}`,
      );
    }

    activeIncidentIdSet = new Set((activeIncidents ?? []).map((row) => row.id));
  }

  const highestByServiceId = new Map<string, IncidentServiceHealth>();
  for (const row of impacts ?? []) {
    if (!activeIncidentIdSet.has(row.incident_id)) {
      continue;
    }
    if (!isIncidentImpactLevel(row.impact_level)) {
      continue;
    }

    const current = highestByServiceId.get(row.service_id);
    if (!current || HEALTH_RANK[row.impact_level] > HEALTH_RANK[current]) {
      highestByServiceId.set(row.service_id, row.impact_level);
    }
  }

  for (const serviceId of serviceIds) {
    const nextStatus = highestByServiceId.get(serviceId) ?? "operational";
    const { error: updateError } = await supabase
      .from("status_services")
      .update({ current_status: nextStatus })
      .eq("organization_id", organizationId)
      .eq("id", serviceId);

    if (updateError) {
      throw new Error(`Failed to update service status: ${updateError.message}`);
    }
  }
}
