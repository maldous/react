/**
 * Production build smoke tests.
 *
 * These tests run against `vite preview` (the built production bundle) not the
 * dev server. They catch failures that only appear in the production build:
 *
 * - Missing CSS imports (globals.css not wired up)
 * - React dedupe failures (duplicate React instance in bundle)
 * - Asset loading failures (broken chunk references)
 * - Bundle split problems
 *
 * ADR-0025 gap: standard dev E2E tests use the Vite dev server.
 * This suite targets the production bundle (playwright.build.config.ts).
 *
 * Run: make e2e-dev-build
 */
import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Production build health — the things that fail silently in production only
// ---------------------------------------------------------------------------

test.describe("production build: React mounts correctly", () => {
  test("#root is not empty (React mounts without errors)", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // React must have mounted — #root must have children
    const root = page.locator("#root");
    await expect(root).not.toBeEmpty({ timeout: 10000 });

    expect(errors, `JS errors in production build: ${errors.join(", ")}`).toHaveLength(0);
  });

  test("no JavaScript errors on page load (catches React dedupe and hook failures)", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    expect(
      errors,
      `Production build has JS errors — common causes: React loaded twice, ` +
        `missing resolve.dedupe, or a hook called outside a component.\n` +
        `Errors: ${errors.join(", ")}`
    ).toHaveLength(0);
  });

  test("visible heading renders (page is not a white screen)", async ({ page }) => {
    await page.goto("/");
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible({ timeout: 10000 });
  });
});

test.describe("production build: CSS and assets load", () => {
  test("all JS and CSS assets return HTTP 200", async ({ page }) => {
    const failedAssets: string[] = [];
    page.on("response", (res) => {
      const url = res.url();
      if (
        url.includes("/assets/") &&
        (url.endsWith(".js") || url.endsWith(".css")) &&
        res.status() !== 200
      ) {
        failedAssets.push(`${res.status()} ${url}`);
      }
    });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    expect(failedAssets, `Failed assets: ${failedAssets.join(", ")}`).toHaveLength(0);
  });

  test("CSS is applied — heading has non-zero bounding box (catches missing CSS import)", async ({
    page,
  }) => {
    await page.goto("/");
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible();
    const box = await heading.boundingBox();
    expect(box, "Heading has no bounding box — CSS may not be loaded").not.toBeNull();
    expect(box!.height, "Heading height is zero — Tailwind CSS not applied").toBeGreaterThan(0);
  });
});

test.describe("production build: routing and API proxy", () => {
  test("client-side routing works — deep route renders SPA", async ({ page }) => {
    await page.goto("/organisation/profile");
    const root = page.locator("#root");
    await expect(root).not.toBeEmpty({ timeout: 10000 });
  });

  test("API proxy works in preview mode — /api/session responds", async ({ request }) => {
    const res = await request.get("/api/session");
    expect(res.status()).toBe(200);
    const body = await res.json();
    // Fixture session should be active
    expect(typeof body.userId).toBe("string");
    expect(Array.isArray(body.roles)).toBe(true);
  });

  test("organisation profile loads with fixture tenant-admin", async ({ page }) => {
    await page.goto("/organisation/profile");
    await expect(page.getByTestId("organisation-profile")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("profile-edit-form")).toBeVisible();
  });
});
