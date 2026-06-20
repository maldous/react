import { test, expect } from "@playwright/test";

// V1C-06 — IdP claim-mapping admin UI semantics. A full-replace config: GET loads the mapping,
// rows are added/edited/removed client-side, and a single Save (PATCH) full-replaces the managed
// mappings. The journey keeps the real external-IdP limitation explicit (ADR-ACT-0220) and separate
// from these locally-proven UI semantics.
const url = (persona: string, state = "loaded") =>
  `/?capability=auth-claim-mapping&persona=${persona}&state=${state}`;

test("loads existing claim mappings and shows the external-IdP limitation notice", async ({
  page,
}) => {
  await page.goto(url("tenant-admin"));
  await expect(page.getByTestId("external-idp-notice")).toBeVisible();
  await expect(page.getByTestId("external-idp-notice")).toContainText("externally-limited proof");
  await expect(page.getByTestId("capability-row")).toHaveCount(2);
  await expect(page.getByRole("cell", { name: "email", exact: true }).first()).toBeVisible();
});

test("shows the empty state when no mappings are configured", async ({ page }) => {
  await page.goto(url("tenant-admin", "empty"));
  await expect(page.getByTestId("empty-mappings")).toBeVisible();
});

test("adds a valid mapping client-side", async ({ page }) => {
  await page.goto(url("tenant-admin"));
  await page.getByTestId("action-add").click();
  await page.getByTestId("field-upstreamClaim").fill("family_name");
  await page.getByTestId("field-userAttribute").fill("lastName");
  await page.getByTestId("form-submit").click();
  await expect(page.getByTestId("capability-row")).toHaveCount(3);
});

test("rejects an incomplete mapping with an accessibly-associated error", async ({ page }) => {
  await page.goto(url("tenant-admin"));
  await page.getByTestId("action-add").click();
  await page.getByTestId("field-upstreamClaim").fill("only_claim");
  await page.getByTestId("field-userAttribute").fill("");
  await page.getByTestId("form-submit").click();
  await expect(page.getByTestId("field-userAttribute")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("User attribute is required")).toBeVisible();
});

test("rejects a duplicate claim client-side (conflict)", async ({ page }) => {
  await page.goto(url("tenant-admin"));
  await page.getByTestId("action-add").click();
  await page.getByTestId("field-upstreamClaim").fill("email");
  await page.getByTestId("field-userAttribute").fill("email");
  await page.getByTestId("form-submit").click();
  await expect(page.getByText("This claim is already mapped")).toBeVisible();
});

test("removes a mapping client-side", async ({ page }) => {
  await page.goto(url("tenant-admin"));
  await expect(page.getByTestId("capability-row")).toHaveCount(2);
  await page.getByTestId("row-remove-mapping").first().click();
  await expect(page.getByTestId("capability-row")).toHaveCount(1);
});

test("saves the full mapping config and announces success", async ({ page }) => {
  await page.goto(url("tenant-admin"));
  await page.getByTestId("action-save").click();
  await expect(page.getByTestId("live-announcer")).toContainText("Mappings saved");
});

test("surfaces a server conflict when saving", async ({ page }) => {
  await page.goto(url("tenant-admin"));
  await page.getByTestId("action-add").click();
  await page.getByTestId("field-upstreamClaim").fill("conflict-claim");
  await page.getByTestId("field-userAttribute").fill("whatever");
  await page.getByTestId("form-submit").click();
  await page.getByTestId("action-save").click();
  await expect(page.getByTestId("save-error")).toContainText("already mapped on the server");
});

test("surfaces a server failure when saving", async ({ page }) => {
  await page.goto(url("tenant-admin"));
  await page.getByTestId("action-add").click();
  await page.getByTestId("field-upstreamClaim").fill("trigger-error");
  await page.getByTestId("field-userAttribute").fill("whatever");
  await page.getByTestId("form-submit").click();
  await page.getByTestId("action-save").click();
  await expect(page.getByTestId("save-error")).toContainText("could not save");
});

test("denies a persona without read permission", async ({ page }) => {
  await page.goto(url("no-access"));
  await expect(page.getByText("Access denied")).toBeVisible();
  await expect(page.getByTestId("capability-table")).toHaveCount(0);
});

test("is read-only for a persona without write permission", async ({ page }) => {
  await page.goto(url("tenant-viewer"));
  await expect(page.getByTestId("capability-table")).toBeVisible();
  await expect(page.getByTestId("action-add")).toHaveCount(0);
  await expect(page.getByTestId("action-save")).toHaveCount(0);
});

test("completes an add using the keyboard only", async ({ page }) => {
  await page.goto(url("tenant-admin"));
  await page.getByTestId("action-add").focus();
  await page.keyboard.press("Enter");
  await page.getByTestId("field-upstreamClaim").focus();
  await page.keyboard.type("locale");
  await page.getByTestId("field-userAttribute").focus();
  await page.keyboard.type("locale");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("capability-row")).toHaveCount(3);
});
