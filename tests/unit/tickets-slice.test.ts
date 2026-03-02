import { describe, expect, it } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import ticketsReducer, {
  addTicketAttachmentToDetail,
  addTicketTextToDetail,
  applyOptimisticTicketPatch,
  updateTicket,
} from "@/lib/store/slices/tickets-slice";
import type {
  TicketAttachment,
  TicketDetailResponse,
  TicketTextWithAttachments,
} from "@/lib/tickets/types";

function createFixtureDetail(): TicketDetailResponse {
  const now = new Date().toISOString();
  return {
    ticket: {
      id: "ticket-1",
      organization_id: "org-1",
      customer_id: null,
      order_id: null,
      title: "API error",
      description: "Initial description",
      status: "open",
      priority: "medium",
      assignee_id: "user-2",
      created_by: "user-1",
      sla_due_at: null,
      created_at: now,
      updated_at: now,
      closed_at: null,
      assignee: {
        id: "user-2",
        name: "Assignee",
        email: "assignee@opsdesk.test",
        avatar_url: null,
      },
      creator: {
        id: "user-1",
        name: "Creator",
        email: "creator@opsdesk.test",
        avatar_url: null,
      },
      customer: null,
    },
    texts: [],
    attachments: [],
    assignees: [
      {
        id: "user-2",
        name: "Assignee",
        email: "assignee@opsdesk.test",
        avatar_url: null,
      },
      {
        id: "user-3",
        name: "Next Assignee",
        email: "next@opsdesk.test",
        avatar_url: null,
      },
    ],
    activeOrgId: "org-1",
    currentUserId: "user-1",
  };
}

describe("tickets slice", () => {
  it("applies optimistic patch to both detail and list", () => {
    const store = configureStore({
      reducer: {
        tickets: ticketsReducer,
      },
    });

    const detail = createFixtureDetail();
    store.dispatch(
      updateTicket.fulfilled(detail, "request-id", {
        ticketId: detail.ticket.id,
        payload: {},
      }),
    );

    store.dispatch(
      applyOptimisticTicketPatch({
        ticketId: detail.ticket.id,
        patch: {
          status: "pending",
          priority: "high",
          assigneeId: "user-3",
        },
      }),
    );

    const state = store.getState().tickets;
    expect(state.list[0]?.status).toBe("pending");
    expect(state.list[0]?.priority).toBe("high");
    expect(state.list[0]?.assignee_id).toBe("user-3");
    expect(state.detailsById[detail.ticket.id]?.data?.ticket.status).toBe("pending");
    expect(state.detailsById[detail.ticket.id]?.data?.ticket.priority).toBe("high");
  });

  it("adds text and attachment without refetch", () => {
    const store = configureStore({
      reducer: {
        tickets: ticketsReducer,
      },
    });

    const detail = createFixtureDetail();
    store.dispatch(
      updateTicket.fulfilled(detail, "request-id", {
        ticketId: detail.ticket.id,
        payload: {},
      }),
    );

    const text: TicketTextWithAttachments = {
      id: "text-1",
      organization_id: "org-1",
      ticket_id: "ticket-1",
      author_id: "user-1",
      type: "comment",
      body: "Investigating now",
      created_at: new Date(Date.now() + 1000).toISOString(),
      updated_at: null,
      author: detail.ticket.creator,
      attachments: [],
    };

    store.dispatch(
      addTicketTextToDetail({
        ticketId: detail.ticket.id,
        text,
      }),
    );

    const attachment: TicketAttachment = {
      id: "att-1",
      organization_id: "org-1",
      ticket_id: "ticket-1",
      ticket_text_id: "text-1",
      file_name: "logs.txt",
      file_size: 1234,
      mime_type: "text/plain",
      storage_key: "tickets/org-1/ticket-1/logs.txt",
      uploaded_by: "user-1",
      created_at: new Date(Date.now() + 2000).toISOString(),
      uploader: detail.ticket.creator,
    };

    store.dispatch(
      addTicketAttachmentToDetail({
        ticketId: detail.ticket.id,
        attachment,
      }),
    );

    const state = store.getState().tickets;
    expect(state.detailsById[detail.ticket.id]?.data?.texts).toHaveLength(1);
    expect(state.detailsById[detail.ticket.id]?.data?.attachments).toHaveLength(1);
    expect(
      state.detailsById[detail.ticket.id]?.data?.texts[0]?.attachments[0]?.id,
    ).toBe("att-1");
  });
});
