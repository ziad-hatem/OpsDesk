"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import { Download, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { DataTable } from "../components/DataTable";
import { StatusBadge } from "../components/StatusBadge";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Textarea } from "../components/ui/textarea";
import { useAppSelector } from "@/lib/store/hooks";
import { selectTopbarActiveOrganizationId } from "@/lib/store/slices/topbar-slice";
import type { CustomerListItem, CustomersListResponse } from "@/lib/customers/types";
import type {
  OrderDetailResponse,
  OrderListItem,
  OrderPaymentStatus,
  OrdersListResponse,
  OrderStatus,
} from "@/lib/orders/types";
import type { SavedView, SavedViewsResponse } from "@/lib/saved-views/types";

type FilterState = {
  status: "all" | OrderStatus;
  paymentStatus: "all" | OrderPaymentStatus;
  customerId: "all" | string;
  search: string;
  createdFrom: string;
  createdTo: string;
};

type CreateOrderForm = {
  customerId: string;
  orderNumber: string;
  status: OrderStatus;
  currency: string;
  subtotalAmount: string;
  taxAmount: string;
  discountAmount: string;
  notes: string;
};

type CreateOrderLineItemForm = {
  id: string;
  name: string;
  quantity: string;
  unitPrice: string;
};

const INITIAL_CREATE_FORM: CreateOrderForm = {
  customerId: "none",
  orderNumber: "",
  status: "draft",
  currency: "USD",
  subtotalAmount: "",
  taxAmount: "0",
  discountAmount: "0",
  notes: "",
};

function createEmptyLineItem(): CreateOrderLineItemForm {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: "",
    quantity: "1",
    unitPrice: "",
  };
}

const ORDER_STATUS_OPTIONS: Array<{ value: OrderStatus; label: string }> = [
  { value: "draft", label: "Draft" },
  { value: "pending", label: "Pending" },
  { value: "paid", label: "Paid" },
  { value: "fulfilled", label: "Fulfilled" },
  { value: "cancelled", label: "Cancelled" },
  { value: "refunded", label: "Refunded" },
];

const PAYMENT_STATUS_OPTIONS: Array<{ value: OrderPaymentStatus; label: string }> = [
  { value: "unpaid", label: "Unpaid" },
  { value: "payment_link_sent", label: "Link Sent" },
  { value: "paid", label: "Paid" },
  { value: "failed", label: "Failed" },
  { value: "expired", label: "Expired" },
  { value: "refunded", label: "Refunded" },
  { value: "cancelled", label: "Cancelled" },
];

function formatDateTime(isoDate: string | null) {
  if (!isoDate) {
    return "-";
  }
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString();
}

