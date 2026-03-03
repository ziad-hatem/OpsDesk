"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Download, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { DataTable } from "../components/DataTable";
import { StatusBadge } from "../components/StatusBadge";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
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
import { Label } from "../components/ui/label";
import { Input } from "../components/ui/input";
import { useAppSelector } from "@/lib/store/hooks";
import { selectTopbarActiveOrganizationId } from "@/lib/store/slices/topbar-slice";
import type {
  SavedView,
  SavedViewsResponse,
  SavedViewScope,
} from "@/lib/saved-views/types";
import type {
  CustomerListItem,
  CustomersListResponse,
  CustomerStatus,
} from "@/lib/customers/types";

type FilterState = {
  status: "all" | CustomerStatus;
  search: string;
  createdFrom: string;
  createdTo: string;
};

type CreateCustomerForm = {
  name: string;
  email: string;
  phone: string;
  status: CustomerStatus;
  externalId: string;
};

const INITIAL_CREATE_FORM: CreateCustomerForm = {
  name: "",
  email: "",
  phone: "",
  status: "active",
  externalId: "",
};

const STATUS_FILTER_OPTIONS: Array<{ value: FilterState["status"]; label: string }> = [
  { value: "all", label: "All Status" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "blocked", label: "Blocked" },
];

const SAVE_SCOPE_OPTIONS: Array<{ value: SavedViewScope; label: string }> = [
  { value: "personal", label: "My View" },
  { value: "team", label: "Team View" },
];

function parseCustomerFiltersFromSavedView(filters: Record<string, unknown>): FilterState {
  const status = typeof filters.status === "string" ? filters.status : "all";
  const search = typeof filters.search === "string" ? filters.search : "";
  const createdFrom = typeof filters.createdFrom === "string" ? filters.createdFrom : "";
  const createdTo = typeof filters.createdTo === "string" ? filters.createdTo : "";

  return {
    status: status as FilterState["status"],
    search,
    createdFrom,
    createdTo,
  };
}

function formatDateTime(isoDate: string) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleDateString();
}

