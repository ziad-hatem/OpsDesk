import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import type { RootState } from "../store";
import { clearLoggedUser } from "./auth-slice";
import type { MeResponse } from "@/lib/topbar/types";

type AsyncStatus = "idle" | "loading" | "succeeded" | "failed";

interface TopbarState {
  data: MeResponse | null;
  status: AsyncStatus;
  error: string | null;
  isSwitchingOrganization: boolean;
  isCreatingOrganization: boolean;
  organizationChangeVersion: number;
}

type CreateOrganizationPayload = {
  type: "from_scratch" | "from_signup_company";
  name?: string;
};

type CreateOrganizationResult = {
  me: MeResponse;
  createdOrganizationName?: string;
};

const initialState: TopbarState = {
  data: null,
  status: "idle",
  error: null,
  isSwitchingOrganization: false,
  isCreatingOrganization: false,
  organizationChangeVersion: 0,
};

async function readApiError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string };
    if (data.error) {
      return data.error;
    }
  } catch {
    // Ignore parse error and fallback below.
  }

  return response.statusText || `Request failed with status ${response.status}`;
}

async function fetchMePayload(): Promise<MeResponse> {
  const response = await fetch("/api/me", {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  return (await response.json()) as MeResponse;
}

function applyMeData(state: TopbarState, data: MeResponse) {
  const previousActiveOrgId = state.data?.activeOrgId ?? null;
  const nextActiveOrgId = data.activeOrgId ?? null;

  if (previousActiveOrgId !== nextActiveOrgId) {
    state.organizationChangeVersion += 1;
  }

  state.data = data;
  state.status = "succeeded";
  state.error = null;
}

export const fetchTopbarData = createAsyncThunk<
  MeResponse,
  void,
  { rejectValue: string }
>("topbar/fetchTopbarData", async (_, thunkApi) => {
  try {
    return await fetchMePayload();
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to load topbar data";
    return thunkApi.rejectWithValue(message);
  }
});

export const switchTopbarOrganization = createAsyncThunk<
  MeResponse,
  string,
  { rejectValue: string }
>("topbar/switchTopbarOrganization", async (organizationId, thunkApi) => {
  const response = await fetch("/api/me/active-organization", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ organizationId }),
  });

  if (!response.ok) {
    return thunkApi.rejectWithValue(await readApiError(response));
  }

  try {
    return await fetchMePayload();
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to refresh topbar data";
    return thunkApi.rejectWithValue(message);
  }
});

export const createTopbarOrganization = createAsyncThunk<
  CreateOrganizationResult,
  CreateOrganizationPayload,
  { rejectValue: string }
>("topbar/createTopbarOrganization", async (payload, thunkApi) => {
  const response = await fetch("/api/me/organizations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    return thunkApi.rejectWithValue(await readApiError(response));
  }

  let createdOrganizationName: string | undefined;
  try {
    const result = (await response.json()) as {
      organization?: { name?: string };
    };
    createdOrganizationName = result.organization?.name;
  } catch {
    createdOrganizationName = undefined;
  }

  try {
    const me = await fetchMePayload();
    return {
      me,
      createdOrganizationName,
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to refresh topbar data";
    return thunkApi.rejectWithValue(message);
  }
});

const topbarSlice = createSlice({
  name: "topbar",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchTopbarData.pending, (state) => {
        if (!state.data) {
          state.status = "loading";
        }
        state.error = null;
      })
      .addCase(fetchTopbarData.fulfilled, (state, action) => {
        applyMeData(state, action.payload);
      })
      .addCase(fetchTopbarData.rejected, (state, action) => {
        state.status = "failed";
        state.error =
          action.payload ?? action.error.message ?? "Failed to load topbar data";
      })
      .addCase(switchTopbarOrganization.pending, (state) => {
        state.isSwitchingOrganization = true;
        state.error = null;
      })
      .addCase(switchTopbarOrganization.fulfilled, (state, action) => {
        state.isSwitchingOrganization = false;
        applyMeData(state, action.payload);
      })
      .addCase(switchTopbarOrganization.rejected, (state, action) => {
        state.isSwitchingOrganization = false;
        state.error =
          action.payload ?? action.error.message ?? "Failed to switch organization";
      })
      .addCase(createTopbarOrganization.pending, (state) => {
        state.isCreatingOrganization = true;
        state.error = null;
      })
      .addCase(createTopbarOrganization.fulfilled, (state, action) => {
        state.isCreatingOrganization = false;
        applyMeData(state, action.payload.me);
      })
      .addCase(createTopbarOrganization.rejected, (state, action) => {
        state.isCreatingOrganization = false;
        state.error =
          action.payload ?? action.error.message ?? "Failed to create organization";
      })
      .addCase(clearLoggedUser, () => initialState);
  },
});

export const selectTopbarState = (state: RootState) => state.topbar;
export const selectTopbarData = (state: RootState) => state.topbar.data;
export const selectTopbarStatus = (state: RootState) => state.topbar.status;
export const selectTopbarError = (state: RootState) => state.topbar.error;
export const selectTopbarUnreadCount = (state: RootState) =>
  state.topbar.data?.notifications.unreadCount ?? 0;
export const selectTopbarActiveOrganizationId = (state: RootState) =>
  state.topbar.data?.activeOrgId ?? null;
export const selectTopbarOrganizations = (state: RootState) =>
  state.topbar.data?.organizations ?? [];
export const selectTopbarOrganizationCreation = (state: RootState) =>
  state.topbar.data?.organizationCreation ?? {
    signupOrganizationName: null,
    canCreateFromSignupOrganization: false,
  };
export const selectTopbarUser = (state: RootState) =>
  state.topbar.data?.user ?? null;
export const selectIsSwitchingOrganization = (state: RootState) =>
  state.topbar.isSwitchingOrganization;
export const selectIsCreatingOrganization = (state: RootState) =>
  state.topbar.isCreatingOrganization;
export const selectTopbarOrganizationChangeVersion = (state: RootState) =>
  state.topbar.organizationChangeVersion;

export default topbarSlice.reducer;
