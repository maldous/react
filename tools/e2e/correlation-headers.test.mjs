// ADR-ACT-0285 (closure) — correlation header injection for page.request /
// APIRequestContext, with strict same-origin scoping (never leaks to Keycloak/Cloudflare).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  correlatedApiContext,
  correlatedRouteHeaders,
  isSameOrigin,
  mergeHeaders,
  scenario,
  scenarioIdFromTitle,
  SCENARIO_ANNOTATION,
} from "../../e2e/support/correlation-core.mjs";

const APP = "https://aldous.info";
const HEADERS = { "x-e2e-test-run-id": "run-1", "x-e2e-scenario-id": "s1", "x-e2e-stage": "test" };

// The exact set of hostile / cross-origin URLs that must NEVER receive correlation headers.
const HOSTILE = [
  ["subdomain-suffix spoof", "https://aldous.info.evil.example/x"],
  ["userinfo spoof", "https://aldous.info@evil.example/x"],
  ["keycloak subdomain", "https://keycloak.aldous.info/realms/x"],
  ["cloudflare analytics", "https://cloudflareinsights.com/cdn-cgi/rum"],
  ["different scheme", "http://aldous.info/x"],
  ["different port", "https://aldous.info:8443/x"],
  ["different host", "https://evil.example/x"],
];

test("isSameOrigin: only the platform origin matches", () => {
  assert.equal(isSameOrigin(`${APP}/api/x`, APP), true);
  assert.equal(isSameOrigin("/api/x", APP), true, "relative resolves to appOrigin");
  assert.equal(isSameOrigin("https://keycloak.aldous.info/realms", APP), false);
  assert.equal(isSameOrigin("https://cloudflareinsights.com/cdn-cgi/beacon", APP), false);
  assert.equal(isSameOrigin(`${APP}/x`, null), false);
});

test("mergeHeaders adds correlation headers only for same-origin urls", () => {
  const same = mergeHeaders({ method: "GET" }, `${APP}/api/x`, APP, HEADERS);
  assert.equal(same.headers["x-e2e-scenario-id"], "s1");
  assert.equal(same.method, "GET");
  const cross = mergeHeaders({ method: "GET" }, "https://keycloak.aldous.info/x", APP, HEADERS);
  assert.deepEqual(cross, { method: "GET" }, "cross-origin options untouched (no headers)");
});

test("correlatedApiContext injects headers on same-origin requests for every verb", () => {
  const calls = [];
  const fake = {
    get: (url, opts) => calls.push(["get", url, opts]),
    post: (url, opts) => calls.push(["post", url, opts]),
    fetch: (url, opts) => calls.push(["fetch", url, opts]),
    // a non-request method must pass through unwrapped
    storageState: () => "state",
  };
  const wrapped = correlatedApiContext(fake, APP, HEADERS);

  wrapped.get(`${APP}/api/session`);
  wrapped.post(`${APP}/api/x`, { data: 1 });
  wrapped.fetch("https://keycloak.aldous.info/token", { method: "POST" });
  assert.equal(wrapped.storageState(), "state");

  const [g, p, f] = calls;
  assert.equal(g[2].headers["x-e2e-test-run-id"], "run-1", "GET same-origin gets headers");
  assert.equal(
    p[2].headers["x-e2e-scenario-id"],
    "s1",
    "POST same-origin gets headers + keeps data"
  );
  assert.equal(p[2].data, 1);
  assert.equal(
    f[2]?.headers,
    undefined,
    "cross-origin (Keycloak) fetch gets NO correlation headers"
  );
});

test("BROWSER route injection (correlatedRouteHeaders) adds headers ONLY same-origin", () => {
  // same-origin → merged headers returned (this is exactly what the context.route fixture sends)
  const same = correlatedRouteHeaders(`${APP}/api/session`, { accept: "x" }, APP, HEADERS);
  assert.equal(same["x-e2e-scenario-id"], "s1");
  assert.equal(same["accept"], "x", "existing request headers (incl. Faro traceparent) preserved");
  // relative is resolved against appOrigin → same-origin
  assert.ok(correlatedRouteHeaders("/api/theme", {}, APP, HEADERS));
  // every hostile/cross-origin URL → null (pass through untouched, NO correlation headers)
  for (const [label, url] of HOSTILE)
    assert.equal(
      correlatedRouteHeaders(url, {}, APP, HEADERS),
      null,
      `route must NOT tag: ${label}`
    );
});

test("API context wrapping (correlatedApiContext) tags ONLY same-origin, never hostile origins", () => {
  for (const [label, url] of HOSTILE) {
    const calls = [];
    const wrapped = correlatedApiContext(
      { get: (u, o) => calls.push(o), fetch: (u, o) => calls.push(o) },
      APP,
      HEADERS
    );
    wrapped.get(url);
    wrapped.fetch(url, { method: "POST" });
    assert.equal(calls[0]?.headers, undefined, `API get must NOT tag: ${label}`);
    assert.equal(calls[1]?.headers, undefined, `API fetch must NOT tag: ${label}`);
  }
  // sanity: same-origin IS tagged
  const ok = [];
  const w = correlatedApiContext({ get: (u, o) => ok.push(o) }, APP, HEADERS);
  w.get(`${APP}/api/session`);
  assert.equal(ok[0].headers["x-e2e-scenario-id"], "s1");
});

test("scenario() builds the annotation; scenarioIdFromTitle sanitises (fallback only)", () => {
  assert.deepEqual(scenario("persona-matrix:x"), {
    type: SCENARIO_ANNOTATION,
    description: "persona-matrix:x",
  });
  assert.equal(scenarioIdFromTitle("Some Title! With Junk"), "some-title-with-junk");
});
