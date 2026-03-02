import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "@/app/(auth)/login/page";

const pushMock = vi.fn();
const replaceMock = vi.fn();
const signInMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    replace: replaceMock,
  }),
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

describe("Login page", () => {
  beforeEach(() => {
    pushMock.mockReset();
    replaceMock.mockReset();
    signInMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
    window.history.pushState({}, "", "/login");
  });

  it("renders login form with disabled Google sign-in label", () => {
    render(<LoginPage />);

    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    expect(screen.getByLabelText("Email")).toBeVisible();
    expect(screen.getByLabelText("Password")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Google sign-in (coming soon)" }),
    ).toBeDisabled();
  });

  it("submits credentials and routes to home on success", async () => {
    signInMock.mockResolvedValue({ ok: true, error: undefined });

    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByLabelText("Email"), "john@acme.com");
    await user.type(screen.getByLabelText("Password"), "secret123");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(signInMock).toHaveBeenCalledWith("credentials", {
        redirect: false,
        email: "john@acme.com",
        password: "secret123",
      });
    });

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/");
    });
    expect(toastSuccessMock).toHaveBeenCalledWith("Logged in successfully");
  });

  it("shows mapped error when credentials are invalid", async () => {
    signInMock.mockResolvedValue({ ok: false, error: "CredentialsSignin" });

    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByLabelText("Email"), "john@acme.com");
    await user.type(screen.getByLabelText("Password"), "wrong-pass");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

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

    expect(await screen.findByText("Email Verified!")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Go to login now" }));
    expect(replaceMock).toHaveBeenCalledWith("/login");
  });
});
