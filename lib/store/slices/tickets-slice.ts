import {
  createAsyncThunk,
  createSlice,
  type PayloadAction,
} from "@reduxjs/toolkit";
import type { RootState } from "../store";
import { clearLoggedUser } from "./auth-slice";
import {
  createTopbarOrganization,
  fetchTopbarData,
  switchTopbarOrganization,
} from "./topbar-slice";
import type {
  TicketAttachment,
  TicketDetailResponse,
  TicketListItem,
  TicketPriority,
  TicketStatus,
  TicketTextWithAttachments,
  TicketUser,
  TicketsListResponse,
} from "@/lib/tickets/types";

type AsyncStatus = "idle" | "loading" | "succeeded" | "failed";

interface TicketDetailEntry {
  data: TicketDetailResponse | null;
  status: AsyncStatus;
  error: string | null;
  loadedAt: number | null;
}

interface TicketsState {
  list: TicketListItem[];
  assignees: TicketUser[];
  activeOrgId: string | null;
  currentUserId: string | null;
  listStatus: AsyncStatus;
  listError: string | null;
  listLoadedAt: number | null;
  detailsById: Record<string, TicketDetailEntry>;
}

const DEFAULT_TICKET_DETAIL_ENTRY: TicketDetailEntry = Object.freeze({
  data: null,
  status: "idle",
  error: null,
  loadedAt: null,
});

export interface FetchTicketsFilters {
  status?: "all" | TicketStatus;
  priority?: "all" | TicketPriority;
  assigneeId?: "all" | string;
  customerId?: "all" | string;
  search?: string;
  createdFrom?: string;
  createdTo?: string;
}

export interface CreateTicketPayload {
  title: string;
  description?: string | null;
  status?: TicketStatus;
  priority?: TicketPriority;
  assigneeId?: string | null;
  customerId?: string | null;
  orderId?: string | null;
  slaDueAt?: string | null;
}

export interface UpdateTicketPayload {
  status?: TicketStatus;
  priority?: TicketPriority;
  assigneeId?: string | null;
  slaDueAt?: string | null;
  title?: string;
  description?: string | null;
}

export interface OptimisticTicketPatch {
  status?: TicketStatus;
  priority?: TicketPriority;
  assigneeId?: string | null;
  slaDueAt?: string | null;
}

interface TicketMutationContext {
  ticketId: string;
}

const initialState: TicketsState = {
  list: [],
  assignees: [],
  activeOrgId: null,
  currentUserId: null,
  listStatus: "idle",
  listError: null,
  listLoadedAt: null,
  detailsById: {},
};

function createInitialDetailEntry(): TicketDetailEntry {
  return {
    data: null,
    status: "idle",
    error: null,
    loadedAt: null,
  };
}

async function readApiError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string };
    if (data.error) {
      return data.error;
    }
  } catch {
    // Ignore JSON parsing errors and fallback to status text.
  }

  return response.statusText || `Request failed with status ${response.status}`;
}

function upsertTicketInList(state: TicketsState, ticket: TicketListItem) {
  const existingIndex = state.list.findIndex((item) => item.id === ticket.id);
  if (existingIndex === -1) {
    state.list.unshift(ticket);
    return;
  }
  state.list[existingIndex] = ticket;
}

function findAssignee(
  state: TicketsState,
  ticketId: string,
  assigneeId: string | null,
): TicketUser | null {
  if (!assigneeId) {
    return null;
  }

  const detailAssignees = state.detailsById[ticketId]?.data?.assignees ?? [];
  return (
    detailAssignees.find((assignee) => assignee.id === assigneeId) ??
    state.assignees.find((assignee) => assignee.id === assigneeId) ??
    null
  );
}

function applyPatchToTicket(params: {
  state: TicketsState;
  ticketId: string;
  ticket: TicketListItem;
  patch: OptimisticTicketPatch;
}) {
  const { state, ticketId, ticket, patch } = params;
  const now = new Date().toISOString();

  if (Object.prototype.hasOwnProperty.call(patch, "status") && patch.status) {
    ticket.status = patch.status;
    if (patch.status === "closed") {
      ticket.closed_at = now;
    } else if (ticket.closed_at) {
      ticket.closed_at = null;
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, "priority") && patch.priority) {
    ticket.priority = patch.priority;
  }

  if (Object.prototype.hasOwnProperty.call(patch, "assigneeId")) {
    ticket.assignee_id = patch.assigneeId ?? null;
    ticket.assignee = findAssignee(state, ticketId, patch.assigneeId ?? null);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "slaDueAt")) {
    ticket.sla_due_at = patch.slaDueAt ?? null;
  }

  ticket.updated_at = now;
}

