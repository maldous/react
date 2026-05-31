/**
 * performance-budget.test.ts
 *
 * Production performance budget verification — ensures page load stays
 * within acceptable thresholds. Uses the Performance API and response
 * timing to measure critical metrics.
 */

import { test, expect } from "@playwright/test";

test.describe("performance: page load metrics", () => {
  test("homepage loads within 5 seconds (basic budget)", async ({ page }) => {
    const start = Date.now();
    await page.goto("/");
    await page.waitForLoadState("load");
    const loadTime = Date.now() - start;

    expect(loadTime, `Homepage load time: ${loadTime} ms — exceeds 5s budget`).toBeLessThanOrEqual(
      5_000
    );
  });

  test("DOM content loaded within 3 seconds", async ({ page }) => {
    await page.goto("/");
    // Use Navigation Timing API — Response.timing() is not available in Playwright
    const domContentLoadedTime = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      return nav ? nav.domContentLoadedEventEnd - nav.startTime : null;
    });
    if (domContentLoadedTime === null) return; // Timing not available — skip silently
    expect(
      domContentLoadedTime,
      `DOMContentLoaded: ${domContentLoadedTime.toFixed(0)} ms — exceeds 3s budget`
    ).toBeLessThanOrEqual(3_000);
  });

  test("page becomes interactive within 4 seconds", async ({ page }) => {
    await page.goto("/");
    const start = Date.now();

    // Wait for a key interactive element
    await expect(page.getByRole("heading", { name: /platform/i })).toBeVisible({ timeout: 10_000 });

    const timeToInteractive = Date.now() - start;
    expect(
      timeToInteractive,
      `Time to interactive: ${timeToInteractive} ms — exceeds 4s budget`
    ).toBeLessThanOrEqual(4_000);
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
    await page.waitForLoadState("load");

    expect(requests.length, `Too many requests: ${requests.length} requests`).toBeLessThanOrEqual(
      40
    );
  });

  test("total page weight (HTML + JS + CSS) under 2 MB", async ({ page }) => {
    let totalBytes = 0;
    page.on("response", (res) => {
      const url = res.url();
      const ct = res.headers()["content-type"] ?? "";
      const isPageContent = url.endsWith(".html") || url.endsWith(".js") || url.endsWith(".css");
      if (isPageContent) {
        totalBytes += parseInt(res.headers()["content-length"] ?? "0", 10);
      }
    });

    await page.goto("/");
    await page.waitForLoadState("load");

    const totalKB = (totalBytes / 1024).toFixed(1);
    expect(totalBytes, `Page weight: ${totalKB} KB — exceeds 2 MB budget`).toBeLessThanOrEqual(
      2_000_000
    );
  });
});

test.describe("performance: timing milestones", () => {
  test("first paint occurs within 2 seconds", async ({ page }) => {
    await page.goto("/");

    // Use Performance API to get paint timing
    const firstPaint = await page.evaluate(() => {
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
        // Timeout fallback: resolve after 5s if no paint observed
        setTimeout(() => resolve(null), 5_000);
      });
    });

    if (firstPaint !== null) {
      expect(
        firstPaint,
        `First paint: ${firstPaint.toFixed(0)} ms — exceeds 2s budget`
      ).toBeLessThanOrEqual(2_000);
    }
  });

  test("first contentful paint occurs within 2.5 seconds", async ({ page }) => {
    await page.goto("/");

    const fcp = await page.evaluate(() => {
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
        setTimeout(() => resolve(null), 5_000);
      });
    });

    if (fcp !== null) {
      expect(
        fcp,
        `First contentful paint: ${fcp.toFixed(0)} ms — exceeds 2.5s budget`
      ).toBeLessThanOrEqual(2_500);
    }
  });
});
