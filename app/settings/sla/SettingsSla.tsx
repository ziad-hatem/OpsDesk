"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Play,
  RefreshCcw,
} from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "@/app/components/StatusBadge";
import { Button } from "@/app/components/ui/button";
import { Badge } from "@/app/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Separator } from "@/app/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { Switch } from "@/app/components/ui/switch";
import SettingsNav from "@/app/settings/SettingsNav";
import { useAppSelector } from "@/lib/store/hooks";
import { selectTopbarActiveOrganizationId } from "@/lib/store/slices/topbar-slice";
import type { SlaPoliciesResponse, SlaPolicy, SlaRunEscalationResult } from "@/lib/sla/types";
import type { OrganizationRole } from "@/lib/topbar/types";

type EditablePolicy = SlaPolicy & {
  first_response_minutes_input: string;
  resolution_minutes_input: string;
  warning_minutes_input: string;
};

type EditableMinutesField =
  | "first_response_minutes_input"
  | "resolution_minutes_input"
  | "warning_minutes_input";

type PolicyInputError = {
  field: EditableMinutesField;
  message: string;
};

const PRIORITY_ORDER: Array<SlaPolicy["priority"]> = ["urgent", "high", "medium", "low"];

function toEditable(policy: SlaPolicy): EditablePolicy {
  return {
    ...policy,
    first_response_minutes_input: String(policy.first_response_minutes),
    resolution_minutes_input: String(policy.resolution_minutes),
    warning_minutes_input: String(policy.warning_minutes),
  };
}

function toLabel(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseWholeNumber(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return null;
  }
  return parsed;
}

