"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Globe,
  Loader2,
  Plus,
  RefreshCcw,
  Save,
  Search,
  Send,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";
import { Badge } from "@/app/components/ui/badge";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Switch } from "@/app/components/ui/switch";
import { EmptyState } from "@/app/components/ui/empty-state";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/app/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/app/components/ui/alert-dialog";
import { useAppSelector } from "@/lib/store/hooks";
import { selectTopbarActiveOrganizationId } from "@/lib/store/slices/topbar-slice";
import type {
  IncidentItem,
  IncidentsResponse,
  IncidentService,
  IncidentServiceHealth,
  IncidentSeverity,
  IncidentStatus,
} from "@/lib/incidents/types";

const SERVICE_HEALTH_OPTIONS: IncidentServiceHealth[] = [
  "operational",
  "degraded",
  "partial_outage",
  "major_outage",
  "maintenance",
];

const IMPACT_LEVEL_OPTIONS: IncidentServiceHealth[] = [
  "degraded",
  "partial_outage",
  "major_outage",
  "maintenance",
];

const INCIDENT_STATUS_OPTIONS: IncidentStatus[] = [
  "investigating",
  "identified",
  "monitoring",
  "resolved",
];

const INCIDENT_SEVERITY_OPTIONS: IncidentSeverity[] = [
  "critical",
  "high",
  "medium",
  "low",
];

type ServiceDraft = {
  name: string;
  description: string;
  currentStatus: IncidentServiceHealth;
  isPublic: boolean;
  displayOrder: number;
};

type IncidentTimelineDraft = {
  message: string;
  status: IncidentStatus;
  isPublic: boolean;
};

type CreateIncidentFormState = {
  title: string;
  summary: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  isPublic: boolean;
  initialMessage: string;
};

type CreateServiceFormState = {
  name: string;
  description: string;
  currentStatus: IncidentServiceHealth;
  isPublic: boolean;
  displayOrder: number;
};

const INITIAL_INCIDENT_FORM: CreateIncidentFormState = {
  title: "",
  summary: "",
  status: "investigating",
  severity: "medium",
  isPublic: true,
  initialMessage: "",
};

const INITIAL_SERVICE_FORM: CreateServiceFormState = {
  name: "",
  description: "",
  currentStatus: "operational",
  isPublic: true,
  displayOrder: 0,
};

