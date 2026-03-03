"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Download,
  Loader2,
  Paperclip,
  Send,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import { StatusBadge } from "../../components/StatusBadge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Label } from "../../components/ui/label";
import { Badge } from "../../components/ui/badge";
import { Input } from "../../components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "../../components/ui/avatar";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  addTicketAttachmentToDetail,
  addTicketTextToDetail,
  applyOptimisticTicketPatch,
  fetchTicketDetail,
  selectTicketDetailEntry,
  updateTicket,
} from "@/lib/store/slices/tickets-slice";
import { selectTopbarActiveOrganizationId } from "@/lib/store/slices/topbar-slice";
import type {
  TicketAttachment,
  TicketPriority,
  TicketStatus,
  TicketTextType,
  TicketTextWithAttachments,
  TicketUser,
} from "@/lib/tickets/types";
import { buildMentionHandlesForIdentity } from "@/lib/tickets/mention-handles";

type CreateTextResponse = {
  text: TicketTextWithAttachments;
};

type UploadAttachmentResponse = {
  attachment: TicketAttachment;
};

function formatUserDisplay(user: TicketUser | null) {
  if (!user) {
    return "Unknown user";
  }
  return user.name?.trim() || user.email;
}

function toInitials(value: string) {
  const parts = value
    .split(" ")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (!parts.length) {
    return "U";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

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

function formatBytes(bytes: number) {
  if (!bytes || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function getTextTypeBadge(type: TicketTextType) {
  switch (type) {
    case "internal_note":
      return {
        label: "Internal",
        className: "bg-amber-100 text-amber-800 hover:bg-amber-100",
      };
    case "system":
      return {
        label: "System",
        className: "bg-slate-100 text-slate-700 hover:bg-slate-100",
      };
    case "comment":
    default:
      return {
        label: "Comment",
        className: "bg-blue-100 text-blue-800 hover:bg-blue-100",
      };
  }
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

export default function TicketDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const dispatch = useAppDispatch();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const ticketId = useMemo(
    () => (typeof params.id === "string" ? params.id : ""),
    [params.id],
  );
  const detailSelector = useMemo(
    () => selectTicketDetailEntry(ticketId),
    [ticketId],
  );
  const detailEntry = useAppSelector(detailSelector);
  const activeOrgId = useAppSelector(selectTopbarActiveOrganizationId);
  const detail = detailEntry.data;

  const [reply, setReply] = useState("");
  const [replyType, setReplyType] = useState<Extract<TicketTextType, "comment" | "internal_note">>(
    "comment",
  );
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUpdatingTicket, setIsUpdatingTicket] = useState(false);
  const [activeDownloadId, setActiveDownloadId] = useState<string | null>(null);
  const [slaDueAtInput, setSlaDueAtInput] = useState("");
  const [isSavingSlaDueAt, setIsSavingSlaDueAt] = useState(false);

  useEffect(() => {
    if (!ticketId) {
      return;
    }
    void dispatch(fetchTicketDetail(ticketId));
  }, [activeOrgId, dispatch, ticketId]);

  const ticket = detail?.ticket ?? null;
  const texts = detail?.texts ?? [];
  const attachments = detail?.attachments ?? [];
  const assignees = detail?.assignees ?? [];
  const systemActivity = texts.filter((text) => text.type === "system");
  const isLoading = detailEntry.status === "loading" && !detail;
  const mentionableUsers = useMemo(() => {
    const usersById = new Map<string, TicketUser>();
    for (const user of assignees) {
      usersById.set(user.id, user);
    }
    if (ticket?.creator) {
      usersById.set(ticket.creator.id, ticket.creator);
    }

    return Array.from(usersById.values())
      .map((user) => ({
        user,
        handles: buildMentionHandlesForIdentity({
          name: user.name,
          email: user.email,
        }),
      }))
      .filter((entry) => entry.handles.length > 0)
      .sort((a, b) => formatUserDisplay(a.user).localeCompare(formatUserDisplay(b.user)));
  }, [assignees, ticket?.creator]);
  const activeMentionQuery = useMemo(() => {
    const match = reply.match(/(^|[\s([{\-])@([a-zA-Z0-9._-]*)$/);
    if (!match) {
      return null;
    }
    return (match[2] ?? "").toLowerCase();
  }, [reply]);
  const mentionSuggestions = useMemo(() => {
    if (activeMentionQuery === null) {
      return [];
    }

    return mentionableUsers
      .map((entry) => ({
        ...entry,
        handles: entry.handles.filter(
          (handle) =>
            activeMentionQuery.length === 0 ||
            handle.toLowerCase().startsWith(activeMentionQuery),
        ),
      }))
      .filter((entry) => entry.handles.length > 0);
  }, [activeMentionQuery, mentionableUsers]);

  useEffect(() => {
    if (!ticket) {
      setSlaDueAtInput("");
      return;
    }

    if (!ticket.sla_due_at) {
      setSlaDueAtInput("");
      return;
    }

    const parsed = new Date(ticket.sla_due_at);
    setSlaDueAtInput(
      Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 16),
    );
  }, [ticket]);

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

  const handleInsertMention = (handle: string) => {
    setReply((prev) => {
      const match = prev.match(/(^|[\s([{\-])@([a-zA-Z0-9._-]*)$/);
      if (!match) {
        const trimmed = prev.trimEnd();
        if (!trimmed) {
          return `@${handle} `;
        }
        return `${trimmed} @${handle} `;
      }

      const delimiter = match[1] ?? "";
      const wholeMatch = match[0] ?? "";
      const prefix = prev.slice(0, prev.length - wholeMatch.length);
      return `${prefix}${delimiter}@${handle} `;
    });
  };

  const runTicketUpdate = async (
    payload: Partial<{
      status: TicketStatus;
      priority: TicketPriority;
      assigneeId: string | null;
      slaDueAt: string | null;
    }>,
    successMessage: string,
  ) => {
    if (!ticketId) {
      return;
    }

    dispatch(applyOptimisticTicketPatch({ ticketId, patch: payload }));
    try {
      await dispatch(updateTicket({ ticketId, payload })).unwrap();
      toast.success(successMessage);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to update ticket";
      toast.error(message);
      void dispatch(fetchTicketDetail(ticketId));
    }
  };

  const handlePatchTicket = async (
    payload: Partial<{
      status: TicketStatus;
      priority: TicketPriority;
      assigneeId: string | null;
      slaDueAt: string | null;
    }>,
    successMessage: string,
  ) => {
    setIsUpdatingTicket(true);
    await runTicketUpdate(payload, successMessage);
    setIsUpdatingTicket(false);
  };

  const handleSaveSlaDueAt = async () => {
    if (!ticketId) {
      return;
    }

    setIsSavingSlaDueAt(true);
    let value: string | null = null;
    if (slaDueAtInput) {
      const parsed = new Date(slaDueAtInput);
      if (Number.isNaN(parsed.getTime())) {
        toast.error("Invalid SLA date");
        setIsSavingSlaDueAt(false);
        return;
      }
      value = parsed.toISOString();
    }

    await runTicketUpdate({ slaDueAt: value }, "SLA due date updated");
    setIsSavingSlaDueAt(false);
  };

  const handleSendReply = async () => {
    if (!ticketId) {
      return;
    }
    const content = reply.trim();
    if (!content && selectedFiles.length === 0) {
      return;
    }

    const toastId = toast.loading("Posting update...");
    setIsSubmitting(true);
    try {
      const textResponse = await fetch(`/api/tickets/${ticketId}/texts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          body: content || "Attachment uploaded",
          type: replyType,
        }),
      });

      if (!textResponse.ok) {
        const errorData = (await textResponse.json()) as { error?: string };
        throw new Error(errorData.error ?? "Failed to add ticket message");
      }

      const textPayload = (await textResponse.json()) as CreateTextResponse;
      const createdText = textPayload.text;
      if (!createdText?.id) {
        throw new Error("Ticket message created without id");
      }

      dispatch(
        addTicketTextToDetail({
          ticketId,
          text: createdText,
        }),
      );

      for (const file of selectedFiles) {
        const uploadResponse = await fetch(
          `/api/tickets/${ticketId}/attachments?filename=${encodeURIComponent(
            file.name,
          )}&ticketTextId=${encodeURIComponent(createdText.id)}`,
          {
            method: "POST",
            headers: {
              "content-type": file.type || "application/octet-stream",
              "x-file-size": `${file.size}`,
            },
            body: file,
          },
        );

        if (!uploadResponse.ok) {
          const errorData = (await uploadResponse.json()) as { error?: string };
          throw new Error(
            errorData.error ?? `Failed to upload attachment "${file.name}"`,
          );
        }

        const uploadPayload = (await uploadResponse.json()) as UploadAttachmentResponse;
        dispatch(
          addTicketAttachmentToDetail({
            ticketId,
            attachment: uploadPayload.attachment,
          }),
        );
      }

      setReply("");
      setReplyType("comment");
      setSelectedFiles([]);
      toast.success("Update posted", { id: toastId });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to post update";
      toast.error(message, { id: toastId });
      void dispatch(fetchTicketDetail(ticketId));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDownloadAttachment = async (
    attachmentId: string,
    fallbackFileName: string,
  ) => {
    if (!ticketId) {
      return;
    }

    setActiveDownloadId(attachmentId);
    try {
      const response = await fetch(
        `/api/tickets/${ticketId}/attachments/${attachmentId}`,
        {
          method: "GET",
          cache: "no-store",
        },
      );

      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string };
        throw new Error(errorData.error ?? "Failed to generate download link");
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
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to download attachment";
      toast.error(message);
    } finally {
      setActiveDownloadId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="flex items-center justify-center py-12 text-slate-500">
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            Loading ticket...
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="p-6 space-y-4">
        <Button variant="outline" onClick={() => router.push("/tickets")}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Tickets
        </Button>
        <Card>
          <CardContent className="py-10 text-center text-slate-600">
            {detailEntry.error ?? "Ticket not found or you do not have access to it."}
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
          onClick={() => router.push("/tickets")}
          className="focus:ring-2 focus:ring-slate-900"
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>

        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold text-slate-900">Ticket {ticket.id.slice(0, 8).toUpperCase()}</h1>
            <StatusBadge status={ticket.status} />
            <StatusBadge status={ticket.priority} />
          </div>
          <p className="text-slate-700 mt-1">{ticket.title}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Conversation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {texts.length === 0 ? (
                <div className="text-sm text-slate-500">No messages yet.</div>
              ) : (
                <div className="space-y-6">
                  {texts.map((text) => {
                    const authorName = formatUserDisplay(text.author);
                    const typeBadge = getTextTypeBadge(text.type);

                    return (
                      <div key={text.id} className="flex gap-3">
                        <Avatar className="w-10 h-10">
                          {text.author?.avatar_url && (
                            <AvatarImage src={text.author.avatar_url} alt={authorName} />
                          )}
                          <AvatarFallback>{toInitials(authorName)}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <span className="font-medium text-slate-900">{authorName}</span>
                            <Badge className={typeBadge.className}>{typeBadge.label}</Badge>
                            <span className="text-xs text-slate-500">{formatDateTime(text.created_at)}</span>
                          </div>
                          <p className="text-slate-700 whitespace-pre-wrap">{text.body}</p>

                          {text.attachments.length > 0 && (
                            <div className="mt-3 space-y-2">
                              {text.attachments.map((attachment) => (
                                <div
                                  key={attachment.id}
                                  className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2"
                                >
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-medium text-slate-900">
                                      {attachment.file_name}
                                    </p>
                                    <p className="text-xs text-slate-500">
                                      {formatBytes(attachment.file_size)}
                                    </p>
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                      handleDownloadAttachment(
                                        attachment.id,
                                        attachment.file_name,
                                      )
                                    }
                                    disabled={activeDownloadId === attachment.id}
                                  >
                                    {activeDownloadId === attachment.id ? (
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
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="border-t border-slate-200 pt-6 space-y-4">
                <div className="flex flex-wrap gap-3">
                  <div className="w-[180px]">
                    <Label className="mb-2 block text-sm text-slate-600">Message type</Label>
                    <Select
                      value={replyType}
                      onValueChange={(value) =>
                        setReplyType(value as Extract<TicketTextType, "comment" | "internal_note">)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="comment">Comment</SelectItem>
                        <SelectItem value="internal_note">Internal Note</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Textarea
                  placeholder="Write an update..."
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                  className="min-h-[120px]"
                />
                {activeMentionQuery !== null ? (
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="text-xs font-medium text-slate-700">
                      Mention handles on this ticket
                    </p>
                    {mentionSuggestions.length === 0 ? (
                      <p className="mt-1 text-xs text-slate-500">No matching handles found.</p>
                    ) : (
                      <div className="mt-2 space-y-2">
                        {mentionSuggestions.map((entry) => (
                          <div key={entry.user.id} className="space-y-1">
                            <p className="text-xs text-slate-600">
                              {formatUserDisplay(entry.user)}
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {entry.handles.map((handle) => (
                                <button
                                  key={`${entry.user.id}-${handle}`}
                                  type="button"
                                  onClick={() => handleInsertMention(handle)}
                                  className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-100"
                                >
                                  @{handle}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}

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

                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  multiple
                  onChange={handleSelectFiles}
                />

                <div className="flex items-center justify-between">
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-2"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isSubmitting}
                  >
                    <Upload className="h-4 w-4" />
                    Attach Files
                  </Button>

                  <Button
                    className="gap-2"
                    onClick={handleSendReply}
                    disabled={isSubmitting || (!reply.trim() && selectedFiles.length === 0)}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4" />
                        Send Update
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Attachments</CardTitle>
            </CardHeader>
            <CardContent>
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
                            {formatUserDisplay(attachment.uploader)} on{" "}
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
                        disabled={activeDownloadId === attachment.id}
                      >
                        {activeDownloadId === attachment.id ? (
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
                  value={ticket.status}
                  onValueChange={(value) =>
                    void handlePatchTicket(
                      { status: value as TicketStatus },
                      "Ticket status updated",
                    )
                  }
                  disabled={isUpdatingTicket}
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

              <div>
                <Label className="text-sm text-slate-600 mb-2 block">Priority</Label>
                <Select
                  value={ticket.priority}
                  onValueChange={(value) =>
                    void handlePatchTicket(
                      { priority: value as TicketPriority },
                      "Ticket priority updated",
                    )
                  }
                  disabled={isUpdatingTicket}
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

              <div>
                <Label className="text-sm text-slate-600 mb-2 block">Assignee</Label>
                <Select
                  value={ticket.assignee_id ?? "unassigned"}
                  onValueChange={(value) =>
                    void handlePatchTicket(
                      { assigneeId: value === "unassigned" ? null : value },
                      "Ticket assignee updated",
                    )
                  }
                  disabled={isUpdatingTicket}
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
                <Label className="text-sm text-slate-600">SLA Due Date</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="datetime-local"
                    value={slaDueAtInput}
                    onChange={(event) => setSlaDueAtInput(event.target.value)}
                    disabled={isSavingSlaDueAt}
                  />
                  <Button
                    variant="outline"
                    onClick={handleSaveSlaDueAt}
                    disabled={isSavingSlaDueAt}
                  >
                    {isSavingSlaDueAt ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Save"
                    )}
                  </Button>
                </div>
              </div>

              <div>
                <Label className="text-sm text-slate-600 mb-1 block">Created By</Label>
                <p className="font-medium text-slate-900">{formatUserDisplay(ticket.creator)}</p>
              </div>

              <div>
                <Label className="text-sm text-slate-600 mb-1 block">Customer</Label>
                {ticket.customer ? (
                  <button
                    onClick={() => router.push(`/customers/${ticket.customer?.id}`)}
                    className="font-medium text-slate-900 hover:underline focus:outline-none focus:ring-2 focus:ring-slate-900 rounded"
                  >
                    {ticket.customer.name}
                  </button>
                ) : (
                  <p className="font-medium text-slate-400">Not linked</p>
                )}
              </div>

              <div>
                <Label className="text-sm text-slate-600 mb-1 block">Created At</Label>
                <p className="font-medium text-slate-900">{formatDateTime(ticket.created_at)}</p>
              </div>

              <div>
                <Label className="text-sm text-slate-600 mb-1 block">Last Updated</Label>
                <p className="font-medium text-slate-900">{formatDateTime(ticket.updated_at)}</p>
              </div>

              <div>
                <Label className="text-sm text-slate-600 mb-1 block">Closed At</Label>
                <p className="font-medium text-slate-900">{formatDateTime(ticket.closed_at)}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardContent>
              {systemActivity.length === 0 ? (
                <p className="text-sm text-slate-500">No system activity yet.</p>
              ) : (
                <div className="space-y-4">
                  {systemActivity.map((item) => (
                    <div key={item.id} className="flex items-start gap-3">
                      <div className="w-2 h-2 rounded-full bg-slate-400 mt-2" />
                      <div className="flex-1">
                        <p className="text-sm text-slate-900">{item.body}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {formatDateTime(item.created_at)} by {formatUserDisplay(item.author)}
                        </p>
                      </div>
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
