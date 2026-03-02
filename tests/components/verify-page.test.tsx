import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import VerifyPage from "@/app/(auth)/verify/page";

const pushMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
let queryCode = "123456";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
  useSearchParams: () => ({
    get: (key: string) => (key === "code" ? queryCode : null),
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

describe("Verify page", () => {
  beforeEach(() => {
    pushMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
    queryCode = "123456";
  });

  it("renders verify form", () => {
    render(<VerifyPage />);
    expect(screen.getByRole("heading", { name: "Verify your code" })).toBeVisible();
    expect(screen.getByLabelText("Verification code")).toBeVisible();
    expect(screen.getByRole("button", { name: "Verify code" })).toBeVisible();
  });

  it("shows true when entered code matches query code", async () => {
    const user = userEvent.setup();
    render(<VerifyPage />);

    await user.type(screen.getByLabelText("Verification code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify code" }));

    expect(await screen.findByTestId("verification-result")).toHaveTextContent(
      "true",
    );
    expect(toastSuccessMock).toHaveBeenCalledWith("Code verified");
  });

  it("shows false when entered code is incorrect", async () => {
    const user = userEvent.setup();
    render(<VerifyPage />);

    await user.type(screen.getByLabelText("Verification code"), "000000");
    await user.click(screen.getByRole("button", { name: "Verify code" }));

    expect(await screen.findByTestId("verification-result")).toHaveTextContent(
      "false",
    );
    expect(toastErrorMock).toHaveBeenCalledWith("false");
  });

  it("navigates to login", async () => {
    const user = userEvent.setup();
    render(<VerifyPage />);

    await user.click(screen.getByRole("button", { name: "Go to login" }));
    expect(pushMock).toHaveBeenCalledWith("/login");
  });
});