function formatMinutesLabel(value: string): string {
  const totalMinutes = parseWholeNumber(value);
  if (totalMinutes === null || totalMinutes < 0) {
    return "-";
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return `${minutes}m`;
  }
  if (minutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${minutes}m`;
}

function getPolicyInputErrors(policy: EditablePolicy): PolicyInputError[] {
  const errors: PolicyInputError[] = [];

  const firstResponseMinutes = parseWholeNumber(
    policy.first_response_minutes_input,
  );
  if (firstResponseMinutes === null || firstResponseMinutes <= 0) {
    errors.push({
      field: "first_response_minutes_input",
      message: "Enter a positive whole number.",
    });
  }

  const resolutionMinutes = parseWholeNumber(policy.resolution_minutes_input);
  if (resolutionMinutes === null || resolutionMinutes <= 0) {
    errors.push({
      field: "resolution_minutes_input",
      message: "Enter a positive whole number.",
    });
  }

  const warningMinutes = parseWholeNumber(policy.warning_minutes_input);
  if (warningMinutes === null || warningMinutes < 0) {
    errors.push({
      field: "warning_minutes_input",
      message: "Enter 0 or a positive whole number.",
    });
  }

  return errors;
}

function createPoliciesSnapshot(rows: EditablePolicy[]): string {
  return JSON.stringify(
    rows.map((policy) => ({
      priority: policy.priority,
      first_response_minutes_input: policy.first_response_minutes_input,
      resolution_minutes_input: policy.resolution_minutes_input,
      warning_minutes_input: policy.warning_minutes_input,
      escalation_role: policy.escalation_role,
      auto_escalate: policy.auto_escalate,
    })),
  );
}

async function readApiError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload.error) {
      return payload.error;
    }
  } catch {
    // fall through
  }
  return response.statusText || `Request failed (${response.status})`;
}

export default function SettingsSla() {
  const activeOrgId = useAppSelector(selectTopbarActiveOrganizationId);

  const [policies, setPolicies] = useState<EditablePolicy[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [lastRunResult, setLastRunResult] = useState<SlaRunEscalationResult | null>(null);
  const [baselineSnapshot, setBaselineSnapshot] = useState("");

  const loadPolicies = useCallback(async () => {
    if (!activeOrgId) {
      setPolicies([]);
      setIsLoading(false);
      setLastRunResult(null);
      setBaselineSnapshot("");
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch("/api/sla/policies", {
        method: "GET",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      const payload = (await response.json()) as SlaPoliciesResponse;
      const rows = (payload.policies ?? []).map(toEditable);
      rows.sort(
        (left, right) =>
          PRIORITY_ORDER.indexOf(left.priority) - PRIORITY_ORDER.indexOf(right.priority),
      );
      setPolicies(rows);
      setBaselineSnapshot(createPoliciesSnapshot(rows));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to load SLA policies";
      toast.error(message);
      setPolicies([]);
      setBaselineSnapshot("");
    } finally {
      setIsLoading(false);
    }
  }, [activeOrgId]);

  useEffect(() => {
    void loadPolicies();
  }, [loadPolicies]);

  const updatePolicy = useCallback(
    (priority: SlaPolicy["priority"], patch: Partial<EditablePolicy>) => {
      setPolicies((prev) =>
        prev.map((entry) =>
          entry.priority === priority ? { ...entry, ...patch } : entry,
        ),
      );
    },
    [],
  );

  const policyErrorsByPriority = useMemo(
    () =>
      new Map<SlaPolicy["priority"], PolicyInputError[]>(
        policies.map((policy) => [policy.priority, getPolicyInputErrors(policy)]),
      ),
    [policies],
  );

  const hasInvalidPolicyInputs = useMemo(
    () =>
      Array.from(policyErrorsByPriority.values()).some(
        (errors) => errors.length > 0,
      ),
    [policyErrorsByPriority],
  );

  const currentSnapshot = useMemo(
    () => createPoliciesSnapshot(policies),
    [policies],
  );
  const isDirty = policies.length > 0 && currentSnapshot !== baselineSnapshot;

  const autoEscalationEnabledCount = useMemo(
    () => policies.filter((policy) => policy.auto_escalate).length,
    [policies],
  );

  const escalationRoleSummary = useMemo(() => {
    const counts = new Map<OrganizationRole, number>();
    for (const policy of policies) {
      counts.set(
        policy.escalation_role,
        (counts.get(policy.escalation_role) ?? 0) + 1,
      );
    }
    const summaryParts = Array.from(counts.entries())
      .sort((left, right) => right[1] - left[1])
      .map(([role, count]) => `${count} ${toLabel(role)}`);
    return summaryParts.length > 0 ? summaryParts.join(", ") : "No roles set";
  }, [policies]);

  const handleSavePolicies = async () => {
    if (!policies.length) {
      toast.error("No SLA policies to save");
      return;
    }

    for (const policy of policies) {
      const errors = getPolicyInputErrors(policy);
      if (errors.length > 0) {
        toast.error(`${toLabel(policy.priority)}: ${errors[0].message}`);
        return;
      }
    }

    setIsSaving(true);
    const toastId = toast.loading("Saving SLA policies...");
    try {
      const response = await fetch("/api/sla/policies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          policies: policies.map((policy) => ({
            priority: policy.priority,
            firstResponseMinutes: Number(policy.first_response_minutes_input),
            resolutionMinutes: Number(policy.resolution_minutes_input),
            warningMinutes: Number(policy.warning_minutes_input),
            escalationRole: policy.escalation_role,
            autoEscalate: policy.auto_escalate,
          })),
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const payload = (await response.json()) as SlaPoliciesResponse;
      const rows = (payload.policies ?? []).map(toEditable);
      rows.sort(
        (left, right) =>
          PRIORITY_ORDER.indexOf(left.priority) - PRIORITY_ORDER.indexOf(right.priority),
      );
      setPolicies(rows);
      setBaselineSnapshot(createPoliciesSnapshot(rows));
      toast.success("SLA policies saved", { id: toastId });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to save SLA policies";
      toast.error(message, { id: toastId });
    } finally {
      setIsSaving(false);
    }
  };

  const handleRunEscalation = async () => {
    setIsRunning(true);
    const toastId = toast.loading("Running SLA escalation...");
    try {
      const response = await fetch("/api/sla/run", { method: "POST" });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      const payload = (await response.json()) as SlaRunEscalationResult;
      setLastRunResult(payload);
      toast.success("SLA escalation completed", { id: toastId });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to run SLA escalation";
      toast.error(message, { id: toastId });
    } finally {
      setIsRunning(false);
    }
  };

  const handleResetDraft = () => {
    void loadPolicies();
  };

  const policyCards = useMemo(
    () =>
      policies.map((policy) => {
        const policyErrors = policyErrorsByPriority.get(policy.priority) ?? [];
        const firstResponseError =
          policyErrors.find(
            (error) => error.field === "first_response_minutes_input",
          )?.message ?? null;
        const resolutionError =
          policyErrors.find(
            (error) => error.field === "resolution_minutes_input",
          )?.message ?? null;
        const warningError =
          policyErrors.find((error) => error.field === "warning_minutes_input")
            ?.message ?? null;

        const warningMinutes = parseWholeNumber(policy.warning_minutes_input);
        const warningHint =
          warningMinutes === 0
            ? "Warn exactly at due time."
            : `Warn ${formatMinutesLabel(
                policy.warning_minutes_input,
              )} before due.`;

        return (
          <Card key={policy.priority} className="border-border/70 shadow-sm">
            <CardHeader className="space-y-3 pb-4">
              <div className="flex items-center justify-between gap-2">
                <StatusBadge status={policy.priority} />
                <Badge variant={policy.auto_escalate ? "default" : "outline"}>
                  {policy.auto_escalate
                    ? "Auto Escalation On"
                    : "Auto Escalation Off"}
                </Badge>
              </div>
              <div className="space-y-1">
                <CardTitle className="text-lg">
                  {toLabel(policy.priority)} Priority Policy
                </CardTitle>
                <CardDescription>
                  First response in{" "}
                  <span className="font-medium text-foreground">
                    {formatMinutesLabel(policy.first_response_minutes_input)}
                  </span>
                  , resolve in{" "}
                  <span className="font-medium text-foreground">
                    {formatMinutesLabel(policy.resolution_minutes_input)}
                  </span>
                  .
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor={`${policy.priority}-first-response`}>
                    First response (minutes)
                  </Label>
                  <Input
                    id={`${policy.priority}-first-response`}
                    type="number"
                    min={1}
                    value={policy.first_response_minutes_input}
                    onChange={(event) =>
                      updatePolicy(policy.priority, {
                        first_response_minutes_input: event.target.value,
                      })
                    }
                    disabled={isSaving}
                    className={
                      firstResponseError
                        ? "border-destructive focus-visible:ring-destructive/40"
                        : undefined
                    }
                  />
                  <p
                    className={`text-xs ${
                      firstResponseError
                        ? "text-destructive"
                        : "text-muted-foreground"
                    }`}
                  >
                    {firstResponseError ??
                      `Target: ${formatMinutesLabel(
                        policy.first_response_minutes_input,
                      )}`}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`${policy.priority}-resolution`}>
                    Resolution (minutes)
                  </Label>
                  <Input
                    id={`${policy.priority}-resolution`}
                    type="number"
                    min={1}
                    value={policy.resolution_minutes_input}
                    onChange={(event) =>
                      updatePolicy(policy.priority, {
                        resolution_minutes_input: event.target.value,
                      })
                    }
                    disabled={isSaving}
                    className={
                      resolutionError
                        ? "border-destructive focus-visible:ring-destructive/40"
                        : undefined
                    }
                  />
                  <p
                    className={`text-xs ${
                      resolutionError ? "text-destructive" : "text-muted-foreground"
                    }`}
                  >
                    {resolutionError ??
                      `Target: ${formatMinutesLabel(
                        policy.resolution_minutes_input,
                      )}`}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`${policy.priority}-warning`}>
                    Warning before due (minutes)
                  </Label>
                  <Input
                    id={`${policy.priority}-warning`}
                    type="number"
                    min={0}
                    value={policy.warning_minutes_input}
                    onChange={(event) =>
                      updatePolicy(policy.priority, {
                        warning_minutes_input: event.target.value,
                      })
                    }
                    disabled={isSaving}
                    className={
                      warningError
                        ? "border-destructive focus-visible:ring-destructive/40"
                        : undefined
                    }
                  />
                  <p
                    className={`text-xs ${
                      warningError ? "text-destructive" : "text-muted-foreground"
                    }`}
                  >
                    {warningError ?? warningHint}
                  </p>
                </div>
              </div>

              <Separator />

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Escalation role</Label>
                  <Select
                    value={policy.escalation_role}
                    onValueChange={(value) =>
                      updatePolicy(policy.priority, {
                        escalation_role: value as OrganizationRole,
                      })
                    }
                    disabled={isSaving}
                  >
                    <SelectTrigger className="focus-visible:ring-2 focus-visible:ring-ring">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manager">Manager</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Breached tickets can be escalated to this role.
                  </p>
                </div>

                <div className="rounded-md border border-border bg-muted/30 px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">
                        Auto escalate breaches
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Reassign breached tickets to the escalation role
                        automatically.
                      </p>
                    </div>
                    <Switch
                      checked={policy.auto_escalate}
                      onCheckedChange={(checked) =>
                        updatePolicy(policy.priority, {
                          auto_escalate: checked,
                        })
                      }
                      disabled={isSaving}
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      }),
    [isSaving, policies, policyErrorsByPriority, updatePolicy],
  );

  const canSavePolicies =
    !isLoading &&
    !isSaving &&
    policies.length > 0 &&
    isDirty &&
    !hasInvalidPolicyInputs;

  if (!activeOrgId) {
    return (
      <div className="space-y-4 p-6">
        <SettingsNav />
        <Card>
          <CardContent className="p-6 text-muted-foreground">
            Select or create an organization to manage SLA policies.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <SettingsNav />

      <Card className="border-border/70">
        <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between mb-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-2xl">SLA & Escalation</CardTitle>
              <Badge variant={isDirty ? "secondary" : "outline"}>
                {isDirty ? "Unsaved Changes" : "All Changes Saved"}
              </Badge>
            </div>
            <CardDescription>
              Configure response/resolution timers by priority and control
              automatic escalation behavior.
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              onClick={handleResetDraft}
              disabled={isLoading || isSaving}
              className="gap-2"
            >
              <RefreshCcw className="h-4 w-4" />
              Reload
            </Button>
            <Button
              variant="outline"
              onClick={handleRunEscalation}
              disabled={isRunning || isLoading}
              className="gap-2"
            >
              {isRunning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  Run Escalation
                </>
              )}
            </Button>
            <Button onClick={handleSavePolicies} disabled={!canSavePolicies}>
              {isSaving ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </span>
              ) : (
                "Save Policies"
              )}
            </Button>
          </div>
        </CardHeader>
      </Card>

      {lastRunResult ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Last Escalation Run</CardTitle>
            <CardDescription>
              Latest background sweep result for SLA warnings, breaches, and
              reassignment.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">Tickets Scanned</p>
                <p className="mt-1 text-xl font-semibold text-foreground">
                  {lastRunResult.scanned}
                </p>
              </div>
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">Warnings Created</p>
                <p className="mt-1 text-xl font-semibold text-foreground">
                  {lastRunResult.warningsCreated}
                </p>
              </div>
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">Breaches Created</p>
                <p className="mt-1 text-xl font-semibold text-foreground">
                  {lastRunResult.breachesCreated}
                </p>
              </div>
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">Auto Escalations</p>
                <p className="mt-1 text-xl font-semibold text-foreground">
                  {lastRunResult.autoEscalations}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {isLoading ? (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin" />
            Loading SLA policies...
          </CardContent>
        </Card>
      ) : policies.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            No SLA policies found for this organization.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Policy Summary</CardTitle>
              <CardDescription>
                Quick overview of escalation readiness before saving.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-md border border-border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Policies</p>
                  <p className="mt-1 text-xl font-semibold text-foreground">
                    {policies.length}
                  </p>
                </div>
                <div className="rounded-md border border-border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">
                    Auto Escalation Enabled
                  </p>
                  <p className="mt-1 text-xl font-semibold text-foreground">
                    {autoEscalationEnabledCount}/{policies.length}
                  </p>
                </div>
                <div className="rounded-md border border-border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">
                    Escalation Role Distribution
                  </p>
                  <p className="mt-1 text-sm font-medium text-foreground">
                    {escalationRoleSummary}
                  </p>
                </div>
                <div className="rounded-md border border-border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Input Validation</p>
                  <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium">
                    {hasInvalidPolicyInputs ? (
                      <>
                        <AlertCircle className="h-4 w-4 text-amber-600" />
                        <span className="text-amber-700">Needs attention</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        <span className="text-emerald-700">Ready to save</span>
                      </>
                    )}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {policyCards}
          </div>
        </>
      )}
    </div>
  );
}

