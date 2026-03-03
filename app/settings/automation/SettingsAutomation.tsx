"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, ArchiveRestore, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
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
  AutomationEntityType,
  AutomationRule,
  AutomationRulesResponse,
  AutomationTriggerEvent,
} from "@/lib/automation/types";
import { useAppSelector } from "@/lib/store/hooks";
import { selectTopbarActiveOrganizationId } from "@/lib/store/slices/topbar-slice";
import type { OrganizationRole } from "@/lib/topbar/types";
import type { TicketPriority, TicketStatus } from "@/lib/tickets/types";
import type { OrderPaymentStatus, OrderStatus } from "@/lib/orders/types";

type RulePriority = "any" | TicketPriority;
type RuleStatus = "any" | TicketStatus | OrderStatus;
type RulePaymentStatus = "any" | OrderPaymentStatus;
type RuleChangedField = "any" | AutomationChangedField;
type RuleRole = "none" | OrganizationRole;

type EditableRule = {
  id?: string;
  entityType: AutomationEntityType;
  isArchived: boolean;
  name: string;
  description: string;
  triggerEvent: AutomationTriggerEvent;
  isEnabled: boolean;
  priority: RulePriority;
  status: RuleStatus;
  paymentStatus: RulePaymentStatus;
  assigneeState: AutomationAssigneeState;
  changedField: RuleChangedField;
  assignRole: RuleRole;
  notifyRole: RuleRole;
  notifyTitle: string;
  notifyBody: string;
  comment: string;
  setStatus: "none" | TicketStatus | OrderStatus;
  setPriority: "none" | TicketPriority;
  setPaymentStatus: "none" | OrderPaymentStatus;
};

const PRIORITY_OPTIONS: RulePriority[] = ["any", "urgent", "high", "medium", "low"];
const STATUS_OPTIONS: RuleStatus[] = ["any", "open", "pending", "resolved", "closed"];
const CHANGED_FIELD_OPTIONS: RuleChangedField[] = ["any", "status", "priority", "assignee_id"];
const ORDER_STATUS_OPTIONS: RuleStatus[] = [
  "any",
  "draft",
  "pending",
  "paid",
  "fulfilled",
  "cancelled",
  "refunded",
];
const TICKET_CHANGED_FIELD_OPTIONS: RuleChangedField[] = [
  "any",
  "status",
  "priority",
  "assignee_id",
];
const ORDER_CHANGED_FIELD_OPTIONS: RuleChangedField[] = ["any", "status", "payment_status"];
const ORDER_PAYMENT_STATUS_OPTIONS: RulePaymentStatus[] = [
  "any",
  "unpaid",
  "payment_link_sent",
  "paid",
  "failed",
  "refunded",
  "expired",
  "cancelled",
];
const ROLE_OPTIONS: RuleRole[] = ["none", "admin", "manager", "support", "read_only"];
const ACTION_STATUS_OPTIONS: Array<"none" | TicketStatus> = ["none", "open", "pending", "resolved", "closed"];
const ORDER_ACTION_STATUS_OPTIONS: Array<"none" | OrderStatus> = [
  "none",
  "draft",
  "pending",
  "paid",
  "fulfilled",
  "cancelled",
  "refunded",
];
const ACTION_PRIORITY_OPTIONS: Array<"none" | TicketPriority> = [
  "none",
  "urgent",
  "high",
  "medium",
  "low",
];
const ACTION_PAYMENT_STATUS_OPTIONS: Array<"none" | OrderPaymentStatus> = [
  "none",
  "unpaid",
  "payment_link_sent",
  "paid",
  "failed",
  "refunded",
  "expired",
  "cancelled",
];

