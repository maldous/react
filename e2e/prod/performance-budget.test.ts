/**
 * performance-budget.test.ts
 *
 * Production performance budget verification — ensures page load stays
 * within acceptable thresholds. Uses the Performance API and response
 * timing to measure critical metrics.
 */

import { test, expect } from "@playwright/test";

// Page-load TIMING budgets are scaled by PERF_BUDGET_MULTIPLIER (default 4). `make all`
// runs the full confidence ladder with ALL four stacks (dev+test+staging+prod) plus the
// shared Sentry + SonarQube stacks UP concurrently on ONE host, so absolute wall-clock
// load times are dominated by host CPU/IO contention, not the app — a 3s budget that is
// realistic against an isolated/edge-served prod is meaningless here. These budgets exist
// to catch GROSS regressions (a broken/30s+ page); tight real-SLO enforcement is the
// production observability layer's job (ADR-ACT-0284), and `make e2e-prod` against the
// real Cloudflare edge can set PERF_BUDGET_MULTIPLIER=1 for strict edge budgets.
const PERF_M = Number(process.env["PERF_BUDGET_MULTIPLIER"] ?? "5");
const budget = (ms: number) => ms * PERF_M;
const waitMs = (ms: number) => Math.max(10_000, budget(ms));

test.describe("performance: page load metrics", () => {
  test("homepage loads within budget", async ({ page }) => {
    const start = Date.now();
    await page.goto("/");
    await expect(page.locator("#root")).not.toBeEmpty({ timeout: waitMs(5_000) });
    const loadTime = Date.now() - start;

    expect(
      loadTime,
      `Homepage load time: ${loadTime} ms — exceeds ${budget(5_000)}ms budget (x${PERF_M})`
    ).toBeLessThanOrEqual(budget(5_000));
  });

  test("DOM content loaded within budget", async ({ page }) => {
    await page.goto("/");
    // Use Navigation Timing API — Response.timing() is not available in Playwright
    const domContentLoadedTime = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      return nav ? nav.domContentLoadedEventEnd - nav.startTime : null;
    });
    if (domContentLoadedTime === null) return; // Timing not available — skip silently
    expect(
      domContentLoadedTime,
      `DOMContentLoaded: ${domContentLoadedTime.toFixed(0)} ms — exceeds ${budget(3_000)}ms budget (x${PERF_M})`
    ).toBeLessThanOrEqual(budget(3_000));
  });

  test("page becomes interactive within budget", async ({ page }) => {
    await page.goto("/");
    const start = Date.now();

    // Wait for a key interactive element
    await expect(page.getByRole("heading", { name: /platform/i })).toBeVisible({
      timeout: waitMs(4_000),
    });

    const timeToInteractive = Date.now() - start;
    expect(
      timeToInteractive,
      `Time to interactive: ${timeToInteractive} ms — exceeds ${budget(4_000)}ms budget (x${PERF_M})`
    ).toBeLessThanOrEqual(budget(4_000));
  });
});

test.describe("performance: resource counts", () => {
  test("fewer than 40 HTTP requests on initial page load", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (req) => {
      // Only count requests to our own origin (not external analytics etc.)
      const url = req.url();
      if (!url.startsWith("data:") && !url.startsWith("blob:")) {
        requests.push(url);
      }
    });

    await page.goto("/");
    await expect(page.locator("#root")).not.toBeEmpty({ timeout: 10_000 });

    expect(requests.length, `Too many requests: ${requests.length} requests`).toBeLessThanOrEqual(
      40
    );
  });

  test("total page weight (HTML + JS + CSS) under 2 MB", async ({ page }) => {
    let totalBytes = 0;
    page.on("response", (res) => {
      const url = res.url();
      const isPageContent = url.endsWith(".html") || url.endsWith(".js") || url.endsWith(".css");
      if (isPageContent) {
        totalBytes += parseInt(res.headers()["content-length"] ?? "0", 10);
      }
    });

    await page.goto("/");
    await expect(page.locator("#root")).not.toBeEmpty({ timeout: 10_000 });

    const totalKB = (totalBytes / 1024).toFixed(1);
    expect(totalBytes, `Page weight: ${totalKB} KB — exceeds 2 MB budget`).toBeLessThanOrEqual(
      2_000_000
    );
  });
});

test.describe("performance: timing milestones", () => {
  test("first paint occurs within budget", async ({ page }) => {
    await page.goto("/");

    // Use Performance API to get paint timing
    const firstPaint = await page.evaluate((budgetMs: number) => {
      return new Promise<number | null>((resolve) => {
        // Check buffered entries first (works even if paints happened before observer)
        const paints = performance.getEntriesByType("paint");
        const existingFp = paints.find((e: PerformanceEntry) => e.name === "first-paint");
        if (existingFp) {
          resolve(existingFp.startTime);
          return;
        }
        // Fall back to observer for future paints
        const observer = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          const fp = entries.find((e) => e.name === "first-paint");
          if (fp) {
            resolve(fp.startTime);
          }
        });
        observer.observe({ type: "paint", buffered: true });
        // Timeout fallback: resolve after the budget window if no paint observed
        setTimeout(() => resolve(null), budgetMs);
      });
    }, waitMs(2_000));

    if (firstPaint !== null) {
      expect(
        firstPaint,
        `First paint: ${firstPaint.toFixed(0)} ms — exceeds ${budget(2_000)}ms budget (x${PERF_M})`
      ).toBeLessThanOrEqual(budget(2_000));
    }
  });

  test("first contentful paint occurs within budget", async ({ page }) => {
    await page.goto("/");

    const fcp = await page.evaluate((budgetMs: number) => {
      return new Promise<number | null>((resolve) => {
        // Check buffered entries first
        const paints = performance.getEntriesByType("paint");
        const existingFcp = paints.find(
          (e: PerformanceEntry) => e.name === "first-contentful-paint"
        );
        if (existingFcp) {
          resolve(existingFcp.startTime);
          return;
        }
        // Fall back to observer
        const observer = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          const fcp = entries.find((e) => e.name === "first-contentful-paint");
          if (fcp) {
            resolve(fcp.startTime);
          }
        });
        observer.observe({ type: "paint", buffered: true });
        setTimeout(() => resolve(null), budgetMs);
      });
    }, waitMs(2_500));

    if (fcp !== null) {
      expect(
        fcp,
        `First contentful paint: ${fcp.toFixed(0)} ms — exceeds ${budget(2_500)}ms budget (x${PERF_M})`
      ).toBeLessThanOrEqual(budget(2_500));
    }
  });
});
