// ADR-ACT-0285 Phase 3 + closure — E2E ⇄ logs/traces correlation (Playwright fixture).
//
// Every E2E request (browser navigation, page.request, the standalone APIRequestContext
// `request` fixture, and helpers that use them) carries a testRunId + scenarioId + stage
// so a scenario can be found in Loki (and on to Tempo via traceId). The platform-api
// pipeline reads x-e2e-* headers into searchable log metadata (never Loki labels); the
// observability-correlation harness queries Loki by these ids and asserts per-scenario
// completeness + the Tempo trace contract (e2e/scenario-manifest.json).
//
// CANONICAL SCENARIO ID (closure): the canonical id is NEVER a sanitised test title.
// Declare it explicitly, two ways:
//   1. `test.use({ scenarioId: "my-scenario" })` for a whole describe/file, or
//   2. per-test annotation for dynamic suites, via the `scenario()` helper:
//        test("...", { annotation: scenario(`persona-matrix:${id}`) }, async () => {...})
// A sanitised-title fallback remains ONLY so an un-migrated spec still correlates, but the
// scenario-manifest validator fails any stage-running correlated spec that relies on it.
//
// Pure logic (header injection, same-origin scoping, id helpers) lives in
// correlation-core.mjs and is unit-tested there.
import { test as base, expect } from "@playwright/test";
import type { TestInfo } from "@playwright/test";
import {
  E2E_STAGE,
  TEST_RUN_ID,
  SCENARIO_ANNOTATION,
  scenario,
  scenarioIdFromTitle,
  correlationHeaders,
  correlatedApiContext,
} from "./correlation-core.mjs";

export {
  E2E_STAGE,
  TEST_RUN_ID,
  SCENARIO_ANNOTATION,
  scenario,
  scenarioIdFromTitle,
  correlationHeaders,
};

/** Resolve the canonical scenarioId for a test: explicit option > per-test annotation
 *  > sanitised-title fallback. */
function resolveScenarioId(optionScenarioId: string | undefined, testInfo: TestInfo): string {
  if (optionScenarioId) return optionScenarioId;
  const annotated = testInfo.annotations.find((a) => a.type === SCENARIO_ANNOTATION)?.description;
  if (annotated) return annotated;
  return scenarioIdFromTitle(testInfo.title);
}

/**
 * Playwright `test` that auto-stamps the correlation headers on every same-origin
 * request a test makes — browser navigation, in-page fetch, `page.request`, the
 * standalone `request` fixture, and any helper that uses them. Specs import this
 * instead of `@playwright/test` and declare an explicit scenarioId via
 * `test.use({ scenarioId })` or the `scenario()` per-test annotation.
 */
export const test = base.extend<{ scenarioId: string }>({
  // Settable per file/describe via test.use({ scenarioId: "..." }). Empty = fall back to
  // a per-test annotation, then the sanitised title.
  scenarioId: ["", { option: true }],

  context: async ({ context, baseURL, scenarioId }, use, testInfo) => {
    const sid = resolveScenarioId(scenarioId, testInfo);
    const headers = correlationHeaders(sid);
    const appOrigin = baseURL ? new URL(baseURL).origin : null;
    // Browser requests (navigation + in-page fetch) → same-origin header injection.
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

  // page.request (the page's APIRequestContext) is NOT covered by context.route, so
  // shadow it with a same-origin-correlated wrapper.
  page: async ({ page, baseURL, scenarioId }, use, testInfo) => {
    const sid = resolveScenarioId(scenarioId, testInfo);
    const headers = correlationHeaders(sid);
    const appOrigin = baseURL ? new URL(baseURL).origin : null;
    const wrapped = correlatedApiContext(page.request, appOrigin, headers);
    Object.defineProperty(page, "request", { get: () => wrapped, configurable: true });
    await use(page);
  },

  // The standalone `request` fixture (used by API-only specs and helpers) is also a
  // separate APIRequestContext — wrap it the same way.
  request: async ({ request, baseURL, scenarioId }, use, testInfo) => {
    const sid = resolveScenarioId(scenarioId, testInfo);
    const headers = correlationHeaders(sid);
    const appOrigin = baseURL ? new URL(baseURL).origin : null;
    await use(correlatedApiContext(request, appOrigin, headers));
  },
});

export { expect };