function formatMoney(cents: number, currency = "USD") {
  const normalizedCurrency = currency.trim().toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: normalizedCurrency,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${normalizedCurrency}`;
  }
}

function toCsvSafe(value: string) {
  const escaped = value.replace(/"/g, "\"\"");
  return `"${escaped}"`;
}

function formatSavedViewLabel(view: SavedView) {
  return view.scope === "team" ? `Team - ${view.name}` : view.name;
}

export default function CustomersListPage() {
  const router = useRouter();
  const activeOrgId = useAppSelector(selectTopbarActiveOrganizationId);

  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [selectedViewId, setSelectedViewId] = useState("none");
  const [saveViewScope, setSaveViewScope] = useState<SavedViewScope>("personal");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createForm, setCreateForm] = useState<CreateCustomerForm>(INITIAL_CREATE_FORM);
  const [filters, setFilters] = useState<FilterState>({
    status: "all",
    search: "",
    createdFrom: "",
    createdTo: "",
  });

  const loadCustomers = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.status !== "all") {
        params.set("status", filters.status);
      }
      if (filters.search.trim()) {
        params.set("search", filters.search.trim());
      }
      if (filters.createdFrom) {
        params.set("createdFrom", filters.createdFrom);
      }
      if (filters.createdTo) {
        params.set("createdTo", filters.createdTo);
      }

      const response = await fetch(
        `/api/customers${params.toString() ? `?${params.toString()}` : ""}`,
        {
          method: "GET",
          cache: "no-store",
        },
      );

      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string };
        throw new Error(errorData.error ?? "Failed to load customers");
      }

      const payload = (await response.json()) as CustomersListResponse;
      setCustomers(payload.customers ?? []);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to load customers";
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, [filters.createdFrom, filters.createdTo, filters.search, filters.status]);

  useEffect(() => {
    void loadCustomers();
  }, [activeOrgId, loadCustomers]);

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
        const response = await fetch("/api/saved-views?entityType=customers", {
          method: "GET",
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error("Failed to load saved views");
        }
        const payload = (await response.json()) as SavedViewsResponse;
        if (isMounted) {
          setSavedViews(payload.views ?? []);
        }
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

  const activeCustomersCount = useMemo(
    () => customers.filter((customer) => customer.status === "active").length,
    [customers],
  );
  const totalRevenueAmount = useMemo(
    () => customers.reduce((sum, customer) => sum + customer.total_revenue_amount, 0),
    [customers],
  );

  const columns = useMemo<ColumnDef<CustomerListItem>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <button
            onClick={() => router.push(`/customers/${row.original.id}`)}
            className="font-medium text-foreground hover:underline focus:outline-none focus:ring-2 focus:ring-ring rounded"
          >
            {row.original.name}
          </button>
        ),
      },
      {
        accessorKey: "email",
        header: "Email",
        cell: ({ row }) => (
          <span className="text-foreground">{row.original.email ?? "-"}</span>
        ),
      },
      {
        accessorKey: "phone",
        header: "Phone",
        cell: ({ row }) => (
          <span className="text-foreground">{row.original.phone ?? "-"}</span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: "open_tickets_count",
        header: "Open Tickets",
        cell: ({ row }) => <span className="text-foreground">{row.original.open_tickets_count}</span>,
      },
      {
        accessorKey: "total_tickets_count",
        header: "Total Tickets",
        cell: ({ row }) => <span className="text-foreground">{row.original.total_tickets_count}</span>,
      },
      {
        accessorKey: "total_orders_count",
        header: "Orders",
        cell: ({ row }) => <span className="text-foreground">{row.original.total_orders_count}</span>,
      },
      {
        accessorKey: "total_revenue_amount",
        header: "Revenue",
        cell: ({ row }) => (
          <span className="text-foreground">
            {formatMoney(row.original.total_revenue_amount)}
          </span>
        ),
      },
      {
        accessorKey: "created_at",
        header: "Created",
        cell: ({ row }) => <span className="text-muted-foreground">{formatDateTime(row.original.created_at)}</span>,
      },
    ],
    [router],
  );

  const handleCreateCustomer = async () => {
    const name = createForm.name.trim();
    if (!name) {
      toast.error("Customer name is required");
      return;
    }

    setIsCreating(true);
    const toastId = toast.loading("Creating customer...");
    try {
      const response = await fetch("/api/customers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          email: createForm.email.trim() || null,
          phone: createForm.phone.trim() || null,
          status: createForm.status,
          externalId: createForm.externalId.trim() || null,
        }),
      });

      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string };
        throw new Error(errorData.error ?? "Failed to create customer");
      }

      const payload = (await response.json()) as { customer: CustomerListItem };
      setCustomers((prev) => [payload.customer, ...prev]);
      setCreateForm(INITIAL_CREATE_FORM);
      setIsCreateDialogOpen(false);
      toast.success("Customer created", { id: toastId });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to create customer";
      toast.error(message, { id: toastId });
    } finally {
      setIsCreating(false);
    }
  };

  const handleExportCsv = () => {
    if (!customers.length) {
      toast.error("No customers to export");
      return;
    }

    const header = [
      "id",
      "name",
      "email",
      "phone",
      "status",
      "open_tickets_count",
      "total_tickets_count",
      "total_orders_count",
      "total_revenue_amount",
      "created_at",
    ];
    const rows = customers.map((customer) =>
      [
        customer.id,
        customer.name,
        customer.email ?? "",
        customer.phone ?? "",
        customer.status,
        String(customer.open_tickets_count),
        String(customer.total_tickets_count),
        String(customer.total_orders_count),
        String(customer.total_revenue_amount),
        customer.created_at,
      ]
        .map(toCsvSafe)
        .join(","),
    );

    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const handleApplySavedView = (viewId: string) => {
    setSelectedViewId(viewId);
    if (viewId === "none") {
      return;
    }
    const view = savedViews.find((item) => item.id === viewId);
    if (!view) {
      return;
    }
    setFilters(parseCustomerFiltersFromSavedView(view.filters));
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
          entityType: "customers",
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

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-foreground">Customers</h1>
          <p className="text-muted-foreground mt-1">Manage customers linked to tickets and orders</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="gap-2 focus:ring-2 focus:ring-ring"
            onClick={handleExportCsv}
          >
            <Download className="w-4 h-4" />
            Export CSV
          </Button>
          <Button
            className="gap-2 focus:ring-2 focus:ring-ring"
            onClick={() => setIsCreateDialogOpen(true)}
          >
            <Plus className="w-4 h-4" />
            Add Customer
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
              placeholder="Search name, email, or external ID..."
              className="w-full sm:w-[280px] focus:ring-2 focus:ring-ring"
            />
            <Select
              value={filters.status}
              onValueChange={(value) =>
                setFilters((prev) => ({ ...prev, status: value as FilterState["status"] }))
              }
            >
              <SelectTrigger className="w-[180px] focus:ring-2 focus:ring-ring">
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
            <Input
              type="date"
              value={filters.createdFrom}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, createdFrom: event.target.value }))
              }
              className="w-[180px] focus:ring-2 focus:ring-ring"
            />
            <Input
              type="date"
              value={filters.createdTo}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, createdTo: event.target.value }))
              }
              className="w-[180px] focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="flex items-center gap-2">
            <Select value={selectedViewId} onValueChange={handleApplySavedView}>
              <SelectTrigger className="w-[220px] focus:ring-2 focus:ring-ring">
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
              <SelectTrigger className="w-[140px] focus:ring-2 focus:ring-ring">
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
              Active: {activeCustomersCount}
            </Badge>
            <Badge variant="secondary" className="w-fit text-sm">
              Revenue: {formatMoney(totalRevenueAmount)}
            </Badge>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-border bg-background p-10 text-center text-muted-foreground">
          <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin" />
          Loading customers...
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={customers}
          searchKey="name"
          searchPlaceholder="Search customers..."
        />
      )}

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Customer</DialogTitle>
            <DialogDescription>
              Add a customer that can be linked to tickets.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="customer-name">Name</Label>
              <Input
                id="customer-name"
                value={createForm.name}
                onChange={(event) =>
                  setCreateForm((prev) => ({ ...prev, name: event.target.value }))
                }
                placeholder="Customer name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="customer-email">Email</Label>
              <Input
                id="customer-email"
                value={createForm.email}
                onChange={(event) =>
                  setCreateForm((prev) => ({ ...prev, email: event.target.value }))
                }
                placeholder="contact@customer.com"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="customer-phone">Phone</Label>
              <Input
                id="customer-phone"
                value={createForm.phone}
                onChange={(event) =>
                  setCreateForm((prev) => ({ ...prev, phone: event.target.value }))
                }
                placeholder="+1 555 555 5555"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="customer-external-id">External ID</Label>
              <Input
                id="customer-external-id"
                value={createForm.externalId}
                onChange={(event) =>
                  setCreateForm((prev) => ({ ...prev, externalId: event.target.value }))
                }
                placeholder="crm_123"
              />
            </div>

            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={createForm.status}
                onValueChange={(value) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    status: value as CustomerStatus,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="blocked">Blocked</SelectItem>
                </SelectContent>
              </Select>
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
            <Button onClick={handleCreateCustomer} disabled={isCreating}>
              {isCreating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Customer"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

