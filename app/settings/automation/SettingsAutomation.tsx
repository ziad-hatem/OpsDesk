"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus } from "lucide-react";
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
import type {
  AutomationAction,
  AutomationAssigneeState,
  AutomationChangedField,
  AutomationRule,
  AutomationRulesResponse,
  AutomationTriggerEvent,
} from "@/lib/automation/types";
import { useAppSelector } from "@/lib/store/hooks";
import { selectTopbarActiveOrganizationId } from "@/lib/store/slices/topbar-slice";
import type { OrganizationRole } from "@/lib/topbar/types";
import type { TicketPriority, TicketStatus } from "@/lib/tickets/types";

type RulePriority = "any" | TicketPriority;
type RuleStatus = "any" | TicketStatus;
type RuleChangedField = "any" | AutomationChangedField;
type RuleRole = "none" | OrganizationRole;

type EditableRule = {
  id?: string;
  name: string;
  description: string;
  triggerEvent: AutomationTriggerEvent;
  isEnabled: boolean;
  priority: RulePriority;
  status: RuleStatus;
  assigneeState: AutomationAssigneeState;
  changedField: RuleChangedField;
  assignRole: RuleRole;
  notifyRole: RuleRole;
  notifyTitle: string;
  notifyBody: string;
  comment: string;
  setStatus: "none" | TicketStatus;
  setPriority: "none" | TicketPriority;
};

const PRIORITY_OPTIONS: RulePriority[] = ["any", "urgent", "high", "medium", "low"];
const STATUS_OPTIONS: RuleStatus[] = ["any", "open", "pending", "resolved", "closed"];
const CHANGED_FIELD_OPTIONS: RuleChangedField[] = ["any", "status", "priority", "assignee_id"];
const ROLE_OPTIONS: RuleRole[] = ["none", "admin", "manager", "support", "read_only"];
const ACTION_STATUS_OPTIONS: Array<"none" | TicketStatus> = ["none", "open", "pending", "resolved", "closed"];
const ACTION_PRIORITY_OPTIONS: Array<"none" | TicketPriority> = [
  "none",
  "urgent",
  "high",
  "medium",
  "low",
];

function toLabel(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function emptyRule(): EditableRule {
  return {
    name: "",
    description: "",
    triggerEvent: "ticket.created",
    isEnabled: true,
    priority: "any",
    status: "any",
    assigneeState: "any",
    changedField: "any",
    assignRole: "none",
    notifyRole: "none",
    notifyTitle: "",
    notifyBody: "",
    comment: "",
    setStatus: "none",
    setPriority: "none",
  };
}

function fromRule(rule: AutomationRule): EditableRule {
  const assignRoleAction = rule.actions.find(
    (action): action is Extract<AutomationAction, { type: "assign_role" }> =>
      action.type === "assign_role",
  );
  const notifyRoleAction = rule.actions.find(
    (action): action is Extract<AutomationAction, { type: "notify_role" }> =>
      action.type === "notify_role",
  );
  const addCommentAction = rule.actions.find(
    (action): action is Extract<AutomationAction, { type: "add_comment" }> =>
      action.type === "add_comment",
  );
  const setStatusAction = rule.actions.find(
    (action): action is Extract<AutomationAction, { type: "set_status" }> =>
      action.type === "set_status",
  );
  const setPriorityAction = rule.actions.find(
    (action): action is Extract<AutomationAction, { type: "set_priority" }> =>
      action.type === "set_priority",
  );

  return {
    id: rule.id,
    name: rule.name,
    description: rule.description ?? "",
    triggerEvent: rule.trigger_event,
    isEnabled: rule.is_enabled,
    priority: rule.conditions.priorities?.[0] ?? "any",
    status: rule.conditions.statuses?.[0] ?? "any",
    assigneeState: rule.conditions.assigneeState ?? "any",
    changedField: rule.conditions.changedFields?.[0] ?? "any",
    assignRole: assignRoleAction?.role ?? "none",
    notifyRole: notifyRoleAction?.role ?? "none",
    notifyTitle: notifyRoleAction?.title ?? "",
    notifyBody: notifyRoleAction?.body ?? "",
    comment: addCommentAction?.message ?? "",
    setStatus: setStatusAction?.status ?? "none",
    setPriority: setPriorityAction?.priority ?? "none",
  };
}

function toApiRule(rule: EditableRule) {
  const conditions: Record<string, unknown> = {};
  if (rule.priority !== "any") {
    conditions.priorities = [rule.priority];
  }
  if (rule.status !== "any") {
    conditions.statuses = [rule.status];
  }
  if (rule.assigneeState !== "any") {
    conditions.assigneeState = rule.assigneeState;
  }
  if (rule.changedField !== "any") {
    conditions.changedFields = [rule.changedField];
  }

  const actions: AutomationAction[] = [];
  if (rule.assignRole !== "none") {
    actions.push({
      type: "assign_role",
      role: rule.assignRole,
    });
  }
  if (rule.notifyRole !== "none") {
    actions.push({
      type: "notify_role",
      role: rule.notifyRole,
      title: rule.notifyTitle.trim() || null,
      body: rule.notifyBody.trim() || null,
    });
  }
  if (rule.comment.trim()) {
    actions.push({
      type: "add_comment",
      message: rule.comment.trim(),
    });
  }
  if (rule.setStatus !== "none") {
    actions.push({
      type: "set_status",
      status: rule.setStatus,
    });
  }
  if (rule.setPriority !== "none") {
    actions.push({
      type: "set_priority",
      priority: rule.setPriority,
    });
  }

  return {
    id: rule.id,
    name: rule.name.trim(),
    description: rule.description.trim() || null,
    triggerEvent: rule.triggerEvent,
    conditions,
    actions,
    isEnabled: rule.isEnabled,
  };
}

async function readApiError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload.error) {
      return payload.error;
    }
  } catch {
    // ignore parsing failures
  }
  return response.statusText || `Request failed (${response.status})`;
}

