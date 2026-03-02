import { expect, test } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4173";

test.describe("Login flow", () => {
  test("shows disabled Google sign-in and can navigate to register", async ({
    page,
  }) => {
    await page.goto("/login");

    await expect(
      page.getByRole("button", { name: "Google sign-in (coming soon)" }),
    ).toBeDisabled();

    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/register$/);
  });

  test("can navigate to forgot-password page from login", async ({ page }) => {
    await page.goto("/login");

    await page.getByRole("button", { name: "Forgot password?" }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
  });

  test("logs in successfully with mocked credentials callback", async ({
    page,
  }) => {
    await page.route("**/api/auth/callback/credentials**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          url: `${baseURL}/`,
        }),
      });
    });

    await page.goto("/login");
    await page.getByLabel("Email").fill("john@acme.com");
    await page.getByLabel("Password").fill("secret123");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(`${baseURL}/`);
  });

  test("shows invalid credentials error from mocked callback", async ({
    page,
  }) => {
    await page.route("**/api/auth/callback/credentials**", async (route) => {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          url: `${baseURL}/login?error=CredentialsSignin&code=credentials`,
        }),
      });
    });

    await page.goto("/login");
    await page.getByLabel("Email").fill("john@acme.com");
    await page.getByLabel("Password").fill("wrongpass");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(
      page.locator("form").getByText("Invalid email or password"),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("renders verification success state from query param", async ({ page }) => {
    await page.goto("/login?verified=true");

    await expect(page.getByText("Email Verified!")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Go to login now" }),
    ).toBeVisible();
  });
});

test.describe("Forgot password flow", () => {
  test("submits forgot-password form and shows success state", async ({
    page,
  }) => {
    await page.route("**/api/auth/forgot-password", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          message:
            "If an account exists for that email, a password reset link has been sent.",
        }),
      });
    });

    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill("john@acme.com");
    await page.getByRole("button", { name: "Send reset link" }).click();

    await expect(page.getByText("Check your inbox")).toBeVisible();
    await expect(
      page
        .locator("[data-slot='card-description']")
        .getByText(
          "If an account exists for that email, a password reset link has been sent.",
        ),
    ).toBeVisible();
  });
});