function toLabel(value: string): string {
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

function defaultImpactForSeverity(severity: IncidentSeverity): IncidentServiceHealth {
  if (severity === "critical") {
    return "major_outage";
  }
  if (severity === "high") {
    return "partial_outage";
  }
  return "degraded";
}

function severityBadgeClass(severity: IncidentSeverity): string {
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

function statusBadgeClass(status: IncidentStatus): string {
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

function sortIncidentUpdatesByNewest(incident: IncidentItem): IncidentItem["updates"] {
  return [...incident.updates].sort((a, b) => {
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

async function readApiError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload.error) {
      return payload.error;
    }
  } catch {
    // ignored
  }
  return response.statusText || `Request failed (${response.status})`;
}

export default function IncidentsPage() {
  const activeOrgId = useAppSelector(selectTopbarActiveOrganizationId);

  const [data, setData] = useState<IncidentsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createIncidentForm, setCreateIncidentForm] =
    useState<CreateIncidentFormState>(INITIAL_INCIDENT_FORM);
  const [selectedImpacts, setSelectedImpacts] = useState<Record<string, IncidentServiceHealth>>({});
  const [isCreatingIncident, setIsCreatingIncident] = useState(false);

  const [createServiceForm, setCreateServiceForm] =
    useState<CreateServiceFormState>(INITIAL_SERVICE_FORM);
  const [isCreatingService, setIsCreatingService] = useState(false);
  const [showCreateServiceForm, setShowCreateServiceForm] = useState(false);

  const [serviceDrafts, setServiceDrafts] = useState<Record<string, ServiceDraft>>({});
  const [savingServiceId, setSavingServiceId] = useState<string | null>(null);
  const [deletingServiceId, setDeletingServiceId] = useState<string | null>(null);
  const [servicePendingDelete, setServicePendingDelete] = useState<IncidentService | null>(null);

  const [timelineDrafts, setTimelineDrafts] = useState<Record<string, IncidentTimelineDraft>>({});
  const [postingUpdateId, setPostingUpdateId] = useState<string | null>(null);
  const [expandedTimelineIncidentIds, setExpandedTimelineIncidentIds] = useState<
    Record<string, boolean>
  >({});

  const [showCreateIncidentForm, setShowCreateIncidentForm] = useState(false);
  const [showResolvedIncidents, setShowResolvedIncidents] = useState(false);
  const [incidentQuery, setIncidentQuery] = useState("");
  const [incidentStatusFilter, setIncidentStatusFilter] = useState<IncidentStatus | "all">("all");
  const [incidentSeverityFilter, setIncidentSeverityFilter] = useState<IncidentSeverity | "all">(
    "all",
  );
  const [incidentVisibilityFilter, setIncidentVisibilityFilter] = useState<
    "all" | "public" | "internal"
  >("all");

  const canManage = useMemo(() => {
    const role = data?.currentUserRole;
    return role === "admin" || role === "manager" || role === "support";
  }, [data?.currentUserRole]);

  const loadIncidents = useCallback(async () => {
    if (!activeOrgId) {
      setData(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/incidents", {
        method: "GET",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const payload = (await response.json()) as IncidentsResponse;
      setData(payload);

      setServiceDrafts(() => {
        const next: Record<string, ServiceDraft> = {};
        for (const service of payload.services) {
          next[service.id] = {
            name: service.name,
            description: service.description ?? "",
            currentStatus: service.current_status,
            isPublic: service.is_public,
            displayOrder: service.display_order,
          };
        }
        return next;
      });

      setTimelineDrafts((previous) => {
        const next: Record<string, IncidentTimelineDraft> = {};
        for (const incident of payload.incidents) {
          next[incident.id] = previous[incident.id] ?? {
            message: "",
            status: incident.status,
            isPublic: incident.is_public,
          };
        }
        return next;
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to load incidents";
      setError(message);
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [activeOrgId]);

  useEffect(() => {
    void loadIncidents();
  }, [loadIncidents]);

  const handleImpactToggle = (serviceId: string, isSelected: boolean) => {
    setSelectedImpacts((prev) => {
      if (!isSelected) {
        const next = { ...prev };
        delete next[serviceId];
        return next;
      }
      if (prev[serviceId]) {
        return prev;
      }
      return {
        ...prev,
        [serviceId]: defaultImpactForSeverity(createIncidentForm.severity),
      };
    });
  };

  const handleCreateService = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canManage || isCreatingService) {
      return;
    }

    const normalizedName = createServiceForm.name.trim();
    if (!normalizedName) {
      toast.error("Service name is required");
      return;
    }

    setIsCreatingService(true);
    try {
      const response = await fetch("/api/incidents/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: normalizedName,
          description: createServiceForm.description.trim() || null,
          currentStatus: createServiceForm.currentStatus,
          isPublic: createServiceForm.isPublic,
          displayOrder: createServiceForm.displayOrder,
        }),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      toast.success("Service created");
      setCreateServiceForm(INITIAL_SERVICE_FORM);
      setShowCreateServiceForm(false);
      await loadIncidents();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to create service";
      toast.error(message);
    } finally {
      setIsCreatingService(false);
    }
  };

  const handleSaveService = async (service: IncidentService) => {
    if (!canManage || savingServiceId) {
      return;
    }
    const draft = serviceDrafts[service.id];
    if (!draft) {
      return;
    }

    const patch: Record<string, unknown> = {};
    const normalizedName = draft.name.trim();
    const normalizedDescription = draft.description.trim();

    if (normalizedName !== service.name) {
      patch.name = normalizedName;
    }
    if ((normalizedDescription || null) !== (service.description ?? null)) {
      patch.description = normalizedDescription || null;
    }
    if (draft.currentStatus !== service.current_status) {
      patch.currentStatus = draft.currentStatus;
    }
    if (draft.isPublic !== service.is_public) {
      patch.isPublic = draft.isPublic;
    }
    if (draft.displayOrder !== service.display_order) {
      patch.displayOrder = draft.displayOrder;
    }

    if (!Object.keys(patch).length) {
      toast.message("No service changes to save");
      return;
    }

    setSavingServiceId(service.id);
    try {
      const response = await fetch(`/api/incidents/services/${service.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      toast.success("Service updated");
      await loadIncidents();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to update service";
      toast.error(message);
    } finally {
      setSavingServiceId(null);
    }
  };

  const handleDeleteService = async () => {
    if (!canManage || !servicePendingDelete || deletingServiceId) {
      return;
    }
    const service = servicePendingDelete;
    setDeletingServiceId(service.id);
    try {
      const response = await fetch(`/api/incidents/services/${service.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      toast.success(`Service "${service.name}" deleted`);
      setServicePendingDelete(null);
      await loadIncidents();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to delete service";
      toast.error(message);
    } finally {
      setDeletingServiceId(null);
    }
  };

  const handleCreateIncident = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canManage || isCreatingIncident) {
      return;
    }

    const title = createIncidentForm.title.trim();
    if (!title) {
      toast.error("Incident title is required");
      return;
    }

    const serviceImpacts = Object.entries(selectedImpacts).map(([serviceId, impactLevel]) => ({
      serviceId,
      impactLevel,
    }));

    setIsCreatingIncident(true);
    try {
      const response = await fetch("/api/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          summary: createIncidentForm.summary.trim() || null,
          status: createIncidentForm.status,
          severity: createIncidentForm.severity,
          isPublic: createIncidentForm.isPublic,
          serviceImpacts,
          initialMessage: createIncidentForm.initialMessage.trim() || undefined,
          initialUpdatePublic: createIncidentForm.isPublic,
        }),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      toast.success("Incident created");
      setCreateIncidentForm(INITIAL_INCIDENT_FORM);
      setSelectedImpacts({});
      setShowCreateIncidentForm(false);
      await loadIncidents();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to create incident";
      toast.error(message);
    } finally {
      setIsCreatingIncident(false);
    }
  };

  const handlePostTimelineUpdate = async (incident: IncidentItem) => {
    if (!canManage || postingUpdateId) {
      return;
    }

    const draft = timelineDrafts[incident.id] ?? {
      message: "",
      status: incident.status,
      isPublic: incident.is_public,
    };

    if (!draft.message.trim() && draft.status === incident.status) {
      toast.error("Write a message or change status before posting");
      return;
    }

    setPostingUpdateId(incident.id);
    try {
      const response = await fetch(`/api/incidents/${incident.id}/updates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: draft.message.trim() || undefined,
          status: draft.status,
          isPublic: draft.isPublic,
        }),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      toast.success("Incident timeline updated");
      setTimelineDrafts((prev) => ({
        ...prev,
        [incident.id]: {
          ...draft,
          message: "",
        },
      }));
      await loadIncidents();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to post incident update";
      toast.error(message);
    } finally {
      setPostingUpdateId(null);
    }
  };

  const activeIncidents = useMemo(
    () => (data?.incidents ?? []).filter((incident) => incident.status !== "resolved"),
    [data?.incidents],
  );

  const resolvedIncidents = useMemo(
    () => (data?.incidents ?? []).filter((incident) => incident.status === "resolved"),
    [data?.incidents],
  );

  const normalizedIncidentQuery = incidentQuery.trim().toLowerCase();
  const hasIncidentFilters = useMemo(
    () =>
      Boolean(
        normalizedIncidentQuery ||
          incidentStatusFilter !== "all" ||
          incidentSeverityFilter !== "all" ||
          incidentVisibilityFilter !== "all",
      ),
    [
      incidentSeverityFilter,
      incidentStatusFilter,
      incidentVisibilityFilter,
      normalizedIncidentQuery,
    ],
  );

  const matchesIncidentFilters = useCallback(
    (incident: IncidentItem) => {
      if (incidentStatusFilter !== "all" && incident.status !== incidentStatusFilter) {
        return false;
      }
      if (incidentSeverityFilter !== "all" && incident.severity !== incidentSeverityFilter) {
        return false;
      }
      if (incidentVisibilityFilter === "public" && !incident.is_public) {
        return false;
      }
      if (incidentVisibilityFilter === "internal" && incident.is_public) {
        return false;
      }

      if (!normalizedIncidentQuery) {
        return true;
      }

      const searchable = [
        incident.title,
        incident.summary ?? "",
        ...incident.impacts.map((impact) => impact.service?.name ?? ""),
        ...incident.updates.slice(0, 5).map((update) => update.message),
      ]
        .join(" ")
        .toLowerCase();

      return searchable.includes(normalizedIncidentQuery);
    },
    [
      incidentSeverityFilter,
      incidentStatusFilter,
      incidentVisibilityFilter,
      normalizedIncidentQuery,
    ],
  );

  const filteredActiveIncidents = useMemo(
    () => activeIncidents.filter(matchesIncidentFilters),
    [activeIncidents, matchesIncidentFilters],
  );

  const filteredResolvedIncidents = useMemo(
    () => resolvedIncidents.filter(matchesIncidentFilters),
    [matchesIncidentFilters, resolvedIncidents],
  );

  const degradedServicesCount = useMemo(
    () =>
      (data?.services ?? []).filter((service) => service.current_status !== "operational").length,
    [data?.services],
  );

  const publicActiveIncidentsCount = useMemo(
    () => activeIncidents.filter((incident) => incident.is_public).length,
    [activeIncidents],
  );

  const criticalActiveIncidentsCount = useMemo(
    () => activeIncidents.filter((incident) => incident.severity === "critical").length,
    [activeIncidents],
  );

  const latestIncidentActivity = useMemo(() => {
    let latestTimestamp = 0;
    let latestLabel = "No incident activity yet";

    for (const incident of data?.incidents ?? []) {
      const startedAt = new Date(incident.started_at).getTime();
      if (startedAt > latestTimestamp) {
        latestTimestamp = startedAt;
        latestLabel = `Started ${formatDateTime(incident.started_at)}`;
      }

      for (const update of incident.updates) {
        const updatedAt = new Date(update.created_at).getTime();
        if (updatedAt > latestTimestamp) {
          latestTimestamp = updatedAt;
          latestLabel = `Updated ${formatDateTime(update.created_at)}`;
        }
      }
    }

    return latestLabel;
  }, [data?.incidents]);

  if (!activeOrgId) {
    return (
      <div className="space-y-4 p-6">
        <Card>
          <CardContent className="p-6 text-muted-foreground">
            Select or create an organization to manage incidents.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold text-foreground">Incident Management</h1>
          <p className="text-muted-foreground">
            Create incidents, manage impacted services, and publish timeline updates.
          </p>
          {data?.organizationSlug ? (
            <p className="text-sm text-muted-foreground">
              Public status page:{" "}
              <Link
                href={`/status/${data.organizationSlug}`}
                className="font-medium text-foreground underline decoration-border underline-offset-2"
                target="_blank"
                rel="noreferrer"
              >
                /status/{data.organizationSlug}
              </Link>
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {data?.organizationSlug ? (
            <Button asChild variant="outline" className="gap-2">
              <Link href={`/status/${data.organizationSlug}`} target="_blank" rel="noreferrer">
                <Globe className="h-4 w-4" />
                Open Public Status
              </Link>
            </Button>
          ) : null}
          <Button variant="outline" className="gap-2" onClick={() => void loadIncidents()}>
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {data ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardContent className="space-y-1 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Active incidents</p>
              <p className="text-2xl font-semibold text-foreground">{activeIncidents.length}</p>
              <p className="text-xs text-muted-foreground">
                {publicActiveIncidentsCount} public visibility
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-1 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Critical incidents
              </p>
              <p className="text-2xl font-semibold text-foreground">{criticalActiveIncidentsCount}</p>
              <p className="text-xs text-muted-foreground">Requires immediate triage</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-1 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Non-operational services
              </p>
              <p className="text-2xl font-semibold text-foreground">{degradedServicesCount}</p>
              <p className="text-xs text-muted-foreground">Across all tracked services</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-1 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Latest activity</p>
              <p className="text-sm font-medium text-foreground">{latestIncidentActivity}</p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {!canManage && data ? (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="py-4 text-sm text-amber-800">
            You have view-only access. Contact an admin or manager to edit incidents and services.
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

      {isLoading ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading incidents...
          </CardContent>
        </Card>
      ) : null}

      {data ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Status Services</CardTitle>
              <CardDescription>
                Define what appears on the public status page and current service health.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {canManage ? (
                <div className="rounded-lg border border-border p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-medium text-foreground">Add a status service</p>
                      <p className="text-xs text-muted-foreground">
                        Keep this collapsed when you are only monitoring active incidents.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="gap-2"
                      onClick={() => setShowCreateServiceForm((prev) => !prev)}
                    >
                      {showCreateServiceForm ? (
                        <>
                          <ChevronUp className="h-4 w-4" />
                          Hide form
                        </>
                      ) : (
                        <>
                          <Plus className="h-4 w-4" />
                          Add service
                        </>
                      )}
                    </Button>
                  </div>

                  {showCreateServiceForm ? (
                    <form
                      className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6"
                      onSubmit={handleCreateService}
                    >
                      <div className="space-y-2 xl:col-span-2">
                        <Label htmlFor="service-name">Service Name</Label>
                        <Input
                          id="service-name"
                          value={createServiceForm.name}
                          onChange={(event) =>
                            setCreateServiceForm((prev) => ({ ...prev, name: event.target.value }))
                          }
                          placeholder="API Gateway"
                          disabled={isCreatingService}
                        />
                      </div>
                      <div className="space-y-2 xl:col-span-2">
                        <Label htmlFor="service-description">Description</Label>
                        <Input
                          id="service-description"
                          value={createServiceForm.description}
                          onChange={(event) =>
                            setCreateServiceForm((prev) => ({
                              ...prev,
                              description: event.target.value,
                            }))
                          }
                          placeholder="Public API and auth edge"
                          disabled={isCreatingService}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Status</Label>
                        <Select
                          value={createServiceForm.currentStatus}
                          onValueChange={(value) =>
                            setCreateServiceForm((prev) => ({
                              ...prev,
                              currentStatus: value as IncidentServiceHealth,
                            }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {SERVICE_HEALTH_OPTIONS.map((status) => (
                              <SelectItem key={status} value={status}>
                                {toLabel(status)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="service-order">Display Order</Label>
                        <Input
                          id="service-order"
                          type="number"
                          value={createServiceForm.displayOrder}
                          onChange={(event) =>
                            setCreateServiceForm((prev) => ({
                              ...prev,
                              displayOrder: Number(event.target.value || "0"),
                            }))
                          }
                          disabled={isCreatingService}
                        />
                      </div>
                      <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 md:col-span-2 xl:col-span-3">
                        <div>
                          <p className="text-sm font-medium text-foreground">Show on public page</p>
                          <p className="text-xs text-muted-foreground">Hide internal-only services</p>
                        </div>
                        <Switch
                          checked={createServiceForm.isPublic}
                          onCheckedChange={(checked) =>
                            setCreateServiceForm((prev) => ({ ...prev, isPublic: checked }))
                          }
                          disabled={isCreatingService}
                        />
                      </div>
                      <div className="md:col-span-2 xl:col-span-3">
                        <Button type="submit" className="w-full gap-2" disabled={isCreatingService}>
                          {isCreatingService ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Plus className="h-4 w-4" />
                          )}
                          Add Service
                        </Button>
                      </div>
                    </form>
                  ) : null}
                </div>
              ) : null}

              {data.services.length === 0 ? (
                <p className="text-sm text-muted-foreground">No services added yet.</p>
              ) : (
                <div className="space-y-3">
                  {data.services.map((service) => {
                    const draft = serviceDrafts[service.id];
                    if (!draft) {
                      return null;
                    }
                    return (
                      <div
                        key={service.id}
                        className="rounded-lg border border-border bg-background p-4"
                      >
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
                          <div className="space-y-2 xl:col-span-2">
                            <Label>Name</Label>
                            <Input
                              value={draft.name}
                              onChange={(event) =>
                                setServiceDrafts((prev) => ({
                                  ...prev,
                                  [service.id]: { ...draft, name: event.target.value },
                                }))
                              }
                              disabled={!canManage || savingServiceId === service.id}
                            />
                          </div>
                          <div className="space-y-2 xl:col-span-2">
                            <Label>Description</Label>
                            <Input
                              value={draft.description}
                              onChange={(event) =>
                                setServiceDrafts((prev) => ({
                                  ...prev,
                                  [service.id]: { ...draft, description: event.target.value },
                                }))
                              }
                              disabled={!canManage || savingServiceId === service.id}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Health</Label>
                            <Select
                              value={draft.currentStatus}
                              onValueChange={(value) =>
                                setServiceDrafts((prev) => ({
                                  ...prev,
                                  [service.id]: {
                                    ...draft,
                                    currentStatus: value as IncidentServiceHealth,
                                  },
                                }))
                              }
                              disabled={!canManage || savingServiceId === service.id}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {SERVICE_HEALTH_OPTIONS.map((status) => (
                                  <SelectItem key={status} value={status}>
                                    {toLabel(status)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label>Display Order</Label>
                            <Input
                              type="number"
                              value={draft.displayOrder}
                              onChange={(event) =>
                                setServiceDrafts((prev) => ({
                                  ...prev,
                                  [service.id]: {
                                    ...draft,
                                    displayOrder: Number(event.target.value || "0"),
                                  },
                                }))
                              }
                              disabled={!canManage || savingServiceId === service.id}
                            />
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge className={healthBadgeClass(draft.currentStatus)}>
                              {toLabel(draft.currentStatus)}
                            </Badge>
                            <Badge variant="outline">
                              {draft.isPublic ? "Public" : "Internal"}
                            </Badge>
                            <div className="flex items-center gap-2 rounded-md border border-border px-2 py-1">
                              <Switch
                                checked={draft.isPublic}
                                onCheckedChange={(checked) =>
                                  setServiceDrafts((prev) => ({
                                    ...prev,
                                    [service.id]: { ...draft, isPublic: checked },
                                  }))
                                }
                                disabled={!canManage || savingServiceId === service.id}
                              />
                              <span className="text-xs text-muted-foreground">Public status</span>
                            </div>
                          </div>
                          {canManage ? (
                            <div className="flex items-center gap-2">
                              <Button
                                variant="outline"
                                className="gap-2"
                                onClick={() => void handleSaveService(service)}
                                disabled={savingServiceId === service.id}
                              >
                                {savingServiceId === service.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Save className="h-4 w-4" />
                                )}
                                Save
                              </Button>
                              <Button
                                variant="destructive"
                                className="gap-2"
                                onClick={() => setServicePendingDelete(service)}
                              >
                                <Trash2 className="h-4 w-4" />
                                Delete
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {canManage ? (
            <Card>
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>Create Incident</CardTitle>
                  <CardDescription>
                    Keep this minimized during monitoring, then expand to declare quickly.
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2"
                  onClick={() => setShowCreateIncidentForm((prev) => !prev)}
                >
                  {showCreateIncidentForm ? (
                    <>
                      <ChevronUp className="h-4 w-4" />
                      Hide form
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4" />
                      Declare incident
                    </>
                  )}
                </Button>
              </CardHeader>
              <CardContent>
                {showCreateIncidentForm ? (
                  <form className="space-y-4" onSubmit={handleCreateIncident}>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div className="space-y-2 md:col-span-2">
                        <Label htmlFor="incident-title">Title</Label>
                        <Input
                          id="incident-title"
                          value={createIncidentForm.title}
                          onChange={(event) =>
                            setCreateIncidentForm((prev) => ({ ...prev, title: event.target.value }))
                          }
                          placeholder="API latency spike in EU region"
                          disabled={isCreatingIncident}
                        />
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <Label htmlFor="incident-summary">Summary</Label>
                        <Textarea
                          id="incident-summary"
                          value={createIncidentForm.summary}
                          onChange={(event) =>
                            setCreateIncidentForm((prev) => ({
                              ...prev,
                              summary: event.target.value,
                            }))
                          }
                          rows={2}
                          placeholder="Describe what users are seeing."
                          disabled={isCreatingIncident}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Status</Label>
                        <Select
                          value={createIncidentForm.status}
                          onValueChange={(value) =>
                            setCreateIncidentForm((prev) => ({
                              ...prev,
                              status: value as IncidentStatus,
                            }))
                          }
                          disabled={isCreatingIncident}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {INCIDENT_STATUS_OPTIONS.map((status) => (
                              <SelectItem key={status} value={status}>
                                {toLabel(status)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Severity</Label>
                        <Select
                          value={createIncidentForm.severity}
                          onValueChange={(value) => {
                            const nextSeverity = value as IncidentSeverity;
                            setCreateIncidentForm((prev) => ({
                              ...prev,
                              severity: nextSeverity,
                            }));
                            setSelectedImpacts((prev) => {
                              const next: Record<string, IncidentServiceHealth> = {};
                              for (const [serviceId, impact] of Object.entries(prev)) {
                                next[serviceId] = impact || defaultImpactForSeverity(nextSeverity);
                              }
                              return next;
                            });
                          }}
                          disabled={isCreatingIncident}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {INCIDENT_SEVERITY_OPTIONS.map((severity) => (
                              <SelectItem key={severity} value={severity}>
                                {toLabel(severity)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <Label htmlFor="initial-message">Initial Timeline Update</Label>
                        <Textarea
                          id="initial-message"
                          rows={2}
                          value={createIncidentForm.initialMessage}
                          onChange={(event) =>
                            setCreateIncidentForm((prev) => ({
                              ...prev,
                              initialMessage: event.target.value,
                            }))
                          }
                          placeholder="Investigating elevated error rate for checkout API."
                          disabled={isCreatingIncident}
                        />
                      </div>
                      <div className="rounded-md border border-border px-3 py-2 md:col-span-2">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-foreground">Public incident</p>
                            <p className="text-xs text-muted-foreground">
                              Publish this incident and updates to the public status page.
                            </p>
                          </div>
                          <Switch
                            checked={createIncidentForm.isPublic}
                            onCheckedChange={(checked) =>
                              setCreateIncidentForm((prev) => ({ ...prev, isPublic: checked }))
                            }
                            disabled={isCreatingIncident}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <Label>Impacted Services</Label>
                      {data.services.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          Add at least one service before declaring incident impacts.
                        </p>
                      ) : (
                        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                          {data.services.map((service) => {
                            const selected = Boolean(selectedImpacts[service.id]);
                            return (
                              <div key={service.id} className="rounded-md border border-border p-3">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <Checkbox
                                      id={`impact-${service.id}`}
                                      checked={selected}
                                      onCheckedChange={(checked) =>
                                        handleImpactToggle(service.id, Boolean(checked))
                                      }
                                      disabled={isCreatingIncident}
                                    />
                                    <Label
                                      htmlFor={`impact-${service.id}`}
                                      className="cursor-pointer font-medium"
                                    >
                                      {service.name}
                                    </Label>
                                  </div>
                                  <Badge className={healthBadgeClass(service.current_status)}>
                                    {toLabel(service.current_status)}
                                  </Badge>
                                </div>
                                {selected ? (
                                  <div className="mt-2">
                                    <Select
                                      value={selectedImpacts[service.id]}
                                      onValueChange={(value) =>
                                        setSelectedImpacts((prev) => ({
                                          ...prev,
                                          [service.id]: value as IncidentServiceHealth,
                                        }))
                                      }
                                      disabled={isCreatingIncident}
                                    >
                                      <SelectTrigger>
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {IMPACT_LEVEL_OPTIONS.map((impactLevel) => (
                                          <SelectItem key={impactLevel} value={impactLevel}>
                                            {toLabel(impactLevel)}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <Button type="submit" className="gap-2" disabled={isCreatingIncident}>
                      {isCreatingIncident ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )}
                      Declare Incident
                    </Button>
                  </form>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Open the form when you need to declare a new incident.
                  </p>
                )}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Find Incidents Faster</CardTitle>
              <CardDescription>
                Filter by status, severity, visibility, or search by title, impact, and updates.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
              <div className="space-y-2 xl:col-span-2">
                <Label htmlFor="incident-search">Search</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="incident-search"
                    value={incidentQuery}
                    onChange={(event) => setIncidentQuery(event.target.value)}
                    placeholder="Search title, summary, impacted service, or update text"
                    className="pl-9"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={incidentStatusFilter}
                  onValueChange={(value) => setIncidentStatusFilter(value as IncidentStatus | "all")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    {INCIDENT_STATUS_OPTIONS.map((status) => (
                      <SelectItem key={status} value={status}>
                        {toLabel(status)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Severity</Label>
                <Select
                  value={incidentSeverityFilter}
                  onValueChange={(value) =>
                    setIncidentSeverityFilter(value as IncidentSeverity | "all")
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All severities</SelectItem>
                    {INCIDENT_SEVERITY_OPTIONS.map((severity) => (
                      <SelectItem key={severity} value={severity}>
                        {toLabel(severity)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Visibility</Label>
                <Select
                  value={incidentVisibilityFilter}
                  onValueChange={(value) =>
                    setIncidentVisibilityFilter(value as "all" | "public" | "internal")
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All visibility</SelectItem>
                    <SelectItem value="public">Public</SelectItem>
                    <SelectItem value="internal">Internal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-2 xl:col-span-5">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setIncidentQuery("");
                    setIncidentStatusFilter("all");
                    setIncidentSeverityFilter("all");
                    setIncidentVisibilityFilter("all");
                  }}
                  disabled={!hasIncidentFilters}
                >
                  Clear filters
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Active Incidents</CardTitle>
              <CardDescription>
                {filteredActiveIncidents.length > 0
                  ? `${filteredActiveIncidents.length} matching incident${
                      filteredActiveIncidents.length === 1 ? "" : "s"
                    }.`
                  : hasIncidentFilters
                    ? "No active incidents match current filters."
                    : "No active incidents right now."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {filteredActiveIncidents.length === 0 ? (
                <EmptyState
                  title={hasIncidentFilters ? "No matching active incidents" : "No active incidents"}
                  description={
                    hasIncidentFilters
                      ? "Try broadening your filters or clearing search."
                      : "Everything looks healthy right now."
                  }
                  action={
                    canManage ? (
                      <Button type="button" variant="outline" onClick={() => setShowCreateIncidentForm(true)}>
                        <Plus className="mr-2 h-4 w-4" />
                        Declare Incident
                      </Button>
                    ) : null
                  }
                />
              ) : (
                filteredActiveIncidents.map((incident) => {
                  const timelineDraft = timelineDrafts[incident.id] ?? {
                    message: "",
                    status: incident.status,
                    isPublic: incident.is_public,
                  };
                  const orderedUpdates = sortIncidentUpdatesByNewest(incident);
                  const latestUpdate = orderedUpdates[0] ?? null;
                  const historicalUpdates = orderedUpdates.slice(1);
                  const isHistoryOpen = Boolean(expandedTimelineIncidentIds[incident.id]);
                  return (
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
                            {toLabel(incident.status)}
                          </Badge>
                          <Badge className={severityBadgeClass(incident.severity)}>
                            {toLabel(incident.severity)}
                          </Badge>
                          <Badge variant="outline">{incident.is_public ? "Public" : "Internal"}</Badge>
                        </div>
                      </div>

                      {incident.summary ? (
                        <p className="mt-3 text-sm text-foreground">{incident.summary}</p>
                      ) : null}

                      {incident.impacts.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {incident.impacts.map((impact) => (
                            <Badge
                              key={impact.id}
                              className={healthBadgeClass(impact.impact_level)}
                            >
                              {(impact.service?.name ?? "Unknown Service")} - {toLabel(impact.impact_level)}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-3 text-xs text-muted-foreground">No impacted services linked.</p>
                      )}

                      {latestUpdate ? (
                        <div className="mt-4 rounded-md border border-border bg-muted/50 p-3">
                          <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                            <span>Latest update</span>
                            <span>-</span>
                            <span>{formatDateTime(latestUpdate.created_at)}</span>
                            {latestUpdate.status ? <span>- {toLabel(latestUpdate.status)}</span> : null}
                            {latestUpdate.is_public ? <span>- Public</span> : <span>- Internal</span>}
                          </div>
                          <p className="text-sm text-foreground">{latestUpdate.message}</p>
                        </div>
                      ) : (
                        <p className="mt-4 text-sm text-muted-foreground">No timeline updates yet.</p>
                      )}

                      {historicalUpdates.length > 0 ? (
                        <Collapsible
                          open={isHistoryOpen}
                          onOpenChange={(open) =>
                            setExpandedTimelineIncidentIds((prev) => ({
                              ...prev,
                              [incident.id]: open,
                            }))
                          }
                        >
                          <CollapsibleTrigger asChild>
                            <Button type="button" variant="ghost" className="mt-2 gap-2 px-1">
                              {isHistoryOpen ? (
                                <>
                                  <ChevronUp className="h-4 w-4" />
                                  Hide previous updates
                                </>
                              ) : (
                                <>
                                  <ChevronDown className="h-4 w-4" />
                                  Show previous updates ({historicalUpdates.length})
                                </>
                              )}
                            </Button>
                          </CollapsibleTrigger>
                          <CollapsibleContent className="mt-2 space-y-2">
                            {historicalUpdates.map((update) => (
                              <div key={update.id} className="rounded-md border border-border p-3">
                                <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                                  <span>{formatDateTime(update.created_at)}</span>
                                  {update.status ? <span>- {toLabel(update.status)}</span> : null}
                                  {update.is_public ? <span>- Public</span> : <span>- Internal</span>}
                                </div>
                                <p className="text-sm text-foreground">{update.message}</p>
                              </div>
                            ))}
                          </CollapsibleContent>
                        </Collapsible>
                      ) : null}

                      {canManage ? (
                        <div className="mt-4 rounded-md border border-border p-3">
                          <p className="mb-2 text-sm font-medium text-foreground">Add Timeline Update</p>
                          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                            <div className="space-y-2">
                              <Label>Status</Label>
                              <Select
                                value={timelineDraft.status}
                                onValueChange={(value) =>
                                  setTimelineDrafts((prev) => ({
                                    ...prev,
                                    [incident.id]: {
                                      ...timelineDraft,
                                      status: value as IncidentStatus,
                                    },
                                  }))
                                }
                                disabled={postingUpdateId === incident.id}
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {INCIDENT_STATUS_OPTIONS.map((status) => (
                                    <SelectItem key={status} value={status}>
                                      {toLabel(status)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 lg:col-span-2">
                              <div>
                                <p className="text-sm font-medium text-foreground">Public update</p>
                                <p className="text-xs text-muted-foreground">
                                  Visible on external status page when enabled.
                                </p>
                              </div>
                              <Switch
                                checked={timelineDraft.isPublic}
                                onCheckedChange={(checked) =>
                                  setTimelineDrafts((prev) => ({
                                    ...prev,
                                    [incident.id]: {
                                      ...timelineDraft,
                                      isPublic: checked,
                                    },
                                  }))
                                }
                                disabled={postingUpdateId === incident.id}
                              />
                            </div>
                            <div className="space-y-2 lg:col-span-3">
                              <Label>Message</Label>
                              <Textarea
                                rows={2}
                                value={timelineDraft.message}
                                onChange={(event) =>
                                  setTimelineDrafts((prev) => ({
                                    ...prev,
                                    [incident.id]: {
                                      ...timelineDraft,
                                      message: event.target.value,
                                    },
                                  }))
                                }
                                placeholder="Mitigation started. Error rate reduced."
                                disabled={postingUpdateId === incident.id}
                              />
                            </div>
                          </div>
                          <div className="mt-3">
                            <Button
                              className="gap-2"
                              onClick={() => void handlePostTimelineUpdate(incident)}
                              disabled={postingUpdateId === incident.id}
                            >
                              {postingUpdateId === incident.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Send className="h-4 w-4" />
                              )}
                              Post Update
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Collapsible open={showResolvedIncidents} onOpenChange={setShowResolvedIncidents}>
            <Card>
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>Resolved Incidents</CardTitle>
                  <CardDescription>
                    {filteredResolvedIncidents.length > 0
                      ? `${filteredResolvedIncidents.length} matching resolved incident${
                          filteredResolvedIncidents.length === 1 ? "" : "s"
                        }.`
                      : hasIncidentFilters
                        ? "No resolved incidents match current filters."
                        : "Recent incidents that were fully resolved."}
                  </CardDescription>
                </div>
                <CollapsibleTrigger asChild>
                  <Button type="button" variant="outline" className="gap-2">
                    {showResolvedIncidents ? (
                      <>
                        <ChevronUp className="h-4 w-4" />
                        Hide resolved
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-4 w-4" />
                        Show resolved
                      </>
                    )}
                  </Button>
                </CollapsibleTrigger>
              </CardHeader>
              <CollapsibleContent>
                <CardContent className="space-y-3">
                  {filteredResolvedIncidents.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No resolved incidents to show.</p>
                  ) : (
                    filteredResolvedIncidents.map((incident) => (
                      <div key={incident.id} className="rounded-md border border-border p-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="font-medium text-foreground">{incident.title}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Resolved {formatDateTime(incident.resolved_at)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge className={statusBadgeClass(incident.status)}>
                              {toLabel(incident.status)}
                            </Badge>
                            <Badge className={severityBadgeClass(incident.severity)}>
                              {toLabel(incident.severity)}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        </>
      ) : null}

      <AlertDialog
        open={Boolean(servicePendingDelete)}
        onOpenChange={(open) => {
          if (!open && !deletingServiceId) {
            setServicePendingDelete(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Service</AlertDialogTitle>
            <AlertDialogDescription>
              Delete &quot;{servicePendingDelete?.name ?? "this service"}&quot;? This will also remove its
              impact links from existing incidents.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(deletingServiceId)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteService();
              }}
              disabled={Boolean(deletingServiceId)}
              className="bg-red-600 hover:bg-red-700"
            >
              {deletingServiceId ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deleting...
                </span>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

