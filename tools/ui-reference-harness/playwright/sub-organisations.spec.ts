import { test, expect } from "@playwright/test";

// V1C-02 — Sub-organisations UI semantic journey. Sub-orgs are a FLAT tenant-scoped list (no
// parent_id, no hierarchy/tree/nesting — that is internal-only and not exposed by the API). Driven
// entirely by the declarative `sub-organisations` harness record + MSW fixtures.
const url = (persona: string, state = "loaded") =>
  `/?capability=sub-organisations&persona=${persona}&state=${state}`;

test("loads the flat sub-organisation list", async ({ page }) => {
  await page.goto(url("tenant-admin"));
  await expect(page.getByTestId("capability-table")).toBeVisible();
  await expect(page.getByTestId("capability-row")).toHaveCount(2);
  await expect(page.getByRole("cell", { name: "north-region", exact: true })).toBeVisible();
});

test("shows the empty state", async ({ page }) => {
  await page.goto(url("tenant-admin", "empty"));
  await expect(page.getByText("No sub-organisations yet")).toBeVisible();
});

test("creates a valid sub-organisation and announces success", async ({ page }) => {
  await page.goto(url("tenant-admin"));
  await page.getByTestId("action-create").click();
  await page.getByTestId("field-slug").fill("east-region");
  await page.getByTestId("field-displayName").fill("East Region");
  await page.getByTestId("form-submit").click();
  await expect(page.getByTestId("live-announcer")).toContainText("Sub-organisation created");
});

test("rejects an invalid slug with an accessibly-associated error", async ({ page }) => {
  await page.goto(url("tenant-admin"));
  await page.getByTestId("action-create").click();
  await page.getByTestId("field-slug").fill("Not A Slug");
  await page.getByTestId("field-displayName").fill("Valid Name");
  await page.getByTestId("form-submit").click();
  await expect(page.getByTestId("field-slug")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Slug has an invalid format")).toBeVisible();
});

test("surfaces a server slug-conflict on the field", async ({ page }) => {
  await page.goto(url("tenant-admin"));
  await page.getByTestId("action-create").click();
  await page.getByTestId("field-slug").fill("taken");
  await page.getByTestId("field-displayName").fill("Duplicate");
  await page.getByTestId("form-submit").click();
  await expect(page.getByTestId("field-slug")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("A sub-organisation with this slug already exists")).toBeVisible();
});

test("edits a sub-organisation display name and announces success", async ({ page }) => {
  await page.goto(url("tenant-admin"));
  await page.getByTestId("row-update-sub-org").first().click();
  await expect(page.getByTestId("edit-form")).toBeVisible();
  await page.getByTestId("field-displayName").fill("North Region (EMEA)");
  await page.getByTestId("form-submit").click();
  await expect(page.getByTestId("live-announcer")).toContainText("Sub-organisation updated");
});

test("deletes a sub-organisation via a focus-trapped confirmation", async ({ page }) => {
  await page.goto(url("tenant-admin"));
  await expect(page.getByTestId("capability-row")).toHaveCount(2);
  await page.getByTestId("row-delete-sub-org").first().click();
  await expect(page.getByTestId("confirm-delete")).toHaveAttribute("role", "alertdialog");
  await expect(page.getByTestId("confirm-delete-yes")).toBeFocused();
  await page.getByTestId("confirm-delete-yes").click();
  await expect(page.getByTestId("live-announcer")).toContainText("Sub-organisation deleted");
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
  await page.getByTestId("field-slug").focus();
  await page.keyboard.type("west-region");
  await page.getByTestId("field-displayName").focus();
  await page.keyboard.type("West Region");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("live-announcer")).toContainText("Sub-organisation created");
});
