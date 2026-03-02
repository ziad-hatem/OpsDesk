import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RegisterPage from "@/app/(auth)/register/page";

const pushMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
const fetchMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

describe("Register page", () => {
  beforeEach(() => {
    pushMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    window.history.pushState({}, "", "/register");
  });

  it("renders register form with disabled Google sign-in label", () => {
    render(<RegisterPage />);

    expect(
      screen.getByRole("heading", { name: "Create an account" }),
    ).toBeVisible();
    expect(screen.getByLabelText("First Name")).toBeVisible();
    expect(screen.getByLabelText("Work Email")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Google sign-in (coming soon)" }),
    ).toBeDisabled();
  });

  it("shows mismatch error and does not call API when passwords are different", async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);

    await user.type(screen.getByLabelText("First Name"), "John");
    await user.type(screen.getByLabelText("Last Name"), "Doe");
    await user.type(screen.getByLabelText("Work Email"), "john@acme.com");
    await user.type(screen.getByLabelText("Password"), "secret123");
    await user.type(screen.getByLabelText("Confirm Password"), "secret321");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Passwords do not match")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submits registration and redirects to login on success", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ message: "ok" }),
    });

    const user = userEvent.setup();
    render(<RegisterPage />);

    await user.type(screen.getByLabelText("First Name"), "John");
    await user.type(screen.getByLabelText("Last Name"), "Doe");
    await user.type(screen.getByLabelText("Company / Organization"), "Acme");
    await user.type(screen.getByLabelText("Work Email"), "john@acme.com");
    await user.type(screen.getByLabelText("Password"), "secret123");
    await user.type(screen.getByLabelText("Confirm Password"), "secret123");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "john@acme.com",
          password: "secret123",
          firstName: "John",
          lastName: "Doe",
          company: "Acme",
        }),
      });
    });

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/login");
    });
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "Account created! Check your email to verify.",
    );
  });

  it("shows API error and toast when registration fails", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Registration failed" }),
    });

    const user = userEvent.setup();
    render(<RegisterPage />);

    await user.type(screen.getByLabelText("First Name"), "John");
    await user.type(screen.getByLabelText("Last Name"), "Doe");
    await user.type(screen.getByLabelText("Work Email"), "john@acme.com");
    await user.type(screen.getByLabelText("Password"), "secret123");
    await user.type(screen.getByLabelText("Confirm Password"), "secret123");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Registration failed")).toBeInTheDocument();
    expect(toastErrorMock).toHaveBeenCalledWith("Registration failed");
  });

  it("navigates to login when Sign in is clicked", async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);

    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(pushMock).toHaveBeenCalledWith("/login");
  });
});
