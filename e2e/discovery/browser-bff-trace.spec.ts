// ADR-ACT-0285 (closure hardening) — browser-to-BFF distributed-trace scenario.
//
// Proves end-to-end trace propagation: the React app's Faro TracingInstrumentation
// (apps/react-enterprise-app/src/observability/faro.ts) propagates the W3C `traceparent`
// header to same-origin /api calls, so a browser span and the BFF server span share ONE
// trace id. The observability-correlation harness then retrieves that trace BY ID from
// Tempo and asserts it contains BOTH `react-enterprise-app` and `platform-api` spans
// (scenario-manifest.json → browser-bff-trace, correlation.traces=required).
//
// Mechanics: load the app, then make ONE in-page (Faro-instrumented) same-origin fetch to a
// protected route. Unauthenticated it returns 401, which logs http.request.rejected at WARN
// (the dependable signal under LOG_LEVEL=warn) carrying testRunId/scenarioId + the trace id —
// the harness's entry point into Tempo. The correlation fixture stamps the x-e2e-* headers on
// that same-origin request; Faro adds `traceparent`; the BFF continues the trace.
import { test, expect } from "../support/correlation.ts";
import { flushFaroTraces } from "../support/faro-flush.ts";

// Canonical scenario id (ADR-ACT-0285 closure) — declared explicitly, never derived from the
// test title. Matched by e2e/scenario-manifest.json (browser-bff-trace).
test.use({ scenarioId: "browser-bff-trace" });

test("browser-to-BFF distributed trace — react-enterprise-app + platform-api in one trace", async ({
  page,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? "http://localhost:83").origin;
  // 1. load the React application (produces a browser document/load span).
  await page.goto(origin + "/", { waitUntil: "networkidle" }).catch(() => {});
  // 2-4. one in-page, Faro-instrumented, SAME-ORIGIN BFF request that deterministically
  // denies (401 → WARN log) and carries the propagated traceparent + the x-e2e headers.
  const status = await page.evaluate(async () => {
    const r = await fetch("/api/admin/tenants", { headers: { accept: "application/json" } });
    return r.status;
  });
  // 5. FLUSH the browser span before the page closes (the BatchSpanProcessor would
  // otherwise discard it on teardown, leaving Tempo with only the platform-api span).
  // All SDK-internal access is owned by e2e/support/faro-flush.ts; the spec only sees
  // a structured result and asserts the browser provider was actually found + flushed.
  const flush = await flushFaroTraces(page);
  expect(
    flush.providerFound,
    "Faro browser tracer provider must be present to produce the react-enterprise-app span"
  ).toBe(true);
  expect(flush.flushed, "browser spans must be force-flushed before teardown").toBe(true);
  // 6. the denial is the dependable correlatable signal; the SHARED trace (browser + BFF,
  // both react-enterprise-app and platform-api) is asserted in Tempo by the
  // observability-correlation harness (this spec only PRODUCES it).
  expect([401, 403]).toContain(status);
});
