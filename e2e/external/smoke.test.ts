import { test, expect } from "@playwright/test";
import { getExternalBaseUrl } from "./helpers.ts";

// ---------------------------------------------------------------------------
// Infrastructure layer — direct API health checks (no auth required)
// ---------------------------------------------------------------------------

test.describe("infrastructure: API endpoints", () => {
  test("GET /healthz returns {status: ok}", async ({ request }) => {
    const res = await request.get(
      new URL("/healthz", process.env["PROD_BASE_URL"] ?? "http://aldous.info").toString()
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  test("GET /readyz returns database ready", async ({ request }) => {
    const res = await request.get(
      new URL("/readyz", process.env["PROD_BASE_URL"] ?? "http://aldous.info").toString()
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ready");
    expect(body.dependencies?.database).toBe("ok");
  });

  test("GET /version returns version metadata", async ({ request }) => {
    const res = await request.get(
      new URL("/version", process.env["PROD_BASE_URL"] ?? "http://aldous.info").toString()
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.version).toBe("string");
    expect(typeof body.environment).toBe("string");
  });

  test("GET /api/session returns 401 for unauthenticated request", async ({ request }) => {
    const res = await request.get(
      new URL("/api/session", process.env["PROD_BASE_URL"] ?? "http://aldous.info").toString()
    );
    expect(res.status()).toBe(401);
  });

  test("API response has X-Request-Id header", async ({ request }) => {
    const res = await request.get(
      new URL("/healthz", process.env["PROD_BASE_URL"] ?? "http://aldous.info").toString()
    );
    expect(res.headers()["x-request-id"]).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// SPA layer — browser tests proving the page is not white
// ---------------------------------------------------------------------------

test.describe("SPA: page loads with visible content", () => {
  test("homepage renders with visible heading (not a white page)", async ({ page }) => {
    await page.goto(new URL("/", getExternalBaseUrl(page)).toString());
    const root = page.locator("#root");
    await expect(root).not.toBeEmpty({ timeout: 10000 });
    const heading = page.getByRole("heading", { name: /platform/i });
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test("Tailwind CSS is loaded — heading has non-zero bounding box", async ({ page }) => {
    await page.goto(new URL("/", getExternalBaseUrl(page)).toString());
    await page.waitForLoadState("networkidle");
    const heading = page.getByRole("heading", { name: /platform/i });
    await expect(heading).toBeVisible();
    const box = await heading.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThan(0);
    expect(box!.width).toBeGreaterThan(0);
  });

  test("no JavaScript errors on page load", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto(new URL("/", getExternalBaseUrl(page)).toString());
    await page.waitForLoadState("networkidle");
    expect(errors, `JS errors on page load: ${errors.join(", ")}`).toHaveLength(0);
  });

  test("JS bundle and CSS assets load with 200 status", async ({ page }) => {
    const failedAssets: string[] = [];
    page.on("response", (res) => {
      if ((res.url().includes(".js") || res.url().includes(".css")) && res.status() !== 200) {
        failedAssets.push(`${res.status()} ${res.url()}`);
      }
    });
    await page.goto(new URL("/", getExternalBaseUrl(page)).toString());
    await page.waitForLoadState("networkidle");
    expect(failedAssets, `Failed assets: ${failedAssets.join(", ")}`).toHaveLength(0);
  });

  test("unauthenticated homepage shows sign-in entry point", async ({ page }) => {
    await page.goto(new URL("/", getExternalBaseUrl(page)).toString());
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("sign-in-entry")).toBeVisible({ timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// Routing — Caddy SPA fallback works for deep routes
// ---------------------------------------------------------------------------

test.describe("routing: SPA fallback", () => {
  test("deep route returns 200 not 404 (Caddy try_files)", async ({ request }) => {
    const res = await request.get(
      new URL(
        "/organisation/profile",
        process.env["PROD_BASE_URL"] ?? "http://aldous.info"
      ).toString()
    );
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain("<title>Enterprise Platform</title>");
  });

  test("unknown route still serves the SPA", async ({ request }) => {
    const res = await request.get(
      new URL(
        "/this-route-does-not-exist",
        process.env["PROD_BASE_URL"] ?? "http://aldous.info"
      ).toString()
    );
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('<div id="root">');
  });
});

// ---------------------------------------------------------------------------
// Security — ADR-0022 token boundary is live
// ---------------------------------------------------------------------------

test.describe("security: token boundary", () => {
  test("session cookie is HTTP-only (not accessible via document.cookie)", async ({ page }) => {
    await page.goto(new URL("/", getExternalBaseUrl(page)).toString());
    await page.waitForLoadState("networkidle");
    const cookieValue = await page.evaluate(() => document.cookie);
    expect(cookieValue).not.toContain("platform_session");
  });

  test("API response does not expose access or refresh tokens", async ({ request }) => {
    const res = await request.get(
      new URL("/api/session", process.env["PROD_BASE_URL"] ?? "http://aldous.info").toString()
    );
    const body = await res.text();
    expect(body).not.toContain("accessToken");
    expect(body).not.toContain("refreshToken");
    expect(body).not.toContain("access_token");
    expect(body).not.toContain("refresh_token");
  });
});
