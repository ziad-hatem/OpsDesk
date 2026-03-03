"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/app/components/ui/card";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/app/components/ui/table";
import { useAppSelector } from "@/lib/store/hooks";
import { selectTopbarActiveOrganizationId } from "@/lib/store/slices/topbar-slice";
import { toAuditEntityLabel } from "@/lib/audit/format";
import type { AuditLogItem, AuditLogsResponse } from "@/lib/audit/types";
import SettingsNav from "../SettingsNav";

type AuditLogsApiPayload = AuditLogsResponse & {
  error?: string;
};

const PAGE_LIMIT_OPTIONS = [25, 50, 100];

function formatDateTime(isoDate: string): string {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }
  return parsed.toLocaleString();
}

function shortenId(value: string | null, size = 8): string {
  if (!value) {
    return "-";
  }
  return value.length > size ? value.slice(0, size) : value;
}

function summarizeDetails(details: Record<string, unknown> | null): string {
  if (!details) {
    return "-";
  }

  const parts: string[] = [];
  for (const [key, value] of Object.entries(details)) {
    if (value === null || typeof value === "undefined") {
      continue;
    }

    const normalizedKey = key
      .replace(/[_:.]+/g, " ")
      .split(" ")
      .filter(Boolean)
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(" ");
    const normalizedValue =
      typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : JSON.stringify(value);

    parts.push(`${normalizedKey}: ${normalizedValue}`);
  }

  if (!parts.length) {
    return "-";
  }

  return parts.join(" • ");
}

function actorLabel(item: AuditLogItem): string {
  const actorName = item.actor?.name?.trim();
  const actorEmail = item.actor?.email?.trim();
  if (actorName) {
    return actorName;
  }
  if (actorEmail) {
    return actorEmail;
  }
  if (item.actor_user_id) {
    return `User ${shortenId(item.actor_user_id)}`;
  }
  return "System";
}

function buildEntityLabel(item: AuditLogItem): string {
  const entityTypeLabel = toAuditEntityLabel(item.entity_type);
  if (!item.entity_id) {
    return entityTypeLabel;
  }
  return `${entityTypeLabel} #${shortenId(item.entity_id)}`;
}

async function readApiError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload.error) {
      return payload.error;
    }
  } catch {
    // ignore parsing failure
  }
  return response.statusText || `Request failed with status ${response.status}`;
}

