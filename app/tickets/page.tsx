"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Download, Loader2, Plus } from "lucide-react";
import { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { DataTable } from "../components/DataTable";
import { StatusBadge } from "../components/StatusBadge";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Checkbox } from "../components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  createTicket,
  fetchTickets,
  selectTicketsAssignees,
  selectTicketsList,
  selectTicketsListError,
  selectTicketsListStatus,
} from "@/lib/store/slices/tickets-slice";
import { selectTopbarActiveOrganizationId } from "@/lib/store/slices/topbar-slice";
import type { CustomerListItem, CustomersListResponse } from "@/lib/customers/types";
import type {
  SavedView,
  SavedViewsResponse,
  SavedViewScope,
} from "@/lib/saved-views/types";
import type { TicketTag, TicketTagsResponse } from "@/lib/ticket-tags/types";
import type {
  TicketListItem,
  TicketPriority,
  TicketStatus,
  TicketUser,
} from "@/lib/tickets/types";
import type { OrganizationRole } from "@/lib/topbar/types";

type FilterState = {
  status: "all" | TicketStatus;
  priority: "all" | TicketPriority;
  assigneeId: "all" | string;
  assigneeRole: "all" | OrganizationRole;
  customerId: "all" | string;
  tagIds: string[];
  search: string;
  createdFrom: string;
  createdTo: string;
};

type CreateTicketForm = {
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  assigneeId: string;
  customerId: string;
};

const INITIAL_CREATE_FORM: CreateTicketForm = {
  title: "",
  description: "",
  status: "open",
  priority: "medium",
  assigneeId: "unassigned",
  customerId: "none",
};

