// ADR-ACT-0285 (closure) — Tempo trace-by-id retrieval + assertion tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseTraceId,
  extractSpans,
  assertTraceContract,
  scanForSecrets,
  pollTempoTrace,
} from "./tempo-trace.mjs";

const trace = (services) => ({
  batches: services.map((svc) => ({
    resource: { attributes: [{ key: "service.name", value: { stringValue: svc.name } }] },
    scopeSpans: [
      {
        spans: (svc.spans ?? [{ name: "GET", attrs: {} }]).map((sp) => ({
          name: sp.name,
          attributes: Object.entries(sp.attrs ?? {}).map(([k, v]) => ({
            key: k,
            value: { stringValue: v },
          })),
        })),
      },
    ],
  })),
});

test("parseTraceId accepts 16/32 hex, rejects junk", () => {
  assert.equal(parseTraceId("0123456789abcdef"), "0123456789abcdef");
  assert.equal(
    parseTraceId("0123456789ABCDEF0123456789abcdef"),
    "0123456789abcdef0123456789abcdef"
  );
  assert.equal(parseTraceId("not-a-trace"), null);
  assert.equal(parseTraceId(""), null);
  assert.equal(parseTraceId(undefined), null);
  assert.equal(parseTraceId("xyz123"), null);
});

test("extractSpans handles batches, resourceSpans, and instrumentationLibrarySpans", () => {
  assert.equal(extractSpans(trace([{ name: "platform-api" }])).length, 1);
  const resourceSpansShape = {
    resourceSpans: [
      {
        resource: { attributes: [{ key: "service.name", value: { stringValue: "platform-api" } }] },
        instrumentationLibrarySpans: [{ spans: [{ name: "GET /x", attributes: [] }] }],
      },
    ],
  };
  const spans = extractSpans(resourceSpansShape);
  assert.equal(spans.length, 1);
  assert.equal(spans[0].service, "platform-api");
});

test("assertTraceContract passes when the expected platform-api span + route are present", () => {
  const t = trace([
    {
      name: "platform-api",
      spans: [{ name: "GET /api/admin/tenants", attrs: { "http.route": "/api/admin/tenants" } }],
    },
  ]);
  const r = assertTraceContract(extractSpans(t), {
    services: ["platform-api"],
    route: "/api/admin/tenants",
  });
  assert.equal(r.ok, true);
  assert.equal(r.routeFound, true);
  assert.deepEqual(r.missingServices, []);
});

test("assertTraceContract FAILS when the platform-api span is absent", () => {
  const t = trace([{ name: "some-other-service" }]);
  const r = assertTraceContract(extractSpans(t), { services: ["platform-api"] });
  assert.equal(r.ok, false);
  assert.deepEqual(r.missingServices, ["platform-api"]);
});

test("assertTraceContract FAILS when a required browser span is missing (full propagation)", () => {
  const t = trace([{ name: "platform-api" }]); // no react-enterprise-app span
  const r = assertTraceContract(extractSpans(t), {
    services: ["react-enterprise-app", "platform-api"],
  });
  assert.equal(r.ok, false);
  assert.deepEqual(r.missingServices, ["react-enterprise-app"]);

  const both = trace([{ name: "react-enterprise-app" }, { name: "platform-api" }]);
  const r2 = assertTraceContract(extractSpans(both), {
    services: ["react-enterprise-app", "platform-api"],
  });
  assert.equal(r2.ok, true);
});

test("assertTraceContract FAILS when the expected route is in no span", () => {
  const t = trace([
    { name: "platform-api", spans: [{ name: "GET /other", attrs: { "http.route": "/other" } }] },
  ]);
  const r = assertTraceContract(extractSpans(t), {
    services: ["platform-api"],
    route: "/api/admin/tenants",
  });
  assert.equal(r.ok, false);
  assert.equal(r.routeFound, false);
});

test("scanForSecrets flags secret-like attribute keys and known credential values", () => {
  const spans = extractSpans(
    trace([
      {
        name: "platform-api",
        spans: [{ name: "GET", attrs: { authorization: "Bearer abc", "http.route": "/x" } }],
      },
    ])
  );
  assert.ok(scanForSecrets(spans).length >= 1, "secret-like key with a value is flagged");

  const spans2 = extractSpans(
    trace([
      { name: "platform-api", spans: [{ name: "GET", attrs: { "custom.note": "hunter2pw" } }] },
    ])
  );
  assert.equal(
    scanForSecrets(spans2, ["hunter2pw"]).length,
    1,
    "known credential value is flagged"
  );
  assert.equal(scanForSecrets(spans2, ["short"]).length, 0, "short/absent secret not flagged");

  // a clean trace with the secret-bearing attribute makes assertTraceContract fail
  const r = assertTraceContract(spans, { services: ["platform-api"] });
  assert.equal(r.ok, false);
  assert.ok(r.secretHits.length >= 1);
});

// ── pollTempoTrace with an injected fetch ───────────────────────────────────
const okRes = (json) => ({ ok: true, status: 200, json: async () => json });
const notFound = () => ({ ok: false, status: 404, json: async () => ({}) });
const noSleep = async () => {};

test("pollTempoTrace: unreachable backend → reachable=false", async () => {
  const fetchImpl = async () => {
    throw new Error("ECONNREFUSED");
  };
  const r = await pollTempoTrace("http://tempo", "abc123", {
    fetchImpl,
    sleepImpl: noSleep,
    attempts: 3,
  });
  assert.equal(r.reachable, false);
  assert.equal(r.found, false);
});

test("pollTempoTrace: 404 during ingestion then success → found", async () => {
  let n = 0;
  const fetchImpl = async () => {
    n++;
    return n < 3 ? notFound() : okRes(trace([{ name: "platform-api" }]));
  };
  const r = await pollTempoTrace("http://tempo", "abc123", {
    fetchImpl,
    sleepImpl: noSleep,
    attempts: 5,
  });
  assert.equal(r.reachable, true);
  assert.equal(r.found, true);
  assert.equal(r.attempts, 3);
});

test("pollTempoTrace: trace permanently missing → reachable but not found", async () => {
  const fetchImpl = async () => notFound();
  const r = await pollTempoTrace("http://tempo", "abc123", {
    fetchImpl,
    sleepImpl: noSleep,
    attempts: 3,
  });
  assert.equal(r.reachable, true);
  assert.equal(r.found, false);
  assert.equal(r.attempts, 3);
});

test("pollTempoTrace: malformed JSON response → not found, error flagged", async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new Error("Unexpected token");
    },
  });
  const r = await pollTempoTrace("http://tempo", "abc123", {
    fetchImpl,
    sleepImpl: noSleep,
    attempts: 2,
  });
  assert.equal(r.found, false);
  assert.equal(r.error, "malformed-json");
});

test("pollTempoTrace: 200 with zero spans keeps polling, then succeeds", async () => {
  let n = 0;
  const fetchImpl = async () => {
    n++;
    return n < 2 ? okRes({ batches: [] }) : okRes(trace([{ name: "platform-api" }]));
  };
  const r = await pollTempoTrace("http://tempo", "abc123", {
    fetchImpl,
    sleepImpl: noSleep,
    attempts: 4,
  });
  assert.equal(r.found, true);
  assert.equal(r.attempts, 2);
});
