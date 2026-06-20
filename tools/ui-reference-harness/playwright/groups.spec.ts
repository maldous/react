import { test, expect } from "@playwright/test";

// V1C-01 — Tenant groups UI semantic journey, driven entirely by the declarative `groups` harness
// record + its MSW fixtures (no product screen, no live BFF). Proves the full CRUD semantics,
// permission gating, validation, server failure, keyboard operation and accessible announcements.
const url = (persona: string, state = "loaded") =>
  `/?capability=groups&persona=${persona}&state=${state}`;

test("loads the group list from the declared contract", async ({ page }) => {
  await page.goto(url("tenant-admin"));
  await expect(page.getByRole("heading", { name: "groups" })).toBeVisible();
  await expect(page.getByTestId("capability-table")).toBeVisible();
  await expect(page.getByTestId("capability-row")).toHaveCount(2);
  await expect(page.getByRole("cell", { name: "Engineering", exact: true })).toBeVisible();
});

test("shows the empty state when there are no groups", async ({ page }) => {
  await page.goto(url("tenant-admin", "empty"));
  await expect(page.getByText("No groups yet")).toBeVisible();
});

test("creates a valid group and announces success politely", async ({ page }) => {
  await page.goto(url("tenant-admin"));
  await page.getByTestId("action-create").click();
  await expect(page.getByTestId("create-form")).toBeVisible();
  await page.getByTestId("field-name").fill("Platform");
  await page.getByTestId("form-submit").click();
  const live = page.getByTestId("live-announcer");
  await expect(live).toHaveAttribute("aria-live", "polite");
  await expect(live).toContainText("Group created");
  await expect(page.getByTestId("create-form")).toHaveCount(0);
});

test("rejects an invalid (empty) group with an accessibly-associated error", async ({ page }) => {
  await page.goto(url("tenant-admin"));
  await page.getByTestId("action-create").click();
  await page.getByTestId("field-name").fill("");
  await page.getByTestId("form-submit").click();
  const input = page.getByTestId("field-name");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Group name is required")).toBeVisible();
  // client validation must NOT have announced success
  await expect(page.getByTestId("live-announcer")).not.toContainText("Group created");
});

test("surfaces a server validation error (409-style conflict) on the field", async ({ page }) => {
  await page.goto(url("tenant-admin"));
  await page.getByTestId("action-create").click();
  await page.getByTestId("field-name").fill("taken");
  await page.getByTestId("form-submit").click();
  await expect(page.getByTestId("field-name")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("A group with this name already exists")).toBeVisible();
});

test("edits a group and announces success", async ({ page }) => {
  await page.goto(url("tenant-admin"));
  await page.getByTestId("row-update-group").first().click();
  await expect(page.getByTestId("edit-form")).toBeVisible();
  await page.getByTestId("field-name").fill("Engineering Renamed");
  await page.getByTestId("form-submit").click();
  await expect(page.getByTestId("live-announcer")).toContainText("Group updated");
});

test("deletes a group via a focus-trapped confirmation", async ({ page }) => {
  await page.goto(url("tenant-admin"));
  await expect(page.getByTestId("capability-row")).toHaveCount(2);
  await page.getByTestId("row-delete-group").first().click();
  const dialog = page.getByTestId("confirm-delete");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("role", "alertdialog");
  // confirm button is auto-focused (keyboard-operable confirmation)
  await expect(page.getByTestId("confirm-delete-yes")).toBeFocused();
  await page.getByTestId("confirm-delete-yes").click();
  await expect(page.getByTestId("live-announcer")).toContainText("Group deleted");
  await expect(page.getByTestId("capability-row")).toHaveCount(1);
});

test("denies a persona without read permission", async ({ page }) => {
  await page.goto(url("no-access"));
  await expect(page.getByText("Access denied")).toBeVisible();
  await expect(page.getByTestId("capability-table")).toHaveCount(0);
});

test("hides create for a read-only persona", async ({ page }) => {
  await page.goto(url("tenant-viewer"));
  await expect(page.getByTestId("capability-table")).toBeVisible();
  await expect(page.getByTestId("action-create")).toHaveCount(0);
});

test("shows the error state on a server failure", async ({ page }) => {
  await page.goto(url("tenant-admin", "serverError"));
  await expect(page.getByText("Something went wrong")).toBeVisible();
});

test("completes a create using the keyboard only", async ({ page }) => {
  await page.goto(url("tenant-admin"));
  await page.getByTestId("action-create").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("create-form")).toBeVisible();
  await page.getByTestId("field-name").focus();
  await page.keyboard.type("Keyboard Group");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("live-announcer")).toContainText("Group created");
});