function toLabel(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function defaultTriggerForEntity(entityType: AutomationEntityType): AutomationTriggerEvent {
  return entityType === "order" ? "order.created" : "ticket.created";
}

function emptyRule(entityType: AutomationEntityType): EditableRule {
  return {
    entityType,
    isArchived: false,
    name: "",
    description: "",
    triggerEvent: defaultTriggerForEntity(entityType),
    isEnabled: true,
    priority: "any",
    status: "any",
    paymentStatus: "any",
    assigneeState: "any",
    changedField: "any",
    assignRole: "none",
    notifyRole: "none",
    notifyTitle: "",
    notifyBody: "",
    comment: "",
    setStatus: "none",
    setPriority: "none",
    setPaymentStatus: "none",
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
  const setPaymentStatusAction = rule.actions.find(
    (action): action is Extract<AutomationAction, { type: "set_payment_status" }> =>
      action.type === "set_payment_status",
  );

  return {
    id: rule.id,
    entityType: rule.entity_type,
    isArchived: Boolean(rule.archived_at),
    name: rule.name,
    description: rule.description ?? "",
    triggerEvent: rule.trigger_event,
    isEnabled: rule.is_enabled,
    priority: rule.conditions.priorities?.[0] ?? "any",
    status: rule.conditions.statuses?.[0] ?? "any",
    paymentStatus: rule.conditions.paymentStatuses?.[0] ?? "any",
    assigneeState: rule.conditions.assigneeState ?? "any",
    changedField: rule.conditions.changedFields?.[0] ?? "any",
    assignRole: assignRoleAction?.role ?? "none",
    notifyRole: notifyRoleAction?.role ?? "none",
    notifyTitle: notifyRoleAction?.title ?? "",
    notifyBody: notifyRoleAction?.body ?? "",
    comment: addCommentAction?.message ?? "",
    setStatus: setStatusAction?.status ?? "none",
    setPriority: setPriorityAction?.priority ?? "none",
    setPaymentStatus: setPaymentStatusAction?.paymentStatus ?? "none",
  };
}

function toApiRule(rule: EditableRule) {
  const conditions: Record<string, unknown> = {};
  if (rule.entityType === "ticket" && rule.priority !== "any") {
    conditions.priorities = [rule.priority];
  }
  if (rule.status !== "any") {
    conditions.statuses = [rule.status];
  }
  if (rule.entityType === "order" && rule.paymentStatus !== "any") {
    conditions.paymentStatuses = [rule.paymentStatus];
  }
  if (rule.entityType === "ticket" && rule.assigneeState !== "any") {
    conditions.assigneeState = rule.assigneeState;
  }
  if (rule.changedField !== "any") {
    conditions.changedFields = [rule.changedField];
  }

  const actions: AutomationAction[] = [];
  if (rule.entityType === "ticket" && rule.assignRole !== "none") {
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
  if (rule.entityType === "ticket" && rule.setPriority !== "none") {
    actions.push({
      type: "set_priority",
      priority: rule.setPriority,
    });
  }
  if (rule.entityType === "order" && rule.setPaymentStatus !== "none") {
    actions.push({
      type: "set_payment_status",
      paymentStatus: rule.setPaymentStatus,
    });
  }

  return {
    id: rule.id,
    entityType: rule.entityType,
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

  const [selectedEntityType, setSelectedEntityType] = useState<AutomationEntityType>("ticket");
  const [showArchived, setShowArchived] = useState(false);
  const [rules, setRules] = useState<EditableRule[]>([]);
  const [deleteTargetRule, setDeleteTargetRule] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [isDeletingRule, setIsDeletingRule] = useState(false);
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
      const response = await fetch(
        `/api/automation/rules?entityType=${selectedEntityType}&includeArchived=${showArchived ? "true" : "false"}`,
        {
        method: "GET",
        cache: "no-store",
        },
      );
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
  }, [activeOrgId, selectedEntityType, showArchived]);

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
          entityType: selectedEntityType,
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

  const handleArchiveToggle = async (ruleId: string, archived: boolean) => {
    const toastId = toast.loading(archived ? "Archiving rule..." : "Restoring rule...");
    try {
      const response = await fetch(`/api/automation/rules/${ruleId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ archived }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      toast.success(archived ? "Rule archived" : "Rule restored", { id: toastId });
      await loadRules();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to update rule archive state";
      toast.error(message, { id: toastId });
    }
  };

  const handleDeleteRule = async () => {
    if (!deleteTargetRule || isDeletingRule) {
      return;
    }

    setIsDeletingRule(true);
    const toastId = toast.loading("Deleting rule...");
    try {
      const response = await fetch(`/api/automation/rules/${deleteTargetRule.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      setRules((prev) => prev.filter((rule) => rule.id !== deleteTargetRule.id));
      setDeleteTargetRule(null);
      toast.success("Rule deleted", { id: toastId });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to delete rule";
      toast.error(message, { id: toastId });
    } finally {
      setIsDeletingRule(false);
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
          <Select
            value={selectedEntityType}
            onValueChange={(value) => {
              setSelectedEntityType(value as AutomationEntityType);
              setRules([]);
            }}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ticket">Ticket Rules</SelectItem>
              <SelectItem value="order">Order Rules</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center rounded-md border border-slate-200 px-3 py-2">
            <Switch
              checked={showArchived}
              onCheckedChange={setShowArchived}
            />
            <span className="ml-2 text-sm text-slate-600">Show archived</span>
          </div>
          <Button
            variant="outline"
            onClick={() => setRules((prev) => [...prev, emptyRule(selectedEntityType)])}
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
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle>Rule {index + 1}</CardTitle>
                    <CardDescription>
                      Define trigger, conditions, and actions for this workflow rule.
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    {rule.id ? (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-1"
                          onClick={() => void handleArchiveToggle(rule.id!, !rule.isArchived)}
                        >
                          {rule.isArchived ? (
                            <>
                              <ArchiveRestore className="h-3.5 w-3.5" />
                              Restore
                            </>
                          ) : (
                            <>
                              <Archive className="h-3.5 w-3.5" />
                              Archive
                            </>
                          )}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-1 text-red-600 hover:text-red-700"
                          onClick={() =>
                            setDeleteTargetRule({
                              id: rule.id!,
                              name: rule.name.trim() || `Rule ${index + 1}`,
                            })
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setRules((prev) => prev.filter((_, rowIndex) => rowIndex !== index))
                        }
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
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
                        {rule.entityType === "ticket" ? (
                          <>
                            <SelectItem value="ticket.created">Ticket Created</SelectItem>
                            <SelectItem value="ticket.updated">Ticket Updated</SelectItem>
                          </>
                        ) : (
                          <>
                            <SelectItem value="order.created">Order Created</SelectItem>
                            <SelectItem value="order.updated">Order Updated</SelectItem>
                          </>
                        )}
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
                        {(rule.entityType === "ticket"
                          ? TICKET_CHANGED_FIELD_OPTIONS
                          : ORDER_CHANGED_FIELD_OPTIONS
                        ).map((option) => (
                          <SelectItem key={option} value={option}>
                            {option === "any" ? "Any field" : toLabel(option)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  {rule.entityType === "ticket" ? (
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
                  ) : (
                    <div className="space-y-2">
                      <Label>Condition: Payment Status</Label>
                      <Select
                        value={rule.paymentStatus}
                        onValueChange={(value) =>
                          setRules((prev) =>
                            prev.map((entry, entryIndex) =>
                              entryIndex === index
                                ? { ...entry, paymentStatus: value as RulePaymentStatus }
                                : entry,
                            ),
                          )
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ORDER_PAYMENT_STATUS_OPTIONS.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option === "any" ? "Any payment status" : toLabel(option)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

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
                        {(rule.entityType === "ticket" ? STATUS_OPTIONS : ORDER_STATUS_OPTIONS).map(
                          (option) => (
                            <SelectItem key={option} value={option}>
                              {option === "any" ? "Any status" : toLabel(option)}
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  {rule.entityType === "ticket" ? (
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
                  ) : (
                    <div className="space-y-2">
                      <Label>Condition: Assignee</Label>
                      <div className="flex h-10 items-center rounded-md border border-slate-200 px-3 text-sm text-slate-500">
                        Not applicable for orders
                      </div>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                  {rule.entityType === "ticket" ? (
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
                  ) : (
                    <div className="space-y-2">
                      <Label>Action: Assign Role</Label>
                      <div className="flex h-10 items-center rounded-md border border-slate-200 px-3 text-sm text-slate-500">
                        Not applicable for orders
                      </div>
                    </div>
                  )}

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
                              ? { ...entry, setStatus: value as "none" | TicketStatus | OrderStatus }
                              : entry,
                          ),
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(rule.entityType === "ticket"
                          ? ACTION_STATUS_OPTIONS
                          : ORDER_ACTION_STATUS_OPTIONS
                        ).map((option) => (
                          <SelectItem key={option} value={option}>
                            {option === "none" ? "No status change" : toLabel(option)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    {rule.entityType === "ticket" ? (
                      <>
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
                      </>
                    ) : (
                      <>
                        <Label>Action: Set Payment</Label>
                        <Select
                          value={rule.setPaymentStatus}
                          onValueChange={(value) =>
                            setRules((prev) =>
                              prev.map((entry, entryIndex) =>
                                entryIndex === index
                                  ? {
                                      ...entry,
                                      setPaymentStatus: value as "none" | OrderPaymentStatus,
                                    }
                                  : entry,
                              ),
                            )
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ACTION_PAYMENT_STATUS_OPTIONS.map((option) => (
                              <SelectItem key={option} value={option}>
                                {option === "none" ? "No payment change" : toLabel(option)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </>
                    )}
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
                      Supports: {"{{title}}"}, {"{{ticketId}}"}, {"{{orderId}}"}, {"{{priority}}"}, {"{{status}}"}, {"{{paymentStatus}}"}, {"{{ruleName}}"}.
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
                  <Label>{rule.entityType === "ticket" ? "System Comment Template" : "Order Note Template"}</Label>
                  <Input
                    value={rule.comment}
                    placeholder={
                      rule.entityType === "ticket"
                        ? "Automation applied: assigned to manager."
                        : "Automation note: manager notified for order review."
                    }
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

      <AlertDialog
        open={Boolean(deleteTargetRule)}
        onOpenChange={(open) => {
          if (!open && !isDeletingRule) {
            setDeleteTargetRule(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete automation rule?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete{" "}
              <span className="font-medium text-slate-900">
                {deleteTargetRule?.name ?? "this rule"}
              </span>
              . This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingRule}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteRule();
              }}
              disabled={isDeletingRule}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {isDeletingRule ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deleting...
                </span>
              ) : (
                "Delete rule"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
