"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
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

  const loadPolicies = useCallback(async () => {
    if (!activeOrgId) {
      setPolicies([]);
      setIsLoading(false);
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
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to load SLA policies";
      toast.error(message);
      setPolicies([]);
    } finally {
      setIsLoading(false);
    }
  }, [activeOrgId]);

  useEffect(() => {
    void loadPolicies();
  }, [loadPolicies]);

  const handleSavePolicies = async () => {
    if (!policies.length) {
      toast.error("No SLA policies to save");
      return;
    }

    for (const policy of policies) {
      const firstResponseMinutes = Number(policy.first_response_minutes_input);
      const resolutionMinutes = Number(policy.resolution_minutes_input);
      const warningMinutes = Number(policy.warning_minutes_input);

      if (!Number.isInteger(firstResponseMinutes) || firstResponseMinutes <= 0) {
        toast.error(`Invalid first response minutes for ${toLabel(policy.priority)}`);
        return;
      }
      if (!Number.isInteger(resolutionMinutes) || resolutionMinutes <= 0) {
        toast.error(`Invalid resolution minutes for ${toLabel(policy.priority)}`);
        return;
      }
      if (!Number.isInteger(warningMinutes) || warningMinutes < 0) {
        toast.error(`Invalid warning minutes for ${toLabel(policy.priority)}`);
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

  const policyCards = useMemo(
    () =>
      policies.map((policy) => (
        <Card key={policy.priority}>
          <CardHeader>
            <CardTitle>{toLabel(policy.priority)} Priority</CardTitle>
            <CardDescription>Per-priority response and resolution policy</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>First Response (min)</Label>
                <Input
                  type="number"
                  min={1}
                  value={policy.first_response_minutes_input}
                  onChange={(event) =>
                    setPolicies((prev) =>
                      prev.map((entry) =>
                        entry.priority === policy.priority
                          ? { ...entry, first_response_minutes_input: event.target.value }
                          : entry,
                      ),
                    )
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Resolution (min)</Label>
                <Input
                  type="number"
                  min={1}
                  value={policy.resolution_minutes_input}
                  onChange={(event) =>
                    setPolicies((prev) =>
                      prev.map((entry) =>
                        entry.priority === policy.priority
                          ? { ...entry, resolution_minutes_input: event.target.value }
                          : entry,
                      ),
                    )
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Warning Before Due (min)</Label>
                <Input
                  type="number"
                  min={0}
                  value={policy.warning_minutes_input}
                  onChange={(event) =>
                    setPolicies((prev) =>
                      prev.map((entry) =>
                        entry.priority === policy.priority
                          ? { ...entry, warning_minutes_input: event.target.value }
                          : entry,
                      ),
                    )
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Escalation Role</Label>
                <Select
                  value={policy.escalation_role}
                  onValueChange={(value) =>
                    setPolicies((prev) =>
                      prev.map((entry) =>
                        entry.priority === policy.priority
                          ? { ...entry, escalation_role: value as OrganizationRole }
                          : entry,
                      ),
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Auto Escalate</Label>
                <div className="flex h-10 items-center rounded-md border border-slate-200 px-3">
                  <Switch
                    checked={policy.auto_escalate}
                    onCheckedChange={(checked) =>
                      setPolicies((prev) =>
                        prev.map((entry) =>
                          entry.priority === policy.priority
                            ? { ...entry, auto_escalate: checked }
                            : entry,
                        ),
                      )
                    }
                  />
                  <span className="ml-3 text-sm text-slate-600">
                    Reassign breached tickets to escalation role
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )),
    [policies],
  );

  if (!activeOrgId) {
    return (
      <div className="p-6 space-y-4">
        <SettingsNav />
        <Card>
          <CardContent className="p-6 text-slate-600">
            Select or create an organization to manage SLA policies.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <SettingsNav />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900">SLA & Escalation</h1>
          <p className="text-slate-600 mt-1">
            Configure per-priority first-response and resolution timers with auto-escalation.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleRunEscalation}
            disabled={isRunning}
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
          <Button onClick={handleSavePolicies} disabled={isSaving || isLoading}>
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
      </div>

      {lastRunResult && (
        <Card>
          <CardContent className="p-4 text-sm text-slate-700">
            Last run: scanned {lastRunResult.scanned} tickets, created {lastRunResult.warningsCreated} warnings,{" "}
            {lastRunResult.breachesCreated} breaches, {lastRunResult.autoEscalations} auto-escalations.
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <Card>
          <CardContent className="p-10 text-center text-slate-500">
            <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin" />
            Loading SLA policies...
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6">{policyCards}</div>
      )}
    </div>
  );
}
