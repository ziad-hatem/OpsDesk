import type {
  IncidentServiceHealth,
  IncidentSeverity,
  IncidentStatus,
} from "@/lib/incidents/types";

const SERVICE_HEALTHS: IncidentServiceHealth[] = [
  "operational",
  "degraded",
  "partial_outage",
  "major_outage",
  "maintenance",
];

const INCIDENT_STATUSES: IncidentStatus[] = [
  "investigating",
  "identified",
  "monitoring",
  "resolved",
];

const INCIDENT_SEVERITIES: IncidentSeverity[] = [
  "critical",
  "high",
  "medium",
  "low",
];

const INCIDENT_IMPACT_LEVELS: IncidentServiceHealth[] = [
  "degraded",
  "partial_outage",
  "major_outage",
  "maintenance",
];

export function isIncidentServiceHealth(value: unknown): value is IncidentServiceHealth {
  return typeof value === "string" && SERVICE_HEALTHS.includes(value as IncidentServiceHealth);
}

export function isIncidentStatus(value: unknown): value is IncidentStatus {
  return typeof value === "string" && INCIDENT_STATUSES.includes(value as IncidentStatus);
}

export function isIncidentSeverity(value: unknown): value is IncidentSeverity {
  return typeof value === "string" && INCIDENT_SEVERITIES.includes(value as IncidentSeverity);
}

export function isIncidentImpactLevel(value: unknown): value is IncidentServiceHealth {
  return (
    typeof value === "string" &&
    INCIDENT_IMPACT_LEVELS.includes(value as IncidentServiceHealth)
  );
}

export function normalizeIncidentStatus(
  value: unknown,
  fallback: IncidentStatus,
): IncidentStatus {
  return isIncidentStatus(value) ? value : fallback;
}

export function normalizeIncidentSeverity(
  value: unknown,
  fallback: IncidentSeverity,
): IncidentSeverity {
  return isIncidentSeverity(value) ? value : fallback;
}

