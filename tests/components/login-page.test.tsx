import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "@/app/(auth)/login/page";

const pushMock = vi.fn();
const replaceMock = vi.fn();
const signInMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
const signInWithPasswordMock = vi.fn();
const getSessionMock = vi.fn();
const signOutMock = vi.fn();
const signInWithOAuthMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    replace: replaceMock,
  }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

vi.mock("next-auth/react", () => ({
  signIn: (...args: unknown[]) => signInMock(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      signInWithPassword: (...args: unknown[]) => signInWithPasswordMock(...args),
      getSession: (...args: unknown[]) => getSessionMock(...args),
      signOut: (...args: unknown[]) => signOutMock(...args),
      signInWithOAuth: (...args: unknown[]) => signInWithOAuthMock(...args),
    },
  },
}));

describe("Login page", () => {
  beforeEach(() => {
    pushMock.mockReset();
    replaceMock.mockReset();
    signInMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
    signInWithPasswordMock.mockReset();
    getSessionMock.mockReset();
    signOutMock.mockReset();
    signInWithOAuthMock.mockReset();
    window.history.pushState({}, "", "/login");
  });

  it("renders login form with Google sign-in button", () => {
    render(<LoginPage />);

    expect(screen.getByRole("heading", { name: "Welcome Back" })).toBeVisible();
    expect(screen.getByLabelText("Email")).toBeVisible();
    expect(screen.getByLabelText("Password")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Sign in with Google" }),
    ).toBeEnabled();
  });

  it("submits credentials and routes to home on success", async () => {
    signInWithPasswordMock.mockResolvedValue({
      data: { user: { id: "user-123", user_metadata: {} } },
      error: null,
    });
    getSessionMock.mockResolvedValue({
      data: {
        session: {
          access_token: "access-token-123",
          refresh_token: "refresh-token-123",
        },
      },
    });
    signInMock.mockResolvedValue({ ok: true, error: undefined });

    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByLabelText("Email"), "john@acme.com");
    await user.type(screen.getByLabelText("Password"), "secret123");
    await user.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(signInWithPasswordMock).toHaveBeenCalledWith({
        email: "john@acme.com",
        password: "secret123",
      });
    });

    await waitFor(() => {
      expect(signInMock).toHaveBeenCalledWith("supabase-token", {
        redirect: false,
        accessToken: "access-token-123",
        refreshToken: "refresh-token-123",
        mfaAssertion: undefined,
      });
    });

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/");
    });
    expect(toastSuccessMock).toHaveBeenCalledWith("Logged in successfully");
  });

  it("shows mapped error when credentials are invalid", async () => {
    signInWithPasswordMock.mockResolvedValue({
      data: { user: null },
      error: new Error("Invalid login credentials"),
    });

    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByLabelText("Email"), "john@acme.com");
    await user.type(screen.getByLabelText("Password"), "wrong-pass");
    await user.click(screen.getByRole("button", { name: "Sign In" }));

    expect(
      await screen.findByText("Invalid email or password"),
    ).toBeInTheDocument();
    expect(toastErrorMock).toHaveBeenCalledWith("Invalid email or password");
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("navigates to register when Create account is clicked", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(pushMock).toHaveBeenCalledWith("/register");
  });

  it("navigates to forgot-password when link is clicked", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.click(screen.getByRole("button", { name: "Forgot password?" }));

    expect(pushMock).toHaveBeenCalledWith("/forgot-password");
  });

  it("renders verified state from query string and supports immediate navigation", async () => {
    window.history.pushState({}, "", "/login?verified=true");
    const user = userEvent.setup();
    render(<LoginPage />);

    expect(await screen.findByText("Email Verified")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Continue to Login" }));
    expect(replaceMock).toHaveBeenCalledWith("/login");
  });
});
