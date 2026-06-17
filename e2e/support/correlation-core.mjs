// ADR-ACT-0285 Phase 3 + closure — PURE correlation helpers (no Playwright import).
//
// Extracted from correlation.ts so the same-origin header injection + scenarioId logic
// can be unit-tested directly (tools/e2e/correlation-headers.test.mjs) without loading
// Playwright. correlation.ts imports and re-exports these.

import crypto from "node:crypto";

/** Stage under test (set by the harness/Make target). */
export const E2E_STAGE = process.env["E2E_STAGE"] ?? process.env["STAGE"] ?? "local";

/** One id per `make`/playwright invocation; the harness exports E2E_TEST_RUN_ID so the
 *  post-run Loki query can find exactly this run's lines. */
export const TEST_RUN_ID =
  process.env["E2E_TEST_RUN_ID"] ??
  `run-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;

/** The annotation type that carries an explicit scenarioId on a single test. */
export const SCENARIO_ANNOTATION = "scenarioId";

/** Build the test-details annotation that pins an explicit scenarioId on one test. */
export function scenario(scenarioId) {
  return { type: SCENARIO_ANNOTATION, description: scenarioId };
}

/** Last-resort sanitised scenario id from a test title. NOT canonical — the
 *  scenario-manifest validator rejects stage-running specs that rely on it. */
export function scenarioIdFromTitle(title) {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96) || "scenario"
  );
}

/** The x-e2e-* headers (matched by pipeline.getE2ECorrelation) for one scenario. */
export function correlationHeaders(scenarioId) {
  return {
    "x-e2e-test-run-id": TEST_RUN_ID,
    "x-e2e-scenario-id": scenarioId,
    "x-e2e-stage": E2E_STAGE,
  };
}

/** True when `url` resolves to the same origin as the platform app (`appOrigin`).
 *  Correlation headers are added ONLY for same-origin requests — never to Keycloak,
 *  Cloudflare analytics, or any third-party origin. */
export function isSameOrigin(url, appOrigin) {
  if (!appOrigin) return false;
  try {
    return new URL(url, appOrigin).origin === appOrigin;
  } catch {
    return false;
  }
}

export function mergeHeaders(options, url, appOrigin, headers) {
  if (typeof url === "string" && isSameOrigin(url, appOrigin)) {
    return { ...(options ?? {}), headers: { ...(options?.headers ?? {}), ...headers } };
  }
  return options;
}

const API_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "fetch"]);

/**
 * Wrap an APIRequestContext so every SAME-ORIGIN request carries the correlation
 * headers. APIRequestContext requests are NOT intercepted by context.route (they are a
 * Node-side HTTP client), so persona specs using `page.request.fetch(...)` previously
 * bypassed correlation entirely — this closes that gap while preserving the strict
 * same-origin scope (never leaks ids to Keycloak/Cloudflare/third parties).
 */
export function correlatedApiContext(api, appOrigin, headers) {
  return new Proxy(api, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      const fn = value;
      if (typeof prop === "string" && API_METHODS.has(prop)) {
        return (url, options) =>
          fn.call(target, url, mergeHeaders(options, url, appOrigin, headers));
      }
      return fn.bind(target);
    },
  });
}
