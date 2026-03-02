import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ForgotPasswordPage from "@/app/(auth)/forgot-password/page";
import { FORGOT_PASSWORD_SUCCESS_MESSAGE } from "@/app/(auth)/forgot-password/forgot-password-flow";

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

describe("Forgot password page", () => {
  beforeEach(() => {
    pushMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    window.history.pushState({}, "", "/forgot-password");
  });

  it("renders forgot-password form", () => {
    render(<ForgotPasswordPage />);

    expect(
      screen.getByRole("heading", { name: "Forgot your password?" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Email")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Send reset link" }),
    ).toBeVisible();
  });

  it("submits email and shows success state", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ message: FORGOT_PASSWORD_SUCCESS_MESSAGE }),
    });

    const user = userEvent.setup();
    render(<ForgotPasswordPage />);

    await user.type(screen.getByLabelText("Email"), " John@Acme.COM ");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "john@acme.com" }),
      });
    });

    expect(await screen.findByText("Check your inbox")).toBeInTheDocument();
    expect(toastSuccessMock).toHaveBeenCalledWith(
      FORGOT_PASSWORD_SUCCESS_MESSAGE,
    );
  });

  it("shows API error and toast on failure", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Unable to process request" }),
    });

    const user = userEvent.setup();
    render(<ForgotPasswordPage />);

    await user.type(screen.getByLabelText("Email"), "john@acme.com");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByText("Unable to process request")).toBeInTheDocument();
    expect(toastErrorMock).toHaveBeenCalledWith("Unable to process request");
  });

  it("navigates to login from inline link", async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordPage />);

    await user.click(screen.getByRole("button", { name: "Go to login" }));
    expect(pushMock).toHaveBeenCalledWith("/login");
  });
});
