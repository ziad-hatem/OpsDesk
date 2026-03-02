import { configureStore } from "@reduxjs/toolkit";
import authReducer from "./slices/auth-slice";
import ticketsReducer from "./slices/tickets-slice";
import topbarReducer from "./slices/topbar-slice";

export const store = configureStore({
  reducer: {
    auth: authReducer,
    tickets: ticketsReducer,
    topbar: topbarReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
