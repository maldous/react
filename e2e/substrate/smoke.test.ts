import { test, expect } from "@playwright/test";

/**
 * Platform substrate E2E smoke tests.
 * Tests browser → React SPA → platform-api → browser roundtrip.
 * Uses deterministic fixture session (LOCAL_FIXTURE_SESSION=tenant-admin on platform-api).
 * Does not require real Keycloak login (blocked until ADR-ACT-0110).
 *
 * Evidence for: ADR-ACT-0112, ADR-ACT-0114, ADR-ACT-0115
 */

const API_URL = `http://localhost:${process.env["PLATFORM_API_PORT"] ?? "3001"}`;

test.describe("platform-api health substrate", () => {
  test("GET /healthz returns ok", async ({ request }) => {
    const res = await request.get(`${API_URL}/healthz`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  test("GET /version returns version metadata", async ({ request }) => {
    const res = await request.get(`${API_URL}/version`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.version).toBe("string");
    expect(typeof body.environment).toBe("string");
  });

  test("GET /api/session returns tenant-admin fixture actor", async ({ request }) => {
    const res = await request.get(`${API_URL}/api/session`);
    expect(res.status()).toBe(200);
    const actor = await res.json();
    expect(actor.roles).toContain("tenant-admin");
    expect(actor.permissions).toContain("organisation.read");
    expect(actor.permissions).toContain("organisation.update");
    expect(typeof actor.userId).toBe("string");
    expect(typeof actor.tenantId).toBe("string");
  });
});

test.describe("React SPA substrate", () => {
  test("index page loads", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("body")).toBeVisible();
    // Index page should show the platform heading
    await expect(page.getByRole("heading", { name: "Platform" })).toBeVisible();
  });

  test("/auth/login renders sign in heading", async ({ page }) => {
    await page.goto("/auth/login");
    await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
  });

  test("Vite proxy: /api/session proxies to platform-api", async ({ page }) => {
    const res = await page.request.get("/api/session");
    expect(res.status()).toBe(200);
    const actor = await res.json();
    expect(actor.roles).toContain("tenant-admin");
  });

  test("fixture session: tenant-admin can access /e2e-harness", async ({ page }) => {
    await page.goto("/e2e-harness");
    // With fixture session (tenant-admin), /api/session returns actor with organisation.read
    // ProtectedRoute should render the protected content
    await expect(page.getByTestId("protected-content")).toBeVisible({ timeout: 10000 });
  });

  test("unauthenticated: 401 session redirects to /auth/login (e2e-harness)", async ({ page }) => {
    // Intercept /api/session at the browser level to simulate unauthenticated state.
    // Must be set before navigation so useSession() fetch is captured.
    await page.route("**/api/session", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ code: "UNAUTHENTICATED", message: "No session" }),
      })
    );
    await page.goto("/e2e-harness");
    // ProtectedRoute detects unauthenticated (isAuthenticated=false) and redirects
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 10000 });
  });
});

test.describe("organisation profile slice", () => {
  test("tenant-admin can view /organisation/profile", async ({ page }) => {
    await page.goto("/organisation/profile");
    await expect(page.getByTestId("organisation-profile")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("display-name-input")).toBeVisible();
    await expect(page.getByTestId("save-button")).toBeVisible();
  });

  test("tenant-admin can update display name", async ({ page }) => {
    await page.goto("/organisation/profile");
    const input = page.getByTestId("display-name-input");
    await expect(input).toBeVisible({ timeout: 10000 });
    await input.fill("E2E Updated Name");
    await page.getByTestId("save-button").click();
    await expect(page.getByTestId("success-message")).toBeVisible({ timeout: 5000 });
    // Restore original name
    await input.fill("Fixture Organisation");
    await page.getByTestId("save-button").click();
    await expect(page.getByTestId("success-message")).toBeVisible({ timeout: 5000 });
  });

  test("viewer sees read-only profile", async ({ page }) => {
    await page.route("**/api/session", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          userId: "00000000-0000-0000-0000-000000000003",
          tenantId: "00000000-0000-0000-0000-000000000001",
          organisationId: "00000000-0000-0000-0000-000000000001",
          roles: ["viewer"],
          permissions: [
            "organisation.read",
            "member.read",
            "profile.read_self",
            "profile.update_self",
          ],
          displayName: "Fixture Viewer",
        }),
      });
    });
    await page.goto("/organisation/profile");
    await expect(page.getByTestId("profile-read-only")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("display-name-value")).toBeVisible();
    await expect(page.getByTestId("profile-edit-form")).not.toBeVisible();
  });

  test("unauthenticated redirects to /auth/login", async ({ page }) => {
    await page.route("**/api/session", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ code: "UNAUTHENTICATED" }),
      })
    );
    await page.goto("/organisation/profile");
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 5000 });
  });
});
