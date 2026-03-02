"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Download, Loader2 } from "lucide-react";
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
  TicketListItem,
  TicketPriority,
  TicketStatus,
  TicketUser,
} from "@/lib/tickets/types";

type FilterState = {
  status: "all" | TicketStatus;
  priority: "all" | TicketPriority;
  assigneeId: "all" | string;
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

function formatUserDisplay(user: TicketUser | null) {
  if (!user) {
    return "Unassigned";
  }
  return user.name?.trim() || user.email;
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
  const [filters, setFilters] = useState<FilterState>({
    status: "all",
    priority: "all",
    assigneeId: "all",
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

      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
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
        </div>

        <Badge variant="secondary" className="w-fit text-sm">
          Open: {openCount}
        </Badge>
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