export default function SettingsAutomation() {
  const activeOrgId = useAppSelector(selectTopbarActiveOrganizationId);

  const [rules, setRules] = useState<EditableRule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const loadRules = useCallback(async () => {
    if (!activeOrgId) {
      setRules([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch("/api/automation/rules", {
        method: "GET",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const payload = (await response.json()) as AutomationRulesResponse;
      const mappedRules = (payload.rules ?? []).map(fromRule);
      setRules(mappedRules);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to load automation rules";
      toast.error(message);
      setRules([]);
    } finally {
      setIsLoading(false);
    }
  }, [activeOrgId]);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  const hasInvalidRules = useMemo(
    () =>
      rules.some((rule) => {
        if (!rule.name.trim()) {
          return true;
        }
        const parsed = toApiRule(rule);
        return parsed.actions.length === 0;
      }),
    [rules],
  );

  const handleSave = async () => {
    if (!rules.length) {
      toast.error("Add at least one rule before saving");
      return;
    }

    for (const rule of rules) {
      if (!rule.name.trim()) {
        toast.error("Every rule needs a name");
        return;
      }
      const parsed = toApiRule(rule);
      if (parsed.actions.length === 0) {
        toast.error(`Rule "${rule.name || "Untitled"}" needs at least one action`);
        return;
      }
    }

    setIsSaving(true);
    const toastId = toast.loading("Saving automation rules...");
    try {
      const response = await fetch("/api/automation/rules", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          rules: rules.map(toApiRule),
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const payload = (await response.json()) as AutomationRulesResponse;
      setRules((payload.rules ?? []).map(fromRule));
      toast.success("Automation rules saved", { id: toastId });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to save automation rules";
      toast.error(message, { id: toastId });
    } finally {
      setIsSaving(false);
    }
  };

  if (!activeOrgId) {
    return (
      <div className="p-6 space-y-4">
        <SettingsNav />
        <Card>
          <CardContent className="p-6 text-slate-600">
            Select or create an organization to manage automation rules.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <SettingsNav />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900">Workflow Automation</h1>
          <p className="mt-1 text-slate-600">
            Create if/then rules to auto-assign tickets, notify teams, and keep workflows fast.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setRules((prev) => [...prev, emptyRule()])}
            className="gap-2"
          >
            <Plus className="h-4 w-4" />
            Add Rule
          </Button>
          <Button onClick={handleSave} disabled={isSaving || isLoading || hasInvalidRules}>
            {isSaving ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </span>
            ) : (
              "Save Rules"
            )}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="p-10 text-center text-slate-500">
            <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin" />
            Loading automation rules...
          </CardContent>
        </Card>
      ) : rules.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-slate-500">
            No rules yet. Add your first automation rule.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {rules.map((rule, index) => (
            <Card key={rule.id ?? `new-${index}`}>
              <CardHeader>
                <CardTitle>Rule {index + 1}</CardTitle>
                <CardDescription>
                  Define trigger, conditions, and actions for this workflow rule.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Name</Label>
                    <Input
                      value={rule.name}
                      placeholder="Urgent Unassigned Auto-Assign"
                      onChange={(event) =>
                        setRules((prev) =>
                          prev.map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, name: event.target.value } : entry,
                          ),
                        )
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Input
                      value={rule.description}
                      placeholder="Optional description"
                      onChange={(event) =>
                        setRules((prev) =>
                          prev.map((entry, entryIndex) =>
                            entryIndex === index
                              ? { ...entry, description: event.target.value }
                              : entry,
                          ),
                        )
                      }
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Trigger</Label>
                    <Select
                      value={rule.triggerEvent}
                      onValueChange={(value) =>
                        setRules((prev) =>
                          prev.map((entry, entryIndex) =>
                            entryIndex === index
                              ? { ...entry, triggerEvent: value as AutomationTriggerEvent }
                              : entry,
                          ),
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ticket.created">Ticket Created</SelectItem>
                        <SelectItem value="ticket.updated">Ticket Updated</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Enabled</Label>
                    <div className="flex h-10 items-center rounded-md border border-slate-200 px-3">
                      <Switch
                        checked={rule.isEnabled}
                        onCheckedChange={(checked) =>
                          setRules((prev) =>
                            prev.map((entry, entryIndex) =>
                              entryIndex === index ? { ...entry, isEnabled: checked } : entry,
                            ),
                          )
                        }
                      />
                      <span className="ml-3 text-sm text-slate-600">
                        Rule is active
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Changed Field (updated only)</Label>
                    <Select
                      value={rule.changedField}
                      onValueChange={(value) =>
                        setRules((prev) =>
                          prev.map((entry, entryIndex) =>
                            entryIndex === index
                              ? { ...entry, changedField: value as RuleChangedField }
                              : entry,
                          ),
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CHANGED_FIELD_OPTIONS.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option === "any" ? "Any field" : toLabel(option)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Condition: Priority</Label>
                    <Select
                      value={rule.priority}
                      onValueChange={(value) =>
                        setRules((prev) =>
                          prev.map((entry, entryIndex) =>
                            entryIndex === index
                              ? { ...entry, priority: value as RulePriority }
                              : entry,
                          ),
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PRIORITY_OPTIONS.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option === "any" ? "Any priority" : toLabel(option)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Condition: Status</Label>
                    <Select
                      value={rule.status}
                      onValueChange={(value) =>
                        setRules((prev) =>
                          prev.map((entry, entryIndex) =>
                            entryIndex === index
                              ? { ...entry, status: value as RuleStatus }
                              : entry,
                          ),
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTIONS.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option === "any" ? "Any status" : toLabel(option)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Condition: Assignee</Label>
                    <Select
                      value={rule.assigneeState}
                      onValueChange={(value) =>
                        setRules((prev) =>
                          prev.map((entry, entryIndex) =>
                            entryIndex === index
                              ? { ...entry, assigneeState: value as AutomationAssigneeState }
                              : entry,
                          ),
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">Any</SelectItem>
                        <SelectItem value="assigned">Assigned</SelectItem>
                        <SelectItem value="unassigned">Unassigned</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                  <div className="space-y-2">
                    <Label>Action: Assign Role</Label>
                    <Select
                      value={rule.assignRole}
                      onValueChange={(value) =>
                        setRules((prev) =>
                          prev.map((entry, entryIndex) =>
                            entryIndex === index
                              ? { ...entry, assignRole: value as RuleRole }
                              : entry,
                          ),
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLE_OPTIONS.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option === "none" ? "No assignment" : toLabel(option)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Action: Notify Role</Label>
                    <Select
                      value={rule.notifyRole}
                      onValueChange={(value) =>
                        setRules((prev) =>
                          prev.map((entry, entryIndex) =>
                            entryIndex === index
                              ? { ...entry, notifyRole: value as RuleRole }
                              : entry,
                          ),
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLE_OPTIONS.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option === "none" ? "No notification" : toLabel(option)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Action: Set Status</Label>
                    <Select
                      value={rule.setStatus}
                      onValueChange={(value) =>
                        setRules((prev) =>
                          prev.map((entry, entryIndex) =>
                            entryIndex === index
                              ? { ...entry, setStatus: value as "none" | TicketStatus }
                              : entry,
                          ),
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ACTION_STATUS_OPTIONS.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option === "none" ? "No status change" : toLabel(option)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Action: Set Priority</Label>
                    <Select
                      value={rule.setPriority}
                      onValueChange={(value) =>
                        setRules((prev) =>
                          prev.map((entry, entryIndex) =>
                            entryIndex === index
                              ? { ...entry, setPriority: value as "none" | TicketPriority }
                              : entry,
                          ),
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ACTION_PRIORITY_OPTIONS.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option === "none" ? "No priority change" : toLabel(option)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Notification Title Template</Label>
                    <Input
                      value={rule.notifyTitle}
                      placeholder='Urgent ticket matched "{{ruleName}}"'
                      onChange={(event) =>
                        setRules((prev) =>
                          prev.map((entry, entryIndex) =>
                            entryIndex === index
                              ? { ...entry, notifyTitle: event.target.value }
                              : entry,
                          ),
                        )
                      }
                    />
                    <p className="text-xs text-slate-500">
                      Supports: {"{{title}}"}, {"{{ticketId}}"}, {"{{priority}}"}, {"{{status}}"}, {"{{ruleName}}"}.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>Notification Body Template</Label>
                    <Input
                      value={rule.notifyBody}
                      placeholder='Ticket "{{title}}" matched automation rule "{{ruleName}}".'
                      onChange={(event) =>
                        setRules((prev) =>
                          prev.map((entry, entryIndex) =>
                            entryIndex === index
                              ? { ...entry, notifyBody: event.target.value }
                              : entry,
                          ),
                        )
                      }
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>System Comment Template</Label>
                  <Input
                    value={rule.comment}
                    placeholder="Automation applied: assigned to manager."
                    onChange={(event) =>
                      setRules((prev) =>
                        prev.map((entry, entryIndex) =>
                          entryIndex === index ? { ...entry, comment: event.target.value } : entry,
                        ),
                      )
                    }
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
