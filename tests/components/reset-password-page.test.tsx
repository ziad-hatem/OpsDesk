import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ResetPasswordPage from "@/app/(auth)/reset-password/page";

const pushMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
const setSessionMock = vi.fn();
const updateUserMock = vi.fn();

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

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      setSession: (...args: unknown[]) => setSessionMock(...args),
      updateUser: (...args: unknown[]) => updateUserMock(...args),
    },
  },
}));

describe("Reset password page", () => {
  beforeEach(() => {
    pushMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
    setSessionMock.mockReset();
    updateUserMock.mockReset();
  });

  it("shows invalid link state when recovery tokens are missing", async () => {
    window.history.pushState({}, "", "/reset-password");
    render(<ResetPasswordPage />);

    expect(
      await screen.findByText("This reset link is invalid or expired."),
    ).toBeInTheDocument();
  });

  it("updates password and redirects to login when link and form are valid", async () => {
    setSessionMock.mockResolvedValue({ error: null });
    updateUserMock.mockResolvedValue({ error: null });

    window.history.pushState(
      {},
      "",
      "/reset-password#type=recovery&access_token=access-123&refresh_token=refresh-123",
    );
    const user = userEvent.setup();
    render(<ResetPasswordPage />);

    await waitFor(() => {
      expect(setSessionMock).toHaveBeenCalledWith({
        access_token: "access-123",
        refresh_token: "refresh-123",
      });
    });

    await user.type(screen.getByLabelText("New Password"), "secret123");
    await user.type(screen.getByLabelText("Confirm Password"), "secret123");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() => {
      expect(updateUserMock).toHaveBeenCalledWith({ password: "secret123" });
    });
    expect(toastSuccessMock).toHaveBeenCalledWith("Password updated successfully");
    expect(pushMock).toHaveBeenCalledWith("/login");
  });

  it("shows mismatch error when passwords differ", async () => {
    setSessionMock.mockResolvedValue({ error: null });

    window.history.pushState(
      {},
      "",
      "/reset-password#type=recovery&access_token=access-123&refresh_token=refresh-123",
    );
    const user = userEvent.setup();
    render(<ResetPasswordPage />);

    await waitFor(() => {
      expect(setSessionMock).toHaveBeenCalled();
    });

    await user.type(screen.getByLabelText("New Password"), "secret123");
    await user.type(screen.getByLabelText("Confirm Password"), "secret321");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("Passwords do not match")).toBeInTheDocument();
    expect(updateUserMock).not.toHaveBeenCalled();
  });
});
