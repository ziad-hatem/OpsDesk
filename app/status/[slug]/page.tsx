"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { AlertTriangle, Clock3, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/components/ui/card";
import { Badge } from "@/app/components/ui/badge";
import type { PublicStatusIncident, PublicStatusResponse, IncidentServiceHealth } from "@/lib/incidents/types";

function toTitleCase(value: string): string {
  return value
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "N/A";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

function healthBadgeClass(health: IncidentServiceHealth): string {
  if (health === "major_outage") {
    return "bg-red-100 text-red-800 hover:bg-red-100";
  }
  if (health === "partial_outage") {
    return "bg-orange-100 text-orange-800 hover:bg-orange-100";
  }
  if (health === "degraded") {
    return "bg-amber-100 text-amber-800 hover:bg-amber-100";
  }
  if (health === "maintenance") {
    return "bg-blue-100 text-blue-800 hover:bg-blue-100";
  }
  return "bg-emerald-100 text-emerald-800 hover:bg-emerald-100";
}

function severityBadgeClass(severity: PublicStatusIncident["severity"]): string {
  if (severity === "critical") {
    return "bg-red-100 text-red-800 hover:bg-red-100";
  }
  if (severity === "high") {
    return "bg-orange-100 text-orange-800 hover:bg-orange-100";
  }
  if (severity === "medium") {
    return "bg-amber-100 text-amber-800 hover:bg-amber-100";
  }
  return "bg-muted text-foreground hover:bg-muted";
}

function statusBadgeClass(status: PublicStatusIncident["status"]): string {
  if (status === "resolved") {
    return "bg-emerald-100 text-emerald-800 hover:bg-emerald-100";
  }
  if (status === "monitoring") {
    return "bg-blue-100 text-blue-800 hover:bg-blue-100";
  }
  if (status === "identified") {
    return "bg-orange-100 text-orange-800 hover:bg-orange-100";
  }
  return "bg-red-100 text-red-800 hover:bg-red-100";
}

export default function PublicStatusPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";

  const [data, setData] = useState<PublicStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) {
      setIsLoading(false);
      setError("Missing status page slug");
      return;
    }

    let isMounted = true;
    const loadStatus = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/public/status/${slug}`, {
          method: "GET",
          cache: "no-store",
        });
        const payload = (await response.json()) as PublicStatusResponse & { error?: string };
        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load status page");
        }
        if (!isMounted) {
          return;
        }
        setData(payload);
      } catch (err: unknown) {
        if (!isMounted) {
          return;
        }
        const message = err instanceof Error ? err.message : "Failed to load status page";
        setError(message);
        setData(null);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void loadStatus();
    return () => {
      isMounted = false;
    };
  }, [slug]);

  const activeIncidents = useMemo(
    () => (data?.incidents ?? []).filter((incident) => incident.status !== "resolved"),
    [data?.incidents],
  );
  const resolvedIncidents = useMemo(
    () => (data?.incidents ?? []).filter((incident) => incident.status === "resolved"),
    [data?.incidents],
  );

  return (
    <main className="min-h-screen bg-muted/50 px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <Card>
          <CardHeader className="gap-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="text-3xl tracking-tight text-foreground">
                  {data?.organization.name ?? "Status"}
                </CardTitle>
                <CardDescription className="mt-2 text-sm">
                  Service health and incident communication in real time.
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {data ? (
                  <Badge className={healthBadgeClass(data.overall_status)}>
                    Overall: {toTitleCase(data.overall_status)}
                  </Badge>
                ) : null}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0 text-sm text-muted-foreground">
            Last updated: {formatDateTime(data?.generated_at ?? null)}
          </CardContent>
        </Card>

        {isLoading ? (
          <Card>
            <CardContent className="flex items-center gap-2 py-10 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading status page...
            </CardContent>
          </Card>
        ) : null}

        {error ? (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="flex items-center gap-2 py-4 text-sm text-red-700">
              <AlertTriangle className="h-4 w-4" />
              {error}
            </CardContent>
          </Card>
        ) : null}

        {data ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Impacted Services</CardTitle>
                <CardDescription>Current health state for each public service.</CardDescription>
              </CardHeader>
              <CardContent>
                {data.services.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No public services configured.</p>
                ) : (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {data.services.map((service) => (
                      <div
                        key={service.id}
                        className="rounded-lg border border-border bg-background p-4"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-foreground">{service.name}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{service.slug}</p>
                          </div>
                          <Badge className={healthBadgeClass(service.current_status)}>
                            {toTitleCase(service.current_status)}
                          </Badge>
                        </div>
                        {service.description ? (
                          <p className="mt-3 text-sm text-muted-foreground">{service.description}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Active Incidents</CardTitle>
                <CardDescription>
                  {activeIncidents.length > 0
                    ? "Current incidents with ongoing investigation or mitigation."
                    : "No active incidents right now."}
                </CardDescription>
              </CardHeader>
              {activeIncidents.length > 0 ? (
                <CardContent className="space-y-4">
                  {activeIncidents.map((incident) => (
                    <div key={incident.id} className="rounded-lg border border-border bg-background p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold text-foreground">{incident.title}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Started {formatDateTime(incident.started_at)}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge className={statusBadgeClass(incident.status)}>
                            {toTitleCase(incident.status)}
                          </Badge>
                          <Badge className={severityBadgeClass(incident.severity)}>
                            {toTitleCase(incident.severity)}
                          </Badge>
                        </div>
                      </div>

                      {incident.summary ? (
                        <p className="mt-3 text-sm text-foreground">{incident.summary}</p>
                      ) : null}

                      {incident.impacts.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {incident.impacts.map((impact) => (
                            <Badge
                              key={`${incident.id}-${impact.service_id}`}
                              className={healthBadgeClass(impact.impact_level)}
                            >
                              {impact.service_name}: {toTitleCase(impact.impact_level)}
                            </Badge>
                          ))}
                        </div>
                      ) : null}

                      <div className="mt-4 space-y-2">
                        {incident.updates.length === 0 ? (
                          <p className="text-sm text-muted-foreground">No timeline updates yet.</p>
                        ) : (
                          incident.updates.map((update) => (
                            <div
                              key={update.id}
                              className="rounded-md border border-border bg-muted/50 p-3"
                            >
                              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                                <Clock3 className="h-3.5 w-3.5" />
                                <span>{formatDateTime(update.created_at)}</span>
                                {update.status ? <span>| {toTitleCase(update.status)}</span> : null}
                              </div>
                              <p className="text-sm text-foreground">{update.message}</p>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ))}
                </CardContent>
              ) : null}
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Resolved Incidents</CardTitle>
                <CardDescription>Most recent resolved incidents for transparency.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {resolvedIncidents.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No resolved incidents yet.</p>
                ) : (
                  resolvedIncidents.map((incident) => (
                    <div key={incident.id} className="rounded-md border border-border p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="font-medium text-foreground">{incident.title}</p>
                        <Badge className={statusBadgeClass(incident.status)}>
                          {toTitleCase(incident.status)}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Resolved {formatDateTime(incident.resolved_at)}
                      </p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>
    </main>
  );
}

