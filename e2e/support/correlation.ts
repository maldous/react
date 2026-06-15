// ADR-ACT-0285 Phase 3 — E2E ⇄ logs/traces correlation.
//
// Every E2E request (browser + API) carries a testRunId + scenarioId + stage so a
// scenario can be found in Loki (and on to Tempo via traceId). The platform-api
// pipeline reads x-e2e-* headers into searchable log metadata (never Loki labels);
// the observability-correlation harness later queries Loki by these ids.
//
// Usage in a spec:
//   import { test } from "../support/correlation.ts";   // auto-stamps headers
//   import { correlationHeaders, TEST_RUN_ID } from "../support/correlation.ts";
import { test as base, expect } from "@playwright/test";
import crypto from "node:crypto";

/** Stage under test (set by the harness/Make target). */
export const E2E_STAGE = process.env["E2E_STAGE"] ?? process.env["STAGE"] ?? "local";

/** One id per `make`/playwright invocation; the harness exports E2E_TEST_RUN_ID so
 *  the post-run Loki query can find exactly this run's lines. */
export const TEST_RUN_ID =
  process.env["E2E_TEST_RUN_ID"] ??
  `run-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;

/** Stable, sanitised scenario id from a free-text test title. */
export function scenarioIdFromTitle(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96) || "scenario"
  );
}

/** The x-e2e-* headers (matched by pipeline.getE2ECorrelation) for one scenario. */
export function correlationHeaders(scenarioId: string): Record<string, string> {
  return {
    "x-e2e-test-run-id": TEST_RUN_ID,
    "x-e2e-scenario-id": scenarioId,
    "x-e2e-stage": E2E_STAGE,
  };
}

/**
 * Playwright `test` that auto-stamps the correlation headers on every browser/API
 * request in the test's context (scenarioId derived from the test title). Specs
 * import this instead of `@playwright/test` to get correlation for free.
 */
export const test = base.extend<{ scenarioId: string }>({
  scenarioId: async ({}, use, testInfo) => {
    await use(scenarioIdFromTitle(testInfo.title));
  },
  context: async ({ context, baseURL }, use, testInfo) => {
    const headers = correlationHeaders(scenarioIdFromTitle(testInfo.title));
    // Attach x-e2e-* correlation headers to SAME-ORIGIN (platform) requests only.
    // The platform-api pipeline reads them server-side, so they are only meaningful
    // same-origin. setExtraHTTPHeaders would add them to EVERY request including
    // third-party origins (e.g. the Cloudflare analytics beacon), turning those into
    // preflighted CORS requests the third party rejects — and leaking internal test
    // ids externally. Scope via a route interceptor instead.
    const appOrigin = baseURL ? new URL(baseURL).origin : null;
    await context.route("**/*", async (route) => {
      const request = route.request();
      if (appOrigin && request.url().startsWith(appOrigin)) {
        await route.continue({ headers: { ...request.headers(), ...headers } });
      } else {
        await route.continue();
      }
    });
    await use(context);
  },
});

export { expect };
