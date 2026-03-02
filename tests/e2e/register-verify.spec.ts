import { expect, test } from "@playwright/test";

test.describe("Register flow", () => {
  test("shows disabled Google sign-in label", async ({ page }) => {
    await page.goto("/register");
    await expect(
      page.getByRole("button", { name: "Google sign-in (coming soon)" }),
    ).toBeDisabled();
  });

  test("shows mismatch error when passwords differ", async ({ page }) => {
    await page.goto("/register");

    await page.getByLabel("First Name").fill("John");
    await page.getByLabel("Last Name").fill("Doe");
    await page.getByLabel("Work Email").fill("john@acme.com");
    await page.getByLabel("Password", { exact: true }).fill("secret123");
    await page.getByLabel("Confirm Password").fill("secret321");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByText("Passwords do not match")).toBeVisible();
  });

  test("registers successfully and routes to login", async ({ page }) => {
    await page.route("**/api/auth/register", async (route) => {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ message: "User created successfully" }),
      });
    });

    await page.goto("/register");

    await page.getByLabel("First Name").fill("John");
    await page.getByLabel("Last Name").fill("Doe");
    await page.getByLabel("Company / Organization").fill("Acme");
    await page.getByLabel("Work Email").fill("john@acme.com");
    await page.getByLabel("Password", { exact: true }).fill("secret123");
    await page.getByLabel("Confirm Password").fill("secret123");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page).toHaveURL(/\/login$/);
  });

  test("shows API error when registration fails", async ({ page }) => {
    await page.route("**/api/auth/register", async (route) => {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "Registration failed" }),
      });
    });

    await page.goto("/register");

    await page.getByLabel("First Name").fill("John");
    await page.getByLabel("Last Name").fill("Doe");
    await page.getByLabel("Work Email").fill("john@acme.com");
    await page.getByLabel("Password", { exact: true }).fill("secret123");
    await page.getByLabel("Confirm Password").fill("secret123");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.locator("form").getByText("Registration failed")).toBeVisible();
  });
});

test.describe("Verify flow", () => {
  test("shows false when code is incorrect", async ({ page }) => {
    await page.goto("/verify?code=123456");
    await page.getByLabel("Verification code").fill("000000");
    await page.getByRole("button", { name: "Verify code" }).click();

    await expect(page.getByTestId("verification-result")).toHaveText("false");
  });

  test("shows true when code is correct", async ({ page }) => {
    await page.goto("/verify?code=123456");
    await page.getByLabel("Verification code").fill("123456");
    await page.getByRole("button", { name: "Verify code" }).click();

    await expect(page.getByTestId("verification-result")).toHaveText("true");
  });
});
