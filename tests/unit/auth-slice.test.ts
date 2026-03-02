import { describe, expect, it } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import authReducer, {
  clearLoggedUser,
  selectIsAuthenticated,
  selectLoggedUser,
  setLoggedUser,
} from "@/lib/store/slices/auth-slice";

describe("auth slice", () => {
  it("starts with unauthenticated state", () => {
    const store = configureStore({
      reducer: {
        auth: authReducer,
      },
    });

    expect(selectIsAuthenticated(store.getState())).toBe(false);
    expect(selectLoggedUser(store.getState())).toBeNull();
  });

  it("stores logged user details when setLoggedUser is dispatched", () => {
    const store = configureStore({
      reducer: {
        auth: authReducer,
      },
    });

    store.dispatch(
      setLoggedUser({
        email: "john@acme.com",
        name: "John Doe",
      }),
    );

    expect(selectIsAuthenticated(store.getState())).toBe(true);
    expect(selectLoggedUser(store.getState())).toEqual({
      email: "john@acme.com",
      name: "John Doe",
    });
  });

  it("clears state when clearLoggedUser is dispatched", () => {
    const store = configureStore({
      reducer: {
        auth: authReducer,
      },
      preloadedState: {
        auth: {
          user: {
            email: "john@acme.com",
            name: "John Doe",
          },
          isAuthenticated: true,
        },
      },
    });

    store.dispatch(clearLoggedUser());

    expect(selectIsAuthenticated(store.getState())).toBe(false);
    expect(selectLoggedUser(store.getState())).toBeNull();
  });
});
