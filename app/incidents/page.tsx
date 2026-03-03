"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Globe, Loader2, Plus, RefreshCcw, Save, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";
import { Badge } from "@/app/components/ui/badge";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Switch } from "@/app/components/ui/switch";
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
  return "bg-slate-100 text-slate-700 hover:bg-slate-100";
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

  const [serviceDrafts, setServiceDrafts] = useState<Record<string, ServiceDraft>>({});
  const [savingServiceId, setSavingServiceId] = useState<string | null>(null);
  const [deletingServiceId, setDeletingServiceId] = useState<string | null>(null);
  const [servicePendingDelete, setServicePendingDelete] = useState<IncidentService | null>(null);

  const [timelineDrafts, setTimelineDrafts] = useState<Record<string, IncidentTimelineDraft>>({});
  const [postingUpdateId, setPostingUpdateId] = useState<string | null>(null);

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

  if (!activeOrgId) {
    return (
      <div className="space-y-4 p-6">
        <Card>
          <CardContent className="p-6 text-slate-600">
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
          <h1 className="text-3xl font-semibold text-slate-900">Incident Management</h1>
          <p className="text-slate-600">
            Create incidents, manage impacted services, and publish timeline updates.
          </p>
          {data?.organizationSlug ? (
            <p className="text-sm text-slate-500">
              Public status page:{" "}
              <Link
                href={`/status/${data.organizationSlug}`}
                className="font-medium text-slate-700 underline decoration-slate-300 underline-offset-2"
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
          <CardContent className="flex items-center gap-2 py-8 text-slate-600">
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
                <form className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 p-4 md:grid-cols-2 xl:grid-cols-6" onSubmit={handleCreateService}>
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
                  <div className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 md:col-span-2 xl:col-span-3">
                    <div>
                      <p className="text-sm font-medium text-slate-900">Show on public page</p>
                      <p className="text-xs text-slate-500">Hide internal-only services</p>
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

              {data.services.length === 0 ? (
                <p className="text-sm text-slate-600">No services added yet.</p>
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
                        className="rounded-lg border border-slate-200 bg-white p-4"
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
                            <div className="flex items-center gap-2 rounded-md border border-slate-200 px-2 py-1">
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
                              <span className="text-xs text-slate-600">Public status</span>
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
              <CardHeader>
                <CardTitle>Create Incident</CardTitle>
                <CardDescription>
                  Declare a new incident and choose which services are impacted.
                </CardDescription>
              </CardHeader>
              <CardContent>
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
                              next[serviceId] =
                                impact || defaultImpactForSeverity(nextSeverity);
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
                    <div className="rounded-md border border-slate-200 px-3 py-2 md:col-span-2">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-slate-900">Public incident</p>
                          <p className="text-xs text-slate-500">
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
                      <p className="text-sm text-slate-500">
                        Add at least one service before declaring incident impacts.
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                        {data.services.map((service) => {
                          const selected = Boolean(selectedImpacts[service.id]);
                          return (
                            <div
                              key={service.id}
                              className="rounded-md border border-slate-200 p-3"
                            >
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
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Active Incidents</CardTitle>
              <CardDescription>
                {activeIncidents.length > 0
                  ? "Live incidents and latest timeline updates."
                  : "No active incidents right now."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {activeIncidents.length === 0 ? (
                <p className="text-sm text-slate-600">No active incidents.</p>
              ) : (
                activeIncidents.map((incident) => {
                  const timelineDraft = timelineDrafts[incident.id] ?? {
                    message: "",
                    status: incident.status,
                    isPublic: incident.is_public,
                  };
                  return (
                    <div key={incident.id} className="rounded-lg border border-slate-200 bg-white p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold text-slate-900">{incident.title}</p>
                          <p className="mt-1 text-xs text-slate-500">
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
                        <p className="mt-3 text-sm text-slate-700">{incident.summary}</p>
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
                        <p className="mt-3 text-xs text-slate-500">No impacted services linked.</p>
                      )}

                      <div className="mt-4 space-y-2">
                        {incident.updates.length === 0 ? (
                          <p className="text-sm text-slate-500">No timeline updates yet.</p>
                        ) : (
                          incident.updates.map((update) => (
                            <div
                              key={update.id}
                              className="rounded-md border border-slate-200 bg-slate-50 p-3"
                            >
                              <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
                                <span>{formatDateTime(update.created_at)}</span>
                                {update.status ? <span>| {toLabel(update.status)}</span> : null}
                                {update.is_public ? <span>| Public</span> : <span>| Internal</span>}
                              </div>
                              <p className="text-sm text-slate-700">{update.message}</p>
                            </div>
                          ))
                        )}
                      </div>

                      {canManage ? (
                        <div className="mt-4 rounded-md border border-slate-200 p-3">
                          <p className="mb-2 text-sm font-medium text-slate-900">Add Timeline Update</p>
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
                            <div className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 lg:col-span-2">
                              <div>
                                <p className="text-sm font-medium text-slate-900">Public update</p>
                                <p className="text-xs text-slate-500">
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

          <Card>
            <CardHeader>
              <CardTitle>Resolved Incidents</CardTitle>
              <CardDescription>Recent incidents that were fully resolved.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {resolvedIncidents.length === 0 ? (
                <p className="text-sm text-slate-600">No resolved incidents yet.</p>
              ) : (
                resolvedIncidents.map((incident) => (
                  <div key={incident.id} className="rounded-md border border-slate-200 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-slate-900">{incident.title}</p>
                        <p className="mt-1 text-xs text-slate-500">
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
          </Card>
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