function formatMoney(cents: number, currency: string) {
  const normalizedCurrency = (currency || "USD").trim().toUpperCase();
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

function normalizeAmountInput(value: string): number | null {
  if (!value.trim()) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function parseAmountToCents(value: string): number | null {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.round(parsed * 100);
}

function canIncludeInCurrentFilter(order: OrderListItem, filters: FilterState) {
  if (filters.status !== "all" && order.status !== filters.status) {
    return false;
  }
  if (filters.paymentStatus !== "all" && order.payment_status !== filters.paymentStatus) {
    return false;
  }
  if (filters.customerId !== "all" && order.customer_id !== filters.customerId) {
    return false;
  }
  return true;
}

function parseOrderFiltersFromSavedView(filters: Record<string, unknown>): FilterState {
  const status = typeof filters.status === "string" ? filters.status : "all";
  const paymentStatus =
    typeof filters.paymentStatus === "string" ? filters.paymentStatus : "all";
  const customerId = typeof filters.customerId === "string" ? filters.customerId : "all";
  const search = typeof filters.search === "string" ? filters.search : "";
  const createdFrom = typeof filters.createdFrom === "string" ? filters.createdFrom : "";
  const createdTo = typeof filters.createdTo === "string" ? filters.createdTo : "";

  return {
    status: status as FilterState["status"],
    paymentStatus: paymentStatus as FilterState["paymentStatus"],
    customerId,
    search,
    createdFrom,
    createdTo,
  };
}

export default function OrdersListPage() {
  const router = useRouter();
  const activeOrgId = useAppSelector(selectTopbarActiveOrganizationId);

  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [selectedViewId, setSelectedViewId] = useState("none");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [statusUpdatingOrderId, setStatusUpdatingOrderId] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState<CreateOrderForm>(INITIAL_CREATE_FORM);
  const [createLineItems, setCreateLineItems] = useState<CreateOrderLineItemForm[]>([
    createEmptyLineItem(),
  ]);
  const [filters, setFilters] = useState<FilterState>({
    status: "all",
    paymentStatus: "all",
    customerId: "all",
    search: "",
    createdFrom: "",
    createdTo: "",
  });

  const loadOrders = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.status !== "all") {
        params.set("status", filters.status);
      }
      if (filters.paymentStatus !== "all") {
        params.set("paymentStatus", filters.paymentStatus);
      }
      if (filters.customerId !== "all") {
        params.set("customerId", filters.customerId);
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
      params.set("limit", "500");

      const response = await fetch(`/api/orders?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string };
        throw new Error(errorData.error ?? "Failed to load orders");
      }

      const payload = (await response.json()) as OrdersListResponse;
      setOrders(payload.orders ?? []);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to load orders";
      toast.error(message);
      setOrders([]);
    } finally {
      setIsLoading(false);
    }
  }, [
    filters.createdFrom,
    filters.createdTo,
    filters.customerId,
    filters.paymentStatus,
    filters.search,
    filters.status,
  ]);

  const loadCustomers = useCallback(async () => {
    try {
      const response = await fetch("/api/customers?limit=500", {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string };
        throw new Error(errorData.error ?? "Failed to load customers");
      }

      const payload = (await response.json()) as CustomersListResponse;
      setCustomers(payload.customers ?? []);
    } catch {
      setCustomers([]);
    }
  }, []);

  useEffect(() => {
    if (!activeOrgId) {
      setOrders([]);
      setCustomers([]);
      setIsLoading(false);
      return;
    }

    void Promise.all([loadOrders(), loadCustomers()]);
  }, [activeOrgId, loadCustomers, loadOrders]);

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
        const response = await fetch("/api/saved-views?entityType=orders", {
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

  const paidOrdersCount = useMemo(
    () => orders.filter((order) => order.payment_status === "paid").length,
    [orders],
  );

  const handleUpdateStatus = useCallback(async (orderId: string, status: OrderStatus) => {
    const previousOrder = orders.find((order) => order.id === orderId);
    if (!previousOrder || previousOrder.status === status) {
      return;
    }

    setStatusUpdatingOrderId(orderId);
    setOrders((prev) =>
      prev.map((order) =>
        order.id === orderId
          ? {
              ...order,
              status,
            }
          : order,
      ),
    );

    try {
      const response = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status }),
      });

      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string };
        throw new Error(errorData.error ?? "Failed to update order status");
      }

      const payload = (await response.json()) as OrderDetailResponse;
      if (payload.order) {
        setOrders((prev) =>
          prev.map((order) => (order.id === orderId ? payload.order : order)),
        );
      }

      toast.success("Order status updated");
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to update order status";
      toast.error(message);
      setOrders((prev) =>
        prev.map((order) => (order.id === orderId ? previousOrder : order)),
      );
    } finally {
      setStatusUpdatingOrderId(null);
    }
  }, [orders]);

  const columns = useMemo<ColumnDef<OrderListItem>[]>(
    () => [
      {
        accessorKey: "order_number",
        header: "Order #",
        cell: ({ row }) => (
          <button
            onClick={() => router.push(`/orders/${row.original.id}`)}
            className="font-medium text-slate-900 hover:underline focus:outline-none focus:ring-2 focus:ring-slate-900 rounded"
          >
            {row.original.order_number}
          </button>
        ),
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
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <Select
            value={row.original.status}
            onValueChange={(value) =>
              void handleUpdateStatus(row.original.id, value as OrderStatus)
            }
            disabled={statusUpdatingOrderId === row.original.id}
          >
            <SelectTrigger className="h-8 w-[150px]">
              <div className="flex items-center">
                <StatusBadge status={row.original.status} />
              </div>
            </SelectTrigger>
            <SelectContent>
              {ORDER_STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ),
      },
      {
        accessorKey: "payment_status",
        header: "Payment",
        cell: ({ row }) => <StatusBadge status={row.original.payment_status} />,
      },
      {
        accessorKey: "total_amount",
        header: "Total",
        cell: ({ row }) => (
          <span className="font-medium text-slate-900">
            {formatMoney(row.original.total_amount, row.original.currency)}
          </span>
        ),
      },
      {
        accessorKey: "currency",
        header: "Currency",
        cell: ({ row }) => <span className="text-slate-700">{row.original.currency}</span>,
      },
      {
        accessorKey: "created_at",
        header: "Created",
        cell: ({ row }) => (
          <span className="text-slate-600">{formatDateTime(row.original.created_at)}</span>
        ),
      },
    ],
    [handleUpdateStatus, router, statusUpdatingOrderId],
  );

  const handleCreateOrder = async () => {
    if (createForm.customerId === "none") {
      toast.error("Customer is required");
      return;
    }

    const parsedLineItems = createLineItems
      .map((item) => ({
        ...item,
        name: item.name.trim(),
      }))
      .filter(
        (item) =>
          item.name.length > 0 ||
          item.quantity.trim().length > 0 ||
          item.unitPrice.trim().length > 0,
      );

    const itemsPayload: Array<{
      name: string;
      quantity: number;
      unitPriceAmount: number;
      totalAmount: number;
    }> = [];
    for (const item of parsedLineItems) {
      if (!item.name) {
        toast.error("Each line item must have a product name");
        return;
      }
      const quantity = Number.parseInt(item.quantity, 10);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        toast.error(`Line item "${item.name}" has invalid quantity`);
        return;
      }
      const unitPriceAmount = parseAmountToCents(item.unitPrice);
      if (unitPriceAmount === null) {
        toast.error(`Line item "${item.name}" has invalid unit price`);
        return;
      }
      itemsPayload.push({
        name: item.name,
        quantity,
        unitPriceAmount,
        totalAmount: quantity * unitPriceAmount,
      });
    }

    const manualSubtotalAmount = normalizeAmountInput(createForm.subtotalAmount);
    const subtotalAmount =
      itemsPayload.length > 0
        ? itemsPayload.reduce((sum, item) => sum + item.totalAmount, 0)
        : manualSubtotalAmount;
    const taxAmount = normalizeAmountInput(createForm.taxAmount);
    const discountAmount = normalizeAmountInput(createForm.discountAmount);

    if (
      subtotalAmount === null ||
      taxAmount === null ||
      discountAmount === null
    ) {
      toast.error("Amounts must be non-negative integers in cents");
      return;
    }

    const totalAmount = subtotalAmount + taxAmount - discountAmount;
    if (totalAmount < 0) {
      toast.error("Total amount cannot be negative");
      return;
    }

    setIsCreating(true);
    const toastId = toast.loading("Creating order...");
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customerId: createForm.customerId,
          orderNumber: createForm.orderNumber.trim() || null,
          status: createForm.status,
          currency: createForm.currency.trim().toUpperCase(),
          subtotalAmount,
          taxAmount,
          discountAmount,
          totalAmount,
          notes: createForm.notes.trim() || null,
          items: itemsPayload,
        }),
      });

      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string };
        throw new Error(errorData.error ?? "Failed to create order");
      }

      const payload = (await response.json()) as { order: OrderListItem };
      if (canIncludeInCurrentFilter(payload.order, filters)) {
        setOrders((prev) => [payload.order, ...prev]);
      }
      setCreateForm(INITIAL_CREATE_FORM);
      setCreateLineItems([createEmptyLineItem()]);
      setIsCreateDialogOpen(false);
      toast.success("Order created", { id: toastId });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to create order";
      toast.error(message, { id: toastId });
    } finally {
      setIsCreating(false);
    }
  };

  const handleExportCsv = () => {
    if (!orders.length) {
      toast.error("No orders to export");
      return;
    }

    const header = [
      "id",
      "order_number",
      "customer_name",
      "status",
      "payment_status",
      "currency",
      "subtotal_amount",
      "tax_amount",
      "discount_amount",
      "total_amount",
      "created_at",
    ];
    const rows = orders.map((order) =>
      [
        order.id,
        order.order_number,
        order.customer?.name ?? "",
        order.status,
        order.payment_status,
        order.currency,
        String(order.subtotal_amount),
        String(order.tax_amount),
        String(order.discount_amount),
        String(order.total_amount),
        order.created_at,
      ]
        .map(toCsvSafe)
        .join(","),
    );

    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
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
    setFilters(parseOrderFiltersFromSavedView(view.filters));
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
          entityType: "orders",
          name: name.trim(),
          filters,
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
          <h1 className="text-3xl font-semibold text-slate-900">Orders</h1>
          <p className="text-slate-600 mt-1">Track and manage customer orders</p>
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
            New Order
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <Input
              value={filters.search}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, search: event.target.value }))
              }
              placeholder="Search order number or notes..."
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
                <SelectItem value="all">All Status</SelectItem>
                {ORDER_STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filters.paymentStatus}
              onValueChange={(value) =>
                setFilters((prev) => ({
                  ...prev,
                  paymentStatus: value as FilterState["paymentStatus"],
                }))
              }
            >
              <SelectTrigger className="w-[200px] focus:ring-2 focus:ring-slate-900">
                <SelectValue placeholder="Payment" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Payments</SelectItem>
                {PAYMENT_STATUS_OPTIONS.map((option) => (
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
                    {view.name}
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
              Payments Completed: {paidOrdersCount}
            </Badge>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-slate-500">
          <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin" />
          Loading orders...
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={orders}
          searchKey="order_number"
          searchPlaceholder="Search order number..."
        />
      )}

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Order</DialogTitle>
            <DialogDescription>
              Add a new customer order in the current organization.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Customer</Label>
              <Select
                value={createForm.customerId}
                onValueChange={(value) =>
                  setCreateForm((prev) => ({ ...prev, customerId: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select customer" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Select customer</SelectItem>
                  {customers.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>
                      {customer.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="order-number">Order Number (optional)</Label>
                <Input
                  id="order-number"
                  value={createForm.orderNumber}
                  onChange={(event) =>
                    setCreateForm((prev) => ({ ...prev, orderNumber: event.target.value }))
                  }
                  placeholder="ORD-2026-000123"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="order-currency">Currency</Label>
                <Input
                  id="order-currency"
                  value={createForm.currency}
                  onChange={(event) =>
                    setCreateForm((prev) => ({ ...prev, currency: event.target.value }))
                  }
                  placeholder="USD"
                  maxLength={3}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="order-subtotal">Subtotal (cents)</Label>
                <Input
                  id="order-subtotal"
                  value={createForm.subtotalAmount}
                  onChange={(event) =>
                    setCreateForm((prev) => ({
                      ...prev,
                      subtotalAmount: event.target.value,
                    }))
                  }
                  placeholder="10000"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="order-tax">Tax (cents)</Label>
                <Input
                  id="order-tax"
                  value={createForm.taxAmount}
                  onChange={(event) =>
                    setCreateForm((prev) => ({
                      ...prev,
                      taxAmount: event.target.value,
                    }))
                  }
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="order-discount">Discount (cents)</Label>
                <Input
                  id="order-discount"
                  value={createForm.discountAmount}
                  onChange={(event) =>
                    setCreateForm((prev) => ({
                      ...prev,
                      discountAmount: event.target.value,
                    }))
                  }
                  placeholder="0"
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Line Items</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setCreateLineItems((prev) => [
                      ...prev,
                      createEmptyLineItem(),
                    ])
                  }
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Item
                </Button>
              </div>
              {createLineItems.length === 0 ? (
                <p className="text-xs text-slate-500">No line items.</p>
              ) : (
                <div className="space-y-2">
                  {createLineItems.map((item) => (
                    <div key={item.id} className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                      <Input
                        className="sm:col-span-6"
                        value={item.name}
                        onChange={(event) =>
                          setCreateLineItems((prev) =>
                            prev.map((entry) =>
                              entry.id === item.id
                                ? { ...entry, name: event.target.value }
                                : entry,
                            ),
                          )
                        }
                        placeholder="Product"
                      />
                      <Input
                        className="sm:col-span-2"
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(event) =>
                          setCreateLineItems((prev) =>
                            prev.map((entry) =>
                              entry.id === item.id
                                ? { ...entry, quantity: event.target.value }
                                : entry,
                            ),
                          )
                        }
                        placeholder="Qty"
                      />
                      <Input
                        className="sm:col-span-3"
                        value={item.unitPrice}
                        onChange={(event) =>
                          setCreateLineItems((prev) =>
                            prev.map((entry) =>
                              entry.id === item.id
                                ? { ...entry, unitPrice: event.target.value }
                                : entry,
                            ),
                          )
                        }
                        placeholder="Unit Price"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="sm:col-span-1"
                        onClick={() =>
                          setCreateLineItems((prev) =>
                            prev.filter((entry) => entry.id !== item.id),
                          )
                        }
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-slate-500">
                If line items are provided, subtotal is auto-calculated from line items and unit prices.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={createForm.status}
                onValueChange={(value) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    status: value as OrderStatus,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ORDER_STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="order-notes">Notes</Label>
              <Textarea
                id="order-notes"
                value={createForm.notes}
                onChange={(event) =>
                  setCreateForm((prev) => ({ ...prev, notes: event.target.value }))
                }
                placeholder="Optional notes for this order"
              />
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
            <Button onClick={handleCreateOrder} disabled={isCreating}>
              {isCreating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Order"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
