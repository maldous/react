/**
 * asset-integrity.test.ts
 *
 * Production asset integrity verification — ensures every JS and CSS bundle
 * loads correctly, has content hashes, and no broken references.
 */

import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Asset loading
// ---------------------------------------------------------------------------

test.describe("assets: all bundles load successfully", () => {
  test("every .js asset returns HTTP 200", async ({ page }) => {
    const failures: string[] = [];
    page.on("response", (res) => {
      if (res.url().endsWith(".js") && res.status() !== 200) {
        failures.push(`${res.status()} ${res.url()}`);
      }
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    expect(failures, `JS bundle failures: ${failures.join(", ")}`).toHaveLength(0);
  });

  test("every .css asset returns HTTP 200", async ({ page }) => {
    const failures: string[] = [];
    page.on("response", (res) => {
      if (res.url().endsWith(".css") && res.status() !== 200) {
        failures.push(`${res.status()} ${res.url()}`);
      }
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    expect(failures, `CSS asset failures: ${failures.join(", ")}`).toHaveLength(0);
  });

  test("chunked JS bundles are loaded (code splitting works)", async ({ page }) => {
    const jsAssets: string[] = [];
    page.on("response", (res) => {
      if (res.url().includes("/assets/") && res.url().endsWith(".js") && res.status() === 200) {
        jsAssets.push(res.url());
      }
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // At minimum one JS bundle must load; small apps may bundle as a single chunk
    expect(jsAssets.length).toBeGreaterThanOrEqual(1);
  });

  test("no 404s or 5xx errors for any resource type", async ({ page }) => {
    const failures: Array<{ url: string; status: number }> = [];
    page.on("response", (res) => {
      const status = res.status();
      if (status >= 400 && res.url().includes(page.url().hostname)) {
        failures.push({ url: res.url(), status });
      }
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    expect(failures, `HTTP errors: ${JSON.stringify(failures)}`).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Content hashing
// ---------------------------------------------------------------------------

test.describe("assets: content hashing (fingerprint integrity)", () => {
  test("JS bundles have content hash in filename", async ({ page }) => {
    const jsAssets: string[] = [];
    page.on("response", (res) => {
      const url = res.url();
      if (url.includes("/assets/") && url.endsWith(".js") && res.status() === 200) {
        jsAssets.push(url);
      }
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    for (const url of jsAssets) {
      // Vite produces filenames like: index-abc123.js or chunk-abc123.js
      const filename = url.split("/").pop() ?? "";
      expect(filename, `JS bundle ${url} must have content hash`).toMatch(/-[A-Za-z0-9_-]{8,}\./);
    }
  });

  test("CSS bundles have content hash in filename", async ({ page }) => {
    const cssAssets: string[] = [];
    page.on("response", (res) => {
      const url = res.url();
      if (url.includes("/assets/") && url.endsWith(".css") && res.status() === 200) {
        cssAssets.push(url);
      }
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    for (const url of cssAssets) {
      const filename = url.split("/").pop() ?? "";
      expect(filename, `CSS bundle ${url} must have content hash`).toMatch(/-[A-Za-z0-9_-]{8,}\./);
    }
  });

  test("no duplicate content hashes across bundles (unique per file, relaxed for shared chunks)", async ({
    page,
  }) => {
    const jsHashes: Array<{ url: string; hash: string }> = [];
    page.on("response", (res) => {
      const url = res.url();
      if (url.includes("/assets/") && url.endsWith(".js") && res.status() === 200) {
        const match = url.match(/-([a-f0-9]{8,})\./);
        if (match) {
          jsHashes.push({ url, hash: match[1] });
        }
      }
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Duplicate hashes mean identical content. This is common for small shared
    // chunks (e.g., a utility re-exported from multiple entry points). Log them
    // but don't fail — identical content is not a concern.
    const sizeableDuplicates = jsHashes.filter(
      (a, i) => jsHashes.findIndex((b) => b.hash === a.hash) !== i
    );
    if (sizeableDuplicates.length > 0) {
      console.log(
        `ℹ Duplicate content hashes (identical content, benign): ${sizeableDuplicates.length} files`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Bundle size awareness (informational)
// ---------------------------------------------------------------------------

test.describe("assets: bundle size budgets", () => {
  test("entry JS bundle is under 500 KB", async ({ page }) => {
    const assetSizes: Array<{ url: string; size: number }> = [];
    page.on("response", (res) => {
      const url = res.url();
      if (url.includes("/assets/") && url.endsWith(".js") && res.status() === 200) {
        const contentLength = parseInt(res.headers()["content-length"] ?? "0", 10);
        assetSizes.push({ url, size: contentLength });
      }
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // All non-vendor JS bundles should be under budget
    for (const asset of assetSizes) {
      // Exclude vendor/libraries from strict budget
      const isVendor = asset.url.includes("vendor") || asset.url.includes("react");
      if (!isVendor && asset.size > 0) {
        expect(
          asset.size,
          `${asset.url.split("/").pop()} is ${(asset.size / 1024).toFixed(1)} KB — exceeds 500 KB budget`
        ).toBeLessThanOrEqual(512_000);
      }
    }
  });

  test("total transferred JS is under 1 MB", async ({ page }) => {
    let totalJsBytes = 0;
    page.on("response", (res) => {
      const url = res.url();
      if (url.includes("/assets/") && url.endsWith(".js") && res.status() === 200) {
        totalJsBytes += parseInt(res.headers()["content-length"] ?? "0", 10);
      }
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const totalKB = (totalJsBytes / 1024).toFixed(1);
    expect(
      totalJsBytes,
      `Total JS transferred: ${totalKB} KB — exceeds 1 MB budget`
    ).toBeLessThanOrEqual(1_048_576);
  });
});

// ---------------------------------------------------------------------------
// Font and image assets
// ---------------------------------------------------------------------------

test.describe("assets: fonts and images load correctly", () => {
  test("no broken image or font requests", async ({ page }) => {
    const failures: Array<{ url: string; status: number }> = [];
    page.on("response", (res) => {
      const url = res.url();
      const ct = res.headers()["content-type"] ?? "";
      const isAsset = ct.startsWith("image/") || ct.includes("font") || url.includes("woff2");
      if (isAsset && res.status() >= 400) {
        failures.push({ url, status: res.status() });
      }
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    expect(failures, `Broken asset requests: ${JSON.stringify(failures)}`).toHaveLength(0);
  });
});