const STATUS_FILTER_OPTIONS: Array<{ value: FilterState["status"]; label: string }> = [
  { value: "all", label: "All Status" },
  { value: "open", label: "Open" },
  { value: "pending", label: "Pending" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

const PRIORITY_FILTER_OPTIONS: Array<{ value: FilterState["priority"]; label: string }> = [
  { value: "all", label: "All Priority" },
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

const ROLE_FILTER_OPTIONS: Array<{ value: FilterState["assigneeRole"]; label: string }> = [
  { value: "all", label: "All Org Roles" },
  { value: "admin", label: "Admin" },
  { value: "manager", label: "Manager" },
  { value: "support", label: "Support" },
  { value: "read_only", label: "Read-only" },
];

const SAVE_SCOPE_OPTIONS: Array<{ value: SavedViewScope; label: string }> = [
  { value: "personal", label: "My View" },
  { value: "team", label: "Team View" },
];

function formatUserDisplay(user: TicketUser | null) {
  if (!user) {
    return "Unassigned";
  }
  return user.name?.trim() || user.email;
}

function formatSavedViewLabel(view: SavedView) {
  return view.scope === "team" ? `Team - ${view.name}` : view.name;
}

function formatTagFilterLabel(tags: TicketTag[], selectedTagIds: string[]) {
  if (!selectedTagIds.length) {
    return "All Tags";
  }

  if (selectedTagIds.length === 1) {
    const matchedTag = tags.find((tag) => tag.id === selectedTagIds[0]);
    return matchedTag ? matchedTag.name : "1 Tag";
  }

  return `${selectedTagIds.length} Tags`;
}

function formatDateTime(isoDate: string) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString();
}

function toTicketCode(ticketId: string) {
  return `TCK-${ticketId.slice(0, 8).toUpperCase()}`;
}

function toCsvSafe(value: string) {
  const escaped = value.replace(/"/g, "\"\"");
  return `"${escaped}"`;
}

function parseTicketFiltersFromSavedView(filters: Record<string, unknown>): FilterState {
  const status = typeof filters.status === "string" ? filters.status : "all";
  const priority = typeof filters.priority === "string" ? filters.priority : "all";
  const assigneeId = typeof filters.assigneeId === "string" ? filters.assigneeId : "all";
  const assigneeRole =
    typeof filters.assigneeRole === "string" ? filters.assigneeRole : "all";
  const customerId = typeof filters.customerId === "string" ? filters.customerId : "all";
  const tagIds = Array.isArray(filters.tagIds)
    ? filters.tagIds.filter((value): value is string => typeof value === "string")
    : [];
  const search = typeof filters.search === "string" ? filters.search : "";
  const createdFrom = typeof filters.createdFrom === "string" ? filters.createdFrom : "";
  const createdTo = typeof filters.createdTo === "string" ? filters.createdTo : "";

  return {
    status: status as FilterState["status"],
    priority: priority as FilterState["priority"],
    assigneeId,
    assigneeRole: assigneeRole as FilterState["assigneeRole"],
    customerId,
    tagIds,
    search,
    createdFrom,
    createdTo,
  };
}

export default function TicketsListPage() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const tickets = useAppSelector(selectTicketsList);
  const assignees = useAppSelector(selectTicketsAssignees);
  const listStatus = useAppSelector(selectTicketsListStatus);
  const listError = useAppSelector(selectTicketsListError);
  const activeOrgId = useAppSelector(selectTopbarActiveOrganizationId);

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createForm, setCreateForm] = useState<CreateTicketForm>(INITIAL_CREATE_FORM);
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [ticketTags, setTicketTags] = useState<TicketTag[]>([]);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [selectedViewId, setSelectedViewId] = useState<string>("none");
  const [saveViewScope, setSaveViewScope] = useState<SavedViewScope>("personal");
  const [filters, setFilters] = useState<FilterState>({
    status: "all",
    priority: "all",
    assigneeId: "all",
    assigneeRole: "all",
    customerId: "all",
    tagIds: [],
    search: "",
    createdFrom: "",
    createdTo: "",
  });

  useEffect(() => {
    void dispatch(fetchTickets(filters));
  }, [activeOrgId, dispatch, filters]);

  useEffect(() => {
    if (listStatus === "failed" && listError) {
      toast.error(listError);
    }
  }, [listError, listStatus]);

  useEffect(() => {
    let isMounted = true;
    const loadCustomers = async () => {
      try {
        const response = await fetch("/api/customers?limit=500", {
          method: "GET",
          cache: "no-store",
        });

        if (!response.ok) {
          if (isMounted) {
            setCustomers([]);
          }
          return;
        }

        const payload = (await response.json()) as CustomersListResponse;
        if (isMounted) {
          setCustomers(payload.customers ?? []);
        }
      } catch {
        if (isMounted) {
          setCustomers([]);
        }
      }
    };

    if (activeOrgId) {
      void loadCustomers();
    } else {
      setCustomers([]);
    }

    return () => {
      isMounted = false;
    };
  }, [activeOrgId]);

  useEffect(() => {
    const allowedTagIds = new Set(ticketTags.map((tag) => tag.id));
    setFilters((prev) => {
      const nextTagIds = prev.tagIds.filter((tagId) => allowedTagIds.has(tagId));
      if (nextTagIds.length === prev.tagIds.length) {
        return prev;
      }
      return { ...prev, tagIds: nextTagIds };
    });
  }, [ticketTags]);

  useEffect(() => {
    let isMounted = true;

    const loadTicketTags = async () => {
      if (!activeOrgId) {
        if (isMounted) {
          setTicketTags([]);
        }
        return;
      }

      try {
        const response = await fetch("/api/ticket-tags", {
          method: "GET",
          cache: "no-store",
        });

        if (!response.ok) {
          if (isMounted) {
            setTicketTags([]);
          }
          return;
        }

        const payload = (await response.json()) as TicketTagsResponse;
        if (isMounted) {
          setTicketTags(payload.tags ?? []);
        }
      } catch {
        if (isMounted) {
          setTicketTags([]);
        }
      }
    };

    void loadTicketTags();
    return () => {
      isMounted = false;
    };
  }, [activeOrgId]);

  useEffect(() => {
    let isMounted = true;

    const loadSavedViews = async () => {
      if (!activeOrgId) {
        if (isMounted) {
          setSavedViews([]);
          setSelectedViewId("none");
        }
        return;
      }

      try {
        const response = await fetch("/api/saved-views?entityType=tickets", {
          method: "GET",
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error("Failed to load saved views");
        }
        const payload = (await response.json()) as SavedViewsResponse;
        if (!isMounted) {
          return;
        }
        setSavedViews(payload.views ?? []);
      } catch {
        if (isMounted) {
          setSavedViews([]);
          setSelectedViewId("none");
        }
      }
    };

    void loadSavedViews();
    return () => {
      isMounted = false;
    };
  }, [activeOrgId]);

  const isLoading = listStatus === "loading" && tickets.length === 0;
  const openCount = useMemo(
    () => tickets.filter((ticket) => ticket.status === "open").length,
    [tickets],
  );

  const columns = useMemo<ColumnDef<TicketListItem>[]>(
    () => [
      {
        accessorKey: "id",
        header: "Ticket",
        cell: ({ row }) => (
          <button
            onClick={() => router.push(`/tickets/${row.original.id}`)}
            className="font-medium text-slate-900 hover:underline focus:outline-none focus:ring-2 focus:ring-slate-900 rounded"
          >
            {toTicketCode(row.original.id)}
          </button>
        ),
      },
      {
        accessorKey: "title",
        header: "Title",
        cell: ({ row }) => (
          <div className="max-w-[460px]">
            <p className="font-medium text-slate-900">{row.original.title}</p>
            {row.original.description && (
              <p className="text-xs text-slate-500 truncate">{row.original.description}</p>
            )}
          </div>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: "priority",
        header: "Priority",
        cell: ({ row }) => <StatusBadge status={row.original.priority} />,
      },
      {
        accessorKey: "customer",
        header: "Customer",
        cell: ({ row }) =>
          row.original.customer ? (
            <button
              onClick={() => router.push(`/customers/${row.original.customer?.id}`)}
              className="text-slate-700 hover:underline focus:outline-none focus:ring-2 focus:ring-slate-900 rounded"
            >
              {row.original.customer.name}
            </button>
          ) : (
            <span className="text-slate-400">-</span>
          ),
      },
      {
        accessorKey: "assignee",
        header: "Assignee",
        cell: ({ row }) => (
          <span className="text-slate-700">{formatUserDisplay(row.original.assignee)}</span>
        ),
      },
      {
        accessorKey: "creator",
        header: "Created By",
        cell: ({ row }) => (
          <span className="text-slate-700">{formatUserDisplay(row.original.creator)}</span>
        ),
      },
      {
        accessorKey: "created_at",
        header: "Created",
        cell: ({ row }) => (
          <span className="text-slate-600">{formatDateTime(row.original.created_at)}</span>
        ),
      },
    ],
    [router],
  );

  const handleExportCsv = () => {
    if (!tickets.length) {
      toast.error("No tickets to export");
      return;
    }

    const header = [
      "id",
      "title",
      "status",
      "priority",
      "assignee",
      "created_by",
      "created_at",
    ];
    const rows = tickets.map((ticket) =>
      [
        ticket.id,
        ticket.title,
        ticket.status,
        ticket.priority,
        formatUserDisplay(ticket.assignee),
        formatUserDisplay(ticket.creator),
        ticket.created_at,
      ]
        .map(toCsvSafe)
        .join(","),
    );

    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `tickets-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const handleApplySavedView = (value: string) => {
    setSelectedViewId(value);
    if (value === "none") {
      return;
    }
    const view = savedViews.find((item) => item.id === value);
    if (!view) {
      return;
    }
    setFilters(parseTicketFiltersFromSavedView(view.filters));
  };

  const handleToggleTag = (tagId: string) => {
    setFilters((prev) => {
      const hasTag = prev.tagIds.includes(tagId);
      const tagIds = hasTag
        ? prev.tagIds.filter((id) => id !== tagId)
        : [...prev.tagIds, tagId];
      return { ...prev, tagIds };
    });
  };

  const handleSaveCurrentView = async () => {
    const name = window.prompt("Saved view name");
    if (!name?.trim()) {
      return;
    }

    try {
      const response = await fetch("/api/saved-views", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          entityType: "tickets",
          name: name.trim(),
          filters,
          scope: saveViewScope,
        }),
      });
      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string };
        throw new Error(errorData.error ?? "Failed to save view");
      }
      const payload = (await response.json()) as { view: SavedView };
      setSavedViews((prev) => [payload.view, ...prev]);
      setSelectedViewId(payload.view.id);
      toast.success("View saved");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to save view";
      toast.error(message);
    }
  };

  const handleDeleteSavedView = async () => {
    if (selectedViewId === "none") {
      toast.error("Select a saved view first");
      return;
    }

    try {
      const response = await fetch(`/api/saved-views/${selectedViewId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string };
        throw new Error(errorData.error ?? "Failed to delete view");
      }
      setSavedViews((prev) => prev.filter((view) => view.id !== selectedViewId));
      setSelectedViewId("none");
      toast.success("View deleted");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to delete view";
      toast.error(message);
    }
  };

  const handleCreateTicket = async () => {
    const title = createForm.title.trim();
    if (!title) {
      toast.error("Ticket title is required");
      return;
    }

    setIsCreating(true);
    const toastId = toast.loading("Creating ticket...");
    try {
      const ticket = await dispatch(
        createTicket({
          title,
          description: createForm.description.trim() || null,
          status: createForm.status,
          priority: createForm.priority,
          assigneeId:
            createForm.assigneeId === "unassigned" ? null : createForm.assigneeId,
          customerId: createForm.customerId === "none" ? null : createForm.customerId,
        }),
      ).unwrap();

      setIsCreateDialogOpen(false);
      setCreateForm(INITIAL_CREATE_FORM);
      toast.success("Ticket created", { id: toastId });
      router.push(`/tickets/${ticket.id}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to create ticket";
      toast.error(message, { id: toastId });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900">Tickets</h1>
          <p className="text-slate-600 mt-1">Manage support tickets for your active organization</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="gap-2 focus:ring-2 focus:ring-slate-900"
            onClick={handleExportCsv}
          >
            <Download className="w-4 h-4" />
            Export CSV
          </Button>
          <Button
            className="gap-2 focus:ring-2 focus:ring-slate-900"
            onClick={() => setIsCreateDialogOpen(true)}
          >
            <Plus className="w-4 h-4" />
            New Ticket
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <Input
              value={filters.search}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, search: event.target.value }))
              }
              placeholder="Search title or description..."
              className="w-full sm:w-[260px] focus:ring-2 focus:ring-slate-900"
            />
            <Select
              value={filters.status}
              onValueChange={(value) =>
                setFilters((prev) => ({
                  ...prev,
                  status: value as FilterState["status"],
                }))
              }
            >
              <SelectTrigger className="w-[180px] focus:ring-2 focus:ring-slate-900">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTER_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filters.priority}
              onValueChange={(value) =>
                setFilters((prev) => ({
                  ...prev,
                  priority: value as FilterState["priority"],
                }))
              }
            >
              <SelectTrigger className="w-[180px] focus:ring-2 focus:ring-slate-900">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                {PRIORITY_FILTER_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filters.assigneeId}
              onValueChange={(value) =>
                setFilters((prev) => ({
                  ...prev,
                  assigneeId: value,
                }))
              }
            >
              <SelectTrigger className="w-[220px] focus:ring-2 focus:ring-slate-900">
                <SelectValue placeholder="Assignee" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Assignees</SelectItem>
                {assignees.map((assignee) => (
                  <SelectItem key={assignee.id} value={assignee.id}>
                    {formatUserDisplay(assignee)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filters.assigneeRole}
              onValueChange={(value) =>
                setFilters((prev) => ({
                  ...prev,
                  assigneeRole: value as FilterState["assigneeRole"],
                }))
              }
            >
              <SelectTrigger className="w-[200px] focus:ring-2 focus:ring-slate-900">
                <SelectValue placeholder="Org Role" />
              </SelectTrigger>
              <SelectContent>
                {ROLE_FILTER_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filters.customerId}
              onValueChange={(value) =>
                setFilters((prev) => ({
                  ...prev,
                  customerId: value,
                }))
              }
            >
              <SelectTrigger className="w-[220px] focus:ring-2 focus:ring-slate-900">
                <SelectValue placeholder="Customer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Customers</SelectItem>
                {customers.map((customer) => (
                  <SelectItem key={customer.id} value={customer.id}>
                    {customer.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="w-[220px] justify-between focus:ring-2 focus:ring-slate-900"
                >
                  <span className="truncate">
                    {formatTagFilterLabel(ticketTags, filters.tagIds)}
                  </span>
                  <ChevronDown className="h-4 w-4 text-slate-500" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[280px] p-0">
                <div className="border-b border-slate-200 px-3 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                  Filter by tags
                </div>
                {ticketTags.length === 0 ? (
                  <div className="px-3 py-3 text-sm text-slate-500">No tags created yet</div>
                ) : (
                  <div className="max-h-56 space-y-1 overflow-y-auto px-3 py-2">
                    {ticketTags.map((tag) => {
                      const checked = filters.tagIds.includes(tag.id);
                      return (
                        <label
                          key={tag.id}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => handleToggleTag(tag.id)}
                          />
                          <span className="truncate">{tag.name}</span>
                          {tag.color ? (
                            <span
                              className="ml-auto inline-block h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: tag.color }}
                            />
                          ) : null}
                          {checked ? <Check className="h-3.5 w-3.5 text-slate-500" /> : null}
                        </label>
                      );
                    })}
                  </div>
                )}
                {filters.tagIds.length > 0 ? (
                  <div className="border-t border-slate-200 p-2">
                    <Button
                      variant="ghost"
                      className="h-8 w-full justify-center text-xs"
                      onClick={() =>
                        setFilters((prev) => ({
                          ...prev,
                          tagIds: [],
                        }))
                      }
                    >
                      Clear tag filters
                    </Button>
                  </div>
                ) : null}
              </PopoverContent>
            </Popover>

            <Input
              type="date"
              value={filters.createdFrom}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, createdFrom: event.target.value }))
              }
              className="w-[180px] focus:ring-2 focus:ring-slate-900"
            />
            <Input
              type="date"
              value={filters.createdTo}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, createdTo: event.target.value }))
              }
              className="w-[180px] focus:ring-2 focus:ring-slate-900"
            />
          </div>

          <div className="flex items-center gap-2">
            <Select value={selectedViewId} onValueChange={handleApplySavedView}>
              <SelectTrigger className="w-[220px] focus:ring-2 focus:ring-slate-900">
                <SelectValue placeholder="Saved view" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No saved view</SelectItem>
                {savedViews.map((view) => (
                  <SelectItem key={view.id} value={view.id}>
                    {formatSavedViewLabel(view)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={saveViewScope}
              onValueChange={(value) => setSaveViewScope(value as SavedViewScope)}
            >
              <SelectTrigger className="w-[140px] focus:ring-2 focus:ring-slate-900">
                <SelectValue placeholder="Scope" />
              </SelectTrigger>
              <SelectContent>
                {SAVE_SCOPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={handleSaveCurrentView}>
              Save View
            </Button>
            <Button variant="outline" onClick={handleDeleteSavedView}>
              Delete View
            </Button>
            <Badge variant="secondary" className="w-fit text-sm">
              Open: {openCount}
            </Badge>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-slate-500">
          <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin" />
          Loading tickets...
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={tickets}
          searchKey="title"
          searchPlaceholder="Search ticket title..."
        />
      )}

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Ticket</DialogTitle>
            <DialogDescription>
              Add a new support ticket in the current organization.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ticket-title">Title</Label>
              <Input
                id="ticket-title"
                value={createForm.title}
                onChange={(event) =>
                  setCreateForm((prev) => ({ ...prev, title: event.target.value }))
                }
                placeholder="Short summary of the issue"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ticket-description">Description</Label>
              <Textarea
                id="ticket-description"
                value={createForm.description}
                onChange={(event) =>
                  setCreateForm((prev) => ({ ...prev, description: event.target.value }))
                }
                placeholder="Provide details for the support team"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={createForm.status}
                  onValueChange={(value) =>
                    setCreateForm((prev) => ({
                      ...prev,
                      status: value as TicketStatus,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Priority</Label>
                <Select
                  value={createForm.priority}
                  onValueChange={(value) =>
                    setCreateForm((prev) => ({
                      ...prev,
                      priority: value as TicketPriority,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Assignee</Label>
                <Select
                  value={createForm.assigneeId}
                  onValueChange={(value) =>
                    setCreateForm((prev) => ({
                      ...prev,
                      assigneeId: value,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {assignees.map((assignee) => (
                      <SelectItem key={assignee.id} value={assignee.id}>
                        {formatUserDisplay(assignee)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Customer</Label>
                <Select
                  value={createForm.customerId}
                  onValueChange={(value) =>
                    setCreateForm((prev) => ({
                      ...prev,
                      customerId: value,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No customer</SelectItem>
                    {customers.map((customer) => (
                      <SelectItem key={customer.id} value={customer.id}>
                        {customer.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsCreateDialogOpen(false)}
              disabled={isCreating}
            >
              Cancel
            </Button>
            <Button onClick={handleCreateTicket} disabled={isCreating}>
              {isCreating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Ticket"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
