// ADR-ACT-0285 (closure) — correlation header injection for page.request /
// APIRequestContext, with strict same-origin scoping (never leaks to Keycloak/Cloudflare).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  correlatedApiContext,
  isSameOrigin,
  mergeHeaders,
  scenario,
  scenarioIdFromTitle,
  SCENARIO_ANNOTATION,
} from "../../e2e/support/correlation-core.mjs";

const APP = "https://app.aldous.info";
const HEADERS = { "x-e2e-test-run-id": "run-1", "x-e2e-scenario-id": "s1", "x-e2e-stage": "test" };

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

test("scenario() builds the annotation; scenarioIdFromTitle sanitises (fallback only)", () => {
  assert.deepEqual(scenario("persona-matrix:x"), {
    type: SCENARIO_ANNOTATION,
    description: "persona-matrix:x",
  });
  assert.equal(scenarioIdFromTitle("Some Title! With Junk"), "some-title-with-junk");
});
