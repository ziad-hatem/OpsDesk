import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "../store";

export interface LoggedUser {
  email: string;
  name: string | null;
}

interface AuthState {
  user: LoggedUser | null;
  isAuthenticated: boolean;
}

const initialState: AuthState = {
  user: null,
  isAuthenticated: false,
};

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    setLoggedUser: (state, action: PayloadAction<LoggedUser>) => {
      state.user = action.payload;
      state.isAuthenticated = true;
    },
    clearLoggedUser: (state) => {
      state.user = null;
      state.isAuthenticated = false;
    },
  },
});

export const { setLoggedUser, clearLoggedUser } = authSlice.actions;

export const selectAuthState = (state: RootState) => state.auth;
export const selectLoggedUser = (state: RootState) => state.auth.user;
export const selectIsAuthenticated = (state: RootState) =>
  state.auth.isAuthenticated;

export default authSlice.reducer;