export default function SettingsActivity() {
  const activeOrgId = useAppSelector(selectTopbarActiveOrganizationId);
  const [items, setItems] = useState<AuditLogItem[]>([]);
  const [availableActions, setAvailableActions] = useState<string[]>([]);
  const [availableActors, setAvailableActors] = useState<AuditLogsResponse["availableActors"]>(
    [],
  );
  const [isLoading, setIsLoading] = useState(false);
  const [actionFilter, setActionFilter] = useState("all");
  const [actorFilter, setActorFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [total, setTotal] = useState(0);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const fetchAuditLogs = useCallback(async () => {
    if (!activeOrgId) {
      setItems([]);
      setAvailableActions([]);
      setAvailableActors([]);
      setTotal(0);
      return;
    }

    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", String(limit));
      if (actionFilter !== "all") {
        params.set("action", actionFilter);
      }
      if (actorFilter !== "all") {
        params.set("actorUserId", actorFilter);
      }
      if (fromDate) {
        params.set("from", fromDate);
      }
      if (toDate) {
        params.set("to", toDate);
      }

      const response = await fetch(`/api/orgs/${activeOrgId}/audit-logs?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const payload = (await response.json()) as AuditLogsApiPayload;
      setItems(payload.items ?? []);
      setAvailableActions(payload.availableActions ?? []);
      setAvailableActors(payload.availableActors ?? []);
      setTotal(payload.total ?? 0);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to load activity logs";
      toast.error(message);
      setItems([]);
      setTotal(0);
    } finally {
      setIsLoading(false);
    }
  }, [activeOrgId, actionFilter, actorFilter, fromDate, toDate, page, limit]);

  useEffect(() => {
    void fetchAuditLogs();
  }, [fetchAuditLogs]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  useEffect(() => {
    if (actionFilter !== "all" && !availableActions.includes(actionFilter)) {
      setActionFilter("all");
    }
  }, [actionFilter, availableActions]);

  useEffect(() => {
    if (
      actorFilter !== "all" &&
      !availableActors.some((actor) => actor.id === actorFilter)
    ) {
      setActorFilter("all");
    }
  }, [actorFilter, availableActors]);

  const tableRows = useMemo(
    () =>
      items.map((item) => ({
        ...item,
        actorLabel: actorLabel(item),
        entityLabel: buildEntityLabel(item),
        detailsLabel: summarizeDetails(item.details),
      })),
    [items],
  );

  if (!activeOrgId) {
    return (
      <div className="space-y-4 p-6">
        <SettingsNav />
        <Card>
          <CardContent className="p-6 text-slate-600">
            Select or create an organization to view activity logs.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <SettingsNav />

      <div className="space-y-1">
        <h1 className="text-3xl font-semibold text-slate-900">Activity Timeline</h1>
        <p className="text-slate-600">
          Review security and operational events for this organization.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-900">Action</p>
              <Select
                value={actionFilter}
                onValueChange={(value) => {
                  setActionFilter(value);
                  setPage(1);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All actions</SelectItem>
                  {availableActions.map((action) => (
                    <SelectItem key={action} value={action}>
                      {action}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-900">Actor</p>
              <Select
                value={actorFilter}
                onValueChange={(value) => {
                  setActorFilter(value);
                  setPage(1);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All actors</SelectItem>
                  {availableActors.map((actor) => (
                    <SelectItem key={actor.id} value={actor.id}>
                      {actor.name ?? actor.email ?? actor.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-900">From</p>
              <Input
                type="date"
                value={fromDate}
                onChange={(event) => {
                  setFromDate(event.target.value);
                  setPage(1);
                }}
              />
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-900">To</p>
              <Input
                type="date"
                value={toDate}
                onChange={(event) => {
                  setToDate(event.target.value);
                  setPage(1);
                }}
              />
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-900">Rows</p>
              <Select
                value={String(limit)}
                onValueChange={(value) => {
                  setLimit(Number(value));
                  setPage(1);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_LIMIT_OPTIONS.map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-slate-500">
              Showing {tableRows.length} of {total} events
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setActionFilter("all");
                  setActorFilter("all");
                  setFromDate("");
                  setToDate("");
                  setPage(1);
                }}
              >
                Reset
              </Button>
              <Button variant="outline" onClick={() => void fetchAuditLogs()}>
                <RefreshCcw className="mr-2 h-4 w-4" />
                Refresh
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Activity Events</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-slate-500">
              <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin" />
              Loading activity...
            </div>
          ) : tableRows.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-slate-500">
              No activity found for the selected filters.
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[210px]">Time</TableHead>
                    <TableHead className="w-[220px]">Action</TableHead>
                    <TableHead className="w-[220px]">Actor</TableHead>
                    <TableHead className="w-[210px]">Entity</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tableRows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="text-xs text-slate-600">
                        {formatDateTime(row.created_at)}
                      </TableCell>
                      <TableCell className="text-sm font-medium text-slate-900">
                        {row.action_label}
                      </TableCell>
                      <TableCell className="text-sm text-slate-700">{row.actorLabel}</TableCell>
                      <TableCell className="text-xs text-slate-600">
                        {row.entityLabel}
                      </TableCell>
                      <TableCell className="text-sm text-slate-700">
                        <span className="break-all">{row.detailsLabel}</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-slate-500">
              Page {page} of {totalPages}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || isLoading}
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages || isLoading}
                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