function upsertDetailFromResponse(
  state: TicketsState,
  payload: TicketDetailResponse,
) {
  state.detailsById[payload.ticket.id] = {
    data: payload,
    status: "succeeded",
    error: null,
    loadedAt: Date.now(),
  };
  upsertTicketInList(state, payload.ticket);
  state.assignees = payload.assignees;
  state.activeOrgId = payload.activeOrgId;
  state.currentUserId = payload.currentUserId;
}

function resetTicketCacheForOrgChange(
  state: TicketsState,
  nextActiveOrgId: string | null,
) {
  if (state.activeOrgId !== null && state.activeOrgId !== nextActiveOrgId) {
    state.list = [];
    state.listStatus = "idle";
    state.listError = null;
    state.listLoadedAt = null;
    state.detailsById = {};
  }

  state.activeOrgId = nextActiveOrgId;
}

export const fetchTickets = createAsyncThunk<
  TicketsListResponse,
  FetchTicketsFilters | undefined,
  { rejectValue: string }
>("tickets/fetchTickets", async (filters, thunkApi) => {
  const params = new URLSearchParams();
  if (filters?.status && filters.status !== "all") {
    params.set("status", filters.status);
  }
  if (filters?.priority && filters.priority !== "all") {
    params.set("priority", filters.priority);
  }
  if (filters?.assigneeId && filters.assigneeId !== "all") {
    params.set("assigneeId", filters.assigneeId);
  }
  if (filters?.customerId && filters.customerId !== "all") {
    params.set("customerId", filters.customerId);
  }
  if (filters?.search?.trim()) {
    params.set("search", filters.search.trim());
  }
  if (filters?.createdFrom?.trim()) {
    params.set("createdFrom", filters.createdFrom.trim());
  }
  if (filters?.createdTo?.trim()) {
    params.set("createdTo", filters.createdTo.trim());
  }

  const response = await fetch(
    `/api/tickets${params.toString() ? `?${params.toString()}` : ""}`,
    {
      method: "GET",
      cache: "no-store",
    },
  );

  if (!response.ok) {
    return thunkApi.rejectWithValue(await readApiError(response));
  }

  return (await response.json()) as TicketsListResponse;
});

export const fetchTicketDetail = createAsyncThunk<
  TicketDetailResponse,
  string,
  { rejectValue: string }
