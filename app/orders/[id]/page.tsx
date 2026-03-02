"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Download,
  Loader2,
  Paperclip,
  Plus,
  Save,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { StatusBadge } from "../../components/StatusBadge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table";
import { Badge } from "../../components/ui/badge";
import { Input } from "../../components/ui/input";
import { useAppSelector } from "@/lib/store/hooks";
import { selectTopbarActiveOrganizationId } from "@/lib/store/slices/topbar-slice";
import type {
  OrderDetailResponse,
  OrderStatus,
} from "@/lib/orders/types";

const ORDER_STATUS_OPTIONS: Array<{ value: OrderStatus; label: string }> = [
  { value: "draft", label: "Draft" },
  { value: "pending", label: "Pending" },
  { value: "paid", label: "Paid" },
  { value: "fulfilled", label: "Fulfilled" },
  { value: "cancelled", label: "Cancelled" },
  { value: "refunded", label: "Refunded" },
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

function formatBytes(bytes: number) {
  if (!bytes || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
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

function parseFilenameFromContentDisposition(
  value: string | null,
  fallback: string,
) {
  if (!value) {
    return fallback;
  }

  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return fallback;
    }
  }

  const basicMatch = value.match(/filename="([^"]+)"/i);
  if (basicMatch?.[1]) {
    return basicMatch[1];
  }

  return fallback;
}

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const activeOrgId = useAppSelector(selectTopbarActiveOrganizationId);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [detail, setDetail] = useState<OrderDetailResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [isAddingLineItem, setIsAddingLineItem] = useState(false);
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);
  const [activeDownloadAttachmentId, setActiveDownloadAttachmentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [newItemName, setNewItemName] = useState("");
  const [newItemQuantity, setNewItemQuantity] = useState("1");
  const [newItemUnitPrice, setNewItemUnitPrice] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  const loadOrder = useCallback(async () => {
    if (!id) {
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/orders/${id}`, {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string };
        throw new Error(errorData.error ?? "Failed to load order");
      }

      const payload = (await response.json()) as OrderDetailResponse;
      setDetail(payload);
      setNotesDraft(payload.order.notes ?? "");
    } catch (loadError: unknown) {
      const message = loadError instanceof Error ? loadError.message : "Failed to load order";
      setError(message);
      toast.error(message);
      setDetail(null);
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadOrder();
  }, [activeOrgId, loadOrder]);

  const order = detail?.order ?? null;
  const items = useMemo(() => detail?.items ?? [], [detail?.items]);
  const attachments = useMemo(() => detail?.attachments ?? [], [detail?.attachments]);
  const statusEvents = useMemo(() => detail?.statusEvents ?? [], [detail?.statusEvents]);

  const handleUpdateStatus = async (status: OrderStatus) => {
    if (!id || !order || status === order.status) {
      return;
    }

    const previousStatus = order.status;
    setIsUpdatingStatus(true);
    setDetail((prev) =>
      prev
        ? {
            ...prev,
            order: {
              ...prev.order,
              status,
            },
          }
        : prev,
    );

    try {
      const response = await fetch(`/api/orders/${id}`, {
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
      setDetail(payload);
      setNotesDraft(payload.order.notes ?? "");
      toast.success("Order status updated");
    } catch (updateError: unknown) {
      const message =
        updateError instanceof Error ? updateError.message : "Failed to update order status";
      toast.error(message);
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              order: {
                ...prev.order,
                status: previousStatus,
              },
            }
          : prev,
      );
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleSaveNotes = async () => {
    if (!id || !order) {
      return;
    }

    const currentNotes = order.notes ?? "";
    if (notesDraft.trim() === currentNotes.trim()) {
      return;
    }

    setIsSavingNotes(true);
    try {
      const response = await fetch(`/api/orders/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          notes: notesDraft.trim() || null,
        }),
      });

      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string };
        throw new Error(errorData.error ?? "Failed to save notes");
      }

      const payload = (await response.json()) as OrderDetailResponse;
      setDetail(payload);
      setNotesDraft(payload.order.notes ?? "");
      toast.success("Order notes updated");
    } catch (saveError: unknown) {
      const message = saveError instanceof Error ? saveError.message : "Failed to save notes";
      toast.error(message);
    } finally {
      setIsSavingNotes(false);
    }
  };

  const handleAddLineItem = async () => {
    if (!id || !order) {
      return;
    }

    const name = newItemName.trim();
    const quantity = Number.parseInt(newItemQuantity, 10);
    const unitPriceAmount = parseAmountToCents(newItemUnitPrice);

    if (!name) {
      toast.error("Product name is required");
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      toast.error("Quantity must be a positive number");
      return;
    }
    if (unitPriceAmount === null) {
      toast.error("Unit price must be a valid non-negative amount");
      return;
    }

    const totalAmount = quantity * unitPriceAmount;
    setIsAddingLineItem(true);
    const toastId = toast.loading("Adding line item...");
    try {
      const response = await fetch(`/api/orders/${id}/items`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          quantity,
          unitPriceAmount,
          totalAmount,
        }),
      });

      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string };
        throw new Error(errorData.error ?? "Failed to add line item");
      }

      await response.json();
      setNewItemName("");
      setNewItemQuantity("1");
      setNewItemUnitPrice("");
      await loadOrder();
      toast.success("Line item added", { id: toastId });
    } catch (addError: unknown) {
      const message = addError instanceof Error ? addError.message : "Failed to add line item";
      toast.error(message, { id: toastId });
    } finally {
      setIsAddingLineItem(false);
    }
  };

  const handleSelectFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) {
      return;
    }

    setSelectedFiles((prev) => {
      const next = [...prev];
      for (const file of files) {
        const duplicate = next.some(
          (existing) =>
            existing.name === file.name &&
            existing.size === file.size &&
            existing.lastModified === file.lastModified,
        );
        if (!duplicate) {
          next.push(file);
        }
      }
      return next;
    });

    event.target.value = "";
  };

  const handleRemoveSelectedFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, fileIndex) => fileIndex !== index));
  };

  const handleUploadAttachments = async () => {
    if (!id || !selectedFiles.length) {
      return;
    }

    setIsUploadingAttachments(true);
    const toastId = toast.loading("Uploading attachments...");
    try {
      for (const file of selectedFiles) {
        const response = await fetch(
          `/api/orders/${id}/attachments?filename=${encodeURIComponent(file.name)}`,
          {
            method: "POST",
            headers: {
              "content-type": file.type || "application/octet-stream",
              "x-file-size": `${file.size}`,
            },
            body: file,
          },
        );

        if (!response.ok) {
          const errorData = (await response.json()) as { error?: string };
          throw new Error(errorData.error ?? `Failed to upload "${file.name}"`);
        }

        await response.json();
      }

      setSelectedFiles([]);
      await loadOrder();
      toast.success("Attachments uploaded", { id: toastId });
    } catch (uploadError: unknown) {
      const message =
        uploadError instanceof Error ? uploadError.message : "Failed to upload attachments";
      toast.error(message, { id: toastId });
    } finally {
      setIsUploadingAttachments(false);
    }
  };

  const handleDownloadAttachment = async (
    attachmentId: string,
    fallbackFileName: string,
  ) => {
    if (!id) {
      return;
    }

    setActiveDownloadAttachmentId(attachmentId);
    try {
      const response = await fetch(`/api/orders/${id}/attachments/${attachmentId}`, {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string };
        throw new Error(errorData.error ?? "Failed to download attachment");
      }

      const fileBlob = await response.blob();
      const contentDisposition = response.headers.get("content-disposition");
      const fileName = parseFilenameFromContentDisposition(
        contentDisposition,
        fallbackFileName,
      );

      const objectUrl = URL.createObjectURL(fileBlob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(objectUrl);
    } catch (downloadError: unknown) {
      const message =
        downloadError instanceof Error ? downloadError.message : "Failed to download attachment";
      toast.error(message);
    } finally {
      setActiveDownloadAttachmentId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="flex items-center justify-center py-12 text-slate-500">
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            Loading order...
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="p-6 space-y-4">
        <Button variant="outline" onClick={() => router.push("/orders")}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Orders
        </Button>
        <Card>
          <CardContent className="py-10 text-center text-slate-600">
            {error ?? "Order not found."}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="outline"
          size="icon"
          onClick={() => router.push("/orders")}
          className="focus:ring-2 focus:ring-slate-900"
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold text-slate-900">{order.order_number}</h1>
            <StatusBadge status={order.status} />
          </div>
          <p className="text-slate-600 mt-1">
            Created {formatDateTime(order.created_at)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Order Summary</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label className="text-sm text-slate-600 mb-1 block">Customer</Label>
                {order.customer ? (
                  <button
                    onClick={() => router.push(`/customers/${order.customer?.id}`)}
                    className="font-medium text-slate-900 hover:underline focus:outline-none focus:ring-2 focus:ring-slate-900 rounded"
                  >
                    {order.customer.name}
                  </button>
                ) : (
                  <p className="font-medium text-slate-400">Unknown customer</p>
                )}
              </div>

              <div>
                <Label className="text-sm text-slate-600 mb-1 block">Created By</Label>
                <p className="font-medium text-slate-900">
                  {order.creator?.name ?? order.creator?.email ?? "-"}
                </p>
              </div>

              <div>
                <Label className="text-sm text-slate-600 mb-1 block">Subtotal</Label>
                <p className="font-medium text-slate-900">
                  {formatMoney(order.subtotal_amount, order.currency)}
                </p>
              </div>

              <div>
                <Label className="text-sm text-slate-600 mb-1 block">Tax</Label>
                <p className="font-medium text-slate-900">
                  {formatMoney(order.tax_amount, order.currency)}
                </p>
              </div>

              <div>
                <Label className="text-sm text-slate-600 mb-1 block">Discount</Label>
                <p className="font-medium text-slate-900">
                  {formatMoney(order.discount_amount, order.currency)}
                </p>
              </div>

              <div>
                <Label className="text-sm text-slate-600 mb-1 block">Total</Label>
                <p className="font-semibold text-slate-900 text-lg">
                  {formatMoney(order.total_amount, order.currency)}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Line Items</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead className="text-right">Unit Price</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-slate-500">
                          No line items added to this order.
                        </TableCell>
                      </TableRow>
                    ) : (
                      items.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium text-slate-900">{item.name}</TableCell>
                          <TableCell className="text-right">{item.quantity}</TableCell>
                          <TableCell className="text-right">
                            {formatMoney(item.unit_price_amount, order.currency)}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatMoney(item.total_amount, order.currency)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                    <TableRow>
                      <TableCell colSpan={3} className="text-right font-semibold">
                        Total
                      </TableCell>
                      <TableCell className="text-right font-semibold text-slate-900">
                        {formatMoney(order.total_amount, order.currency)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="new-item-name">Product</Label>
                  <Input
                    id="new-item-name"
                    value={newItemName}
                    onChange={(event) => setNewItemName(event.target.value)}
                    placeholder="Enterprise License"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-item-quantity">Quantity</Label>
                  <Input
                    id="new-item-quantity"
                    type="number"
                    min={1}
                    value={newItemQuantity}
                    onChange={(event) => setNewItemQuantity(event.target.value)}
                    placeholder="1"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-item-unit-price">Unit Price ({order.currency})</Label>
                  <Input
                    id="new-item-unit-price"
                    value={newItemUnitPrice}
                    onChange={(event) => setNewItemUnitPrice(event.target.value)}
                    placeholder="999.00"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-4">
                <p className="text-xs text-slate-500">
                  Unit price is entered in normal currency format (example: 999.00).
                </p>
                <Button onClick={handleAddLineItem} disabled={isAddingLineItem}>
                  {isAddingLineItem ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Adding...
                    </>
                  ) : (
                    <>
                      <Plus className="mr-2 h-4 w-4" />
                      Add Line Item
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Attachments</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {attachments.length === 0 ? (
                <p className="text-sm text-slate-500">No attachments uploaded yet.</p>
              ) : (
                <div className="space-y-2">
                  {attachments.map((attachment) => (
                    <div
                      key={attachment.id}
                      className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-3 hover:bg-slate-50"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="rounded bg-slate-100 p-2">
                          <Paperclip className="h-4 w-4 text-slate-600" />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900">{attachment.file_name}</p>
                          <p className="text-xs text-slate-600">
                            {formatBytes(attachment.file_size)} - Uploaded by{" "}
                            {attachment.uploader?.name ?? attachment.uploader?.email ?? "Unknown"} on{" "}
                            {formatDateTime(attachment.created_at)}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          handleDownloadAttachment(attachment.id, attachment.file_name)
                        }
                        disabled={activeDownloadAttachmentId === attachment.id}
                      >
                        {activeDownloadAttachmentId === attachment.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Download className="h-4 w-4 mr-1" />
                            Download
                          </>
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                multiple
                onChange={handleSelectFiles}
              />

              {selectedFiles.length > 0 && (
                <div className="space-y-2">
                  {selectedFiles.map((file, index) => (
                    <div
                      key={`${file.name}-${file.lastModified}-${index}`}
                      className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">{file.name}</p>
                        <p className="text-xs text-slate-500">{formatBytes(file.size)}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveSelectedFile(index)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploadingAttachments}
                >
                  <Upload className="h-4 w-4" />
                  Select Files
                </Button>
                <Button
                  className="gap-2"
                  onClick={handleUploadAttachments}
                  disabled={isUploadingAttachments || selectedFiles.length === 0}
                >
                  {isUploadingAttachments ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4" />
                      Upload Attachments
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-sm text-slate-600 mb-2 block">Status</Label>
                <Select
                  value={order.status}
                  onValueChange={(value) =>
                    void handleUpdateStatus(value as OrderStatus)
                  }
                  disabled={isUpdatingStatus}
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
                <Label className="text-sm text-slate-600">Notes</Label>
                <Textarea
                  value={notesDraft}
                  onChange={(event) => setNotesDraft(event.target.value)}
                  placeholder="Add internal order notes"
                />
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={handleSaveNotes}
                  disabled={isSavingNotes}
                >
                  {isSavingNotes ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" />
                      Save Notes
                    </>
                  )}
                </Button>
              </div>

              <div>
                <Label className="text-sm text-slate-600 mb-1 block">Placed At</Label>
                <p className="font-medium text-slate-900">{formatDateTime(order.placed_at)}</p>
              </div>
              <div>
                <Label className="text-sm text-slate-600 mb-1 block">Paid At</Label>
                <p className="font-medium text-slate-900">{formatDateTime(order.paid_at)}</p>
              </div>
              <div>
                <Label className="text-sm text-slate-600 mb-1 block">Fulfilled At</Label>
                <p className="font-medium text-slate-900">{formatDateTime(order.fulfilled_at)}</p>
              </div>
              <div>
                <Label className="text-sm text-slate-600 mb-1 block">Cancelled At</Label>
                <p className="font-medium text-slate-900">{formatDateTime(order.cancelled_at)}</p>
              </div>
              <div>
                <Label className="text-sm text-slate-600 mb-1 block">Updated At</Label>
                <p className="font-medium text-slate-900">{formatDateTime(order.updated_at)}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Status Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              {statusEvents.length === 0 ? (
                <p className="text-sm text-slate-500">No status changes yet.</p>
              ) : (
                <div className="space-y-4">
                  {statusEvents.map((event) => (
                    <div key={event.id} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <StatusBadge status={event.to_status} />
                          <Badge variant="secondary" className="text-xs">
                            {event.from_status} to {event.to_status}
                          </Badge>
                        </div>
                        <span className="text-xs text-slate-500">
                          {formatDateTime(event.created_at)}
                        </span>
                      </div>
                      {event.reason && (
                        <p className="mt-2 text-sm text-slate-700">{event.reason}</p>
                      )}
                      <p className="mt-1 text-xs text-slate-500">
                        By {event.actor?.name ?? event.actor?.email ?? "System"}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
