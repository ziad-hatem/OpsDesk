import { describe, expect, it } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import topbarReducer, {
  createTopbarOrganization,
  fetchTopbarData,
  switchTopbarOrganization,
} from "@/lib/store/slices/topbar-slice";
import type { MeResponse } from "@/lib/topbar/types";

function createMePayload(activeOrgId: string): MeResponse {
  return {
    user: {
      id: "user-1",
      name: "User One",
      email: "user@opsdesk.test",
      avatar_url: null,
    },
    organizations: [
      {
        id: "org-1",
        name: "Org 1",
        logo_url: null,
        role: "admin",
      },
      {
        id: "org-2",
        name: "Org 2",
        logo_url: null,
        role: "support",
      },
    ],
    activeOrgId,
    notifications: {
      unreadCount: 3,
    },
    organizationCreation: {
      signupOrganizationName: null,
      canCreateFromSignupOrganization: false,
    },
  };
}

describe("topbar slice", () => {
  it("stores fetched me data", () => {
    const store = configureStore({
      reducer: {
        topbar: topbarReducer,
      },
    });

    store.dispatch(fetchTopbarData.fulfilled(createMePayload("org-1"), "req-1"));

    const state = store.getState().topbar;
    expect(state.data?.activeOrgId).toBe("org-1");
    expect(state.status).toBe("succeeded");
    expect(state.error).toBeNull();
  });

  it("increments org change version when organization changes", () => {
    const store = configureStore({
      reducer: {
        topbar: topbarReducer,
      },
    });

    store.dispatch(fetchTopbarData.fulfilled(createMePayload("org-1"), "req-1"));
    const firstVersion = store.getState().topbar.organizationChangeVersion;

    store.dispatch(
      switchTopbarOrganization.fulfilled(createMePayload("org-2"), "req-2", "org-2"),
    );
    const secondVersion = store.getState().topbar.organizationChangeVersion;

    expect(secondVersion).toBeGreaterThan(firstVersion);
  });

  it("applies created organization result payload", () => {
    const store = configureStore({
      reducer: {
        topbar: topbarReducer,
      },
    });

    store.dispatch(
      createTopbarOrganization.fulfilled(
        {
          me: createMePayload("org-2"),
          createdOrganizationName: "Org 2",
        },
        "req-3",
        {
          type: "from_scratch",
          name: "Org 2",
        },
      ),
    );

    const state = store.getState().topbar;
    expect(state.data?.activeOrgId).toBe("org-2");
    expect(state.isCreatingOrganization).toBe(false);
  });
});