>("tickets/fetchTicketDetail", async (ticketId, thunkApi) => {
  const response = await fetch(`/api/tickets/${ticketId}`, {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    return thunkApi.rejectWithValue(await readApiError(response));
  }

  return (await response.json()) as TicketDetailResponse;
});

export const createTicket = createAsyncThunk<
  TicketListItem,
  CreateTicketPayload,
  { rejectValue: string }
>("tickets/createTicket", async (payload, thunkApi) => {
  const response = await fetch("/api/tickets", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    return thunkApi.rejectWithValue(await readApiError(response));
  }

  const data = (await response.json()) as { ticket: TicketListItem };
  return data.ticket;
});

export const updateTicket = createAsyncThunk<
  TicketDetailResponse,
  TicketMutationContext & { payload: UpdateTicketPayload },
  { rejectValue: string }
>("tickets/updateTicket", async ({ ticketId, payload }, thunkApi) => {
  const response = await fetch(`/api/tickets/${ticketId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    return thunkApi.rejectWithValue(await readApiError(response));
  }

  return (await response.json()) as TicketDetailResponse;
});

const ticketsSlice = createSlice({
  name: "tickets",
  initialState,
  reducers: {
    applyOptimisticTicketPatch: (
      state,
      action: PayloadAction<{ ticketId: string; patch: OptimisticTicketPatch }>,
    ) => {
      const { ticketId, patch } = action.payload;

      const detailEntry = state.detailsById[ticketId];
      if (detailEntry?.data) {
        applyPatchToTicket({
          state,
          ticketId,
          ticket: detailEntry.data.ticket,
          patch,
        });
      }

      const listTicket = state.list.find((ticket) => ticket.id === ticketId);
      if (listTicket) {
        applyPatchToTicket({
          state,
          ticketId,
          ticket: listTicket,
          patch,
        });
      }
    },
    addTicketTextToDetail: (
      state,
      action: PayloadAction<{ ticketId: string; text: TicketTextWithAttachments }>,
    ) => {
      const { ticketId, text } = action.payload;
      const detailEntry = state.detailsById[ticketId];
      if (!detailEntry?.data) {
        return;
      }

      const existingIndex = detailEntry.data.texts.findIndex(
        (item) => item.id === text.id,
      );
      if (existingIndex === -1) {
        detailEntry.data.texts.push(text);
        detailEntry.data.texts.sort((a, b) =>
          a.created_at.localeCompare(b.created_at),
        );
      } else {
        detailEntry.data.texts[existingIndex] = text;
      }

      detailEntry.data.ticket.updated_at = text.created_at;

      const listTicket = state.list.find((ticket) => ticket.id === ticketId);
      if (listTicket) {
        listTicket.updated_at = text.created_at;
      }
    },
    addTicketAttachmentToDetail: (
      state,
      action: PayloadAction<{ ticketId: string; attachment: TicketAttachment }>,
    ) => {
      const { ticketId, attachment } = action.payload;
      const detailEntry = state.detailsById[ticketId];
      if (!detailEntry?.data) {
        return;
      }

      const alreadyExists = detailEntry.data.attachments.some(
        (item) => item.id === attachment.id,
      );
      if (!alreadyExists) {
        detailEntry.data.attachments.push(attachment);
      }

      if (attachment.ticket_text_id) {
        const targetText = detailEntry.data.texts.find(
          (text) => text.id === attachment.ticket_text_id,
        );
        if (targetText) {
          const hasAttachment = targetText.attachments.some(
            (item) => item.id === attachment.id,
          );
          if (!hasAttachment) {
            targetText.attachments.push(attachment);
          }
        }
      }

      detailEntry.data.ticket.updated_at = attachment.created_at;

      const listTicket = state.list.find((ticket) => ticket.id === ticketId);
      if (listTicket) {
        listTicket.updated_at = attachment.created_at;
      }
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchTickets.pending, (state) => {
        state.listStatus = "loading";
        state.listError = null;
      })
      .addCase(fetchTickets.fulfilled, (state, action) => {
        state.listStatus = "succeeded";
        state.listError = null;
        state.list = action.payload.tickets;
        state.assignees = action.payload.assignees;
        state.activeOrgId = action.payload.activeOrgId;
        state.currentUserId = action.payload.currentUserId;
        state.listLoadedAt = Date.now();
      })
      .addCase(fetchTickets.rejected, (state, action) => {
        state.listStatus = "failed";
        state.listError =
          action.payload ?? action.error.message ?? "Failed to load tickets";
      })
      .addCase(fetchTicketDetail.pending, (state, action) => {
        const ticketId = action.meta.arg;
        const entry = state.detailsById[ticketId] ?? createInitialDetailEntry();
        entry.status = "loading";
        entry.error = null;
        state.detailsById[ticketId] = entry;
      })
      .addCase(fetchTicketDetail.fulfilled, (state, action) => {
        upsertDetailFromResponse(state, action.payload);
      })
      .addCase(fetchTicketDetail.rejected, (state, action) => {
        const ticketId = action.meta.arg;
        const entry = state.detailsById[ticketId] ?? createInitialDetailEntry();
        entry.status = "failed";
        entry.error =
          action.payload ?? action.error.message ?? "Failed to load ticket";
        state.detailsById[ticketId] = entry;
      })
      .addCase(createTicket.fulfilled, (state, action) => {
        upsertTicketInList(state, action.payload);
      })
      .addCase(updateTicket.fulfilled, (state, action) => {
        upsertDetailFromResponse(state, action.payload);
      })
      .addCase(updateTicket.rejected, (state, action) => {
        const ticketId = action.meta.arg.ticketId;
        const entry = state.detailsById[ticketId];
        if (entry) {
          entry.error =
            action.payload ?? action.error.message ?? "Failed to update ticket";
        }
      })
      .addCase(fetchTopbarData.fulfilled, (state, action) => {
        resetTicketCacheForOrgChange(state, action.payload.activeOrgId ?? null);
      })
      .addCase(switchTopbarOrganization.fulfilled, (state, action) => {
        resetTicketCacheForOrgChange(state, action.payload.activeOrgId ?? null);
      })
      .addCase(createTopbarOrganization.fulfilled, (state, action) => {
        resetTicketCacheForOrgChange(state, action.payload.me.activeOrgId ?? null);
      })
      .addCase(clearLoggedUser, () => initialState);
  },
});

export const {
  applyOptimisticTicketPatch,
  addTicketTextToDetail,
  addTicketAttachmentToDetail,
} = ticketsSlice.actions;

export const selectTicketsState = (state: RootState) => state.tickets;
export const selectTicketsList = (state: RootState) => state.tickets.list;
export const selectTicketsAssignees = (state: RootState) => state.tickets.assignees;
export const selectTicketsListStatus = (state: RootState) =>
  state.tickets.listStatus;
export const selectTicketsListError = (state: RootState) => state.tickets.listError;
export const selectTicketDetailEntry =
  (ticketId: string) => (state: RootState): TicketDetailEntry =>
    state.tickets.detailsById[ticketId] ?? DEFAULT_TICKET_DETAIL_ENTRY;

export default ticketsSlice.reducer;
