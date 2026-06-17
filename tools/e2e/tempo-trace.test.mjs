// ADR-ACT-0285 (closure + hardening) — Tempo trace-by-id retrieval + assertion tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseTraceId,
  normalizeTraceId,
  extractSpans,
  routeFoundIn,
  assertTraceContract,
  scanForSecrets,
  pollTempoTrace,
  evaluateTraceScenario,
} from "./tempo-trace.mjs";

const ID_A = "a".repeat(32);
const ID_B = "b".repeat(32);

function trace(services, opts = {}) {
  const traceId = opts.traceId ?? ID_A;
  return {
    batches: services.map((svc) => ({
      resource: { attributes: [{ key: "service.name", value: { stringValue: svc.name } }] },
      scopeSpans: [
        {
          spans: (svc.spans ?? [{ name: "GET", attrs: {} }]).map((sp) => ({
            name: sp.name,
            traceId: sp.traceId ?? traceId,
            spanId: "abcdef0123456789",
            attributes: Object.entries(sp.attrs ?? {}).map(([k, v]) => ({
              key: k,
              value: { stringValue: v },
            })),
          })),
        },
      ],
    })),
  };
}

// ── id parsing ──────────────────────────────────────────────────────────────
test("parseTraceId accepts ONLY 32-hex (16-hex span-sized values rejected)", () => {
  assert.equal(parseTraceId(ID_A), ID_A);
  assert.equal(parseTraceId(ID_A.toUpperCase()), ID_A);
  assert.equal(parseTraceId("0123456789abcdef"), null, "16-hex is a span id, not a trace id");
  assert.equal(parseTraceId("not-a-trace"), null);
  assert.equal(parseTraceId(""), null);
});

test("normalizeTraceId handles hex and base64 (OTLP-JSON) trace ids", () => {
  assert.equal(normalizeTraceId(ID_A), ID_A);
  const bytes = Buffer.from(ID_A, "hex");
  assert.equal(normalizeTraceId(bytes.toString("base64")), ID_A, "base64 of 16 bytes → 32 hex");
  assert.equal(normalizeTraceId("short"), null);
});

test("extractSpans captures per-span normalised traceId", () => {
  const spans = extractSpans(trace([{ name: "platform-api" }], { traceId: ID_A }));
  assert.equal(spans[0].traceId, ID_A);
});

// ── route matching ────────────────────────────────────────────────────────
test("routeFoundIn prefers exact/normalised path; substring is last-resort", () => {
  const exact = extractSpans(
    trace([
      {
        name: "platform-api",
        spans: [{ name: "GET", attrs: { "http.route": "/api/admin/tenants" } }],
      },
    ])
  );
  assert.equal(routeFoundIn(exact, "/api/admin/tenants"), true);
  const trailing = extractSpans(
    trace([
      {
        name: "platform-api",
        spans: [{ name: "GET", attrs: { "url.path": "/api/admin/tenants/" } }],
      },
    ])
  );
  assert.equal(routeFoundIn(trailing, "/api/admin/tenants"), true, "trailing slash normalised");
  const withQuery = extractSpans(
    trace([
      {
        name: "platform-api",
        spans: [{ name: "GET", attrs: { "http.url": "https://aldous.info/api/theme?x=1" } }],
      },
    ])
  );
  assert.equal(routeFoundIn(withQuery, "/api/theme"), true, "query stripped");
  const none = extractSpans(
    trace([{ name: "platform-api", spans: [{ name: "GET", attrs: { "http.route": "/other" } }] }])
  );
  assert.equal(routeFoundIn(none, "/api/admin/tenants"), false);
});

// ── contract ────────────────────────────────────────────────────────────────
test("assertTraceContract passes platform-api span + route + trace membership", () => {
  const t = trace(
    [
      {
        name: "platform-api",
        spans: [{ name: "GET", attrs: { "http.route": "/api/admin/tenants" } }],
      },
    ],
    { traceId: ID_A }
  );
  const r = assertTraceContract(
    extractSpans(t),
    { services: ["platform-api"], route: "/api/admin/tenants" },
    { expectedTraceId: ID_A }
  );
  assert.equal(r.ok, true);
  assert.deepEqual(r.traceIdMismatches, []);
});

test("assertTraceContract FAILS when a span belongs to a DIFFERENT trace id", () => {
  const t = trace(
    [
      {
        name: "platform-api",
        spans: [{ name: "GET", attrs: { "http.route": "/api/admin/tenants" }, traceId: ID_B }],
      },
    ],
    { traceId: ID_A }
  );
  const r = assertTraceContract(
    extractSpans(t),
    { services: ["platform-api"], route: "/api/admin/tenants" },
    { expectedTraceId: ID_A }
  );
  assert.equal(r.ok, false);
  assert.equal(r.traceIdMismatches.length, 1);
});

test("assertTraceContract FAILS on missing platform-api span and on missing browser span", () => {
  assert.equal(
    assertTraceContract(extractSpans(trace([{ name: "other" }])), { services: ["platform-api"] })
      .ok,
    false
  );
  const apiOnly = extractSpans(trace([{ name: "platform-api" }]));
  assert.equal(
    assertTraceContract(apiOnly, {
      services: ["react-enterprise-app", "platform-api"],
    }).missingServices.join(),
    "react-enterprise-app"
  );
  const both = extractSpans(trace([{ name: "react-enterprise-app" }, { name: "platform-api" }]));
  assert.equal(
    assertTraceContract(both, { services: ["react-enterprise-app", "platform-api"] }).ok,
    true
  );
});

test("assertTraceContract FAILS on a leaked secret in span attributes", () => {
  const t = trace([
    {
      name: "platform-api",
      spans: [{ name: "GET", attrs: { authorization: "Bearer x", "http.route": "/x" } }],
    },
  ]);
  const r = assertTraceContract(extractSpans(t), { services: ["platform-api"] });
  assert.equal(r.ok, false);
  assert.ok(r.secretHits.length >= 1);
  assert.equal(
    scanForSecrets(
      extractSpans(
        trace([{ name: "platform-api", spans: [{ name: "GET", attrs: { n: "pwhunter2" } }] }])
      ),
      ["pwhunter2"]
    ).length,
    1
  );
});

// ── polling classification ───────────────────────────────────────────────────
const noSleep = async () => {};
const res = (status, json) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => json ?? {},
});

test("pollTempoTrace: network error → DEGRADED classification", async () => {
  const r = await pollTempoTrace("http://t", ID_A, {
    fetchImpl: async () => {
      throw new Error("ECONNREFUSED");
    },
    sleepImpl: noSleep,
    attempts: 3,
  });
  assert.equal(r.classification, "degraded");
});
test("pollTempoTrace: persistent 5xx → DEGRADED", async () => {
  const r = await pollTempoTrace("http://t", ID_A, {
    fetchImpl: async () => res(503),
    sleepImpl: noSleep,
    attempts: 3,
  });
  assert.equal(r.classification, "degraded");
});
test("pollTempoTrace: 401/403 → DEGRADED (auth/config, not absence)", async () => {
  assert.equal(
    (
      await pollTempoTrace("http://t", ID_A, {
        fetchImpl: async () => res(403),
        sleepImpl: noSleep,
        attempts: 2,
      })
    ).classification,
    "degraded"
  );
});
test("pollTempoTrace: persistent genuine 404 → MISSING (FAILED upstream)", async () => {
  const r = await pollTempoTrace("http://t", ID_A, {
    fetchImpl: async () => res(404),
    sleepImpl: noSleep,
    attempts: 3,
  });
  assert.equal(r.classification, "missing");
});
test("pollTempoTrace: 404 then success → FOUND", async () => {
  let n = 0;
  const r = await pollTempoTrace("http://t", ID_A, {
    fetchImpl: async () => (++n < 3 ? res(404) : res(200, trace([{ name: "platform-api" }]))),
    sleepImpl: noSleep,
    attempts: 5,
  });
  assert.equal(r.classification, "found");
  assert.equal(r.attempts, 3);
});
test("pollTempoTrace: malformed JSON → DEGRADED (backend problem, not absence)", async () => {
  const r = await pollTempoTrace("http://t", ID_A, {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("bad");
      },
    }),
    sleepImpl: noSleep,
    attempts: 2,
  });
  assert.equal(r.classification, "degraded");
});

// ── multi-trace-id evaluation ─────────────────────────────────────────────────
function tempoFor(map) {
  // map: traceId -> response thunk
  return async (url) => {
    const id = url.split("/api/traces/")[1];
    return (map[id] ?? (() => res(404)))();
  };
}

test("evaluateTraceScenario: no valid 32-hex id → FAILED", async () => {
  const r = await evaluateTraceScenario(
    "http://t",
    ["nothex"],
    { services: ["platform-api"] },
    { sleepImpl: noSleep, attempts: 1 }
  );
  assert.equal(r.result, "FAILED");
  assert.match(r.reason, /no valid/);
});

test("evaluateTraceScenario: iterates ids — first 404, second valid → PASSED (not blind first)", async () => {
  const fetchImpl = tempoFor({
    [ID_A]: () => res(404),
    [ID_B]: () => res(200, trace([{ name: "platform-api" }], { traceId: ID_B })),
  });
  const r = await evaluateTraceScenario(
    "http://t",
    [ID_A, ID_B],
    { services: ["platform-api"] },
    { fetchImpl, sleepImpl: noSleep, attempts: 2 }
  );
  assert.equal(r.result, "PASSED");
  assert.equal(r.chosenTraceId, ID_B);
});

test("evaluateTraceScenario: allTraceIds requires EVERY id to satisfy the contract", async () => {
  const good = trace([{ name: "platform-api" }], { traceId: ID_A });
  const fetchImpl = tempoFor({
    [ID_A]: () => res(200, good),
    [ID_B]: () => res(200, trace([{ name: "other" }], { traceId: ID_B })),
  });
  const r = await evaluateTraceScenario(
    "http://t",
    [ID_A, ID_B],
    { services: ["platform-api"], allTraceIds: true },
    { fetchImpl, sleepImpl: noSleep, attempts: 1 }
  );
  assert.equal(r.result, "FAILED", "second id lacks platform-api → all-required fails");
});

test("evaluateTraceScenario: all backends degraded → DEGRADED (not FAILED)", async () => {
  const fetchImpl = tempoFor({ [ID_A]: () => res(503) });
  const r = await evaluateTraceScenario(
    "http://t",
    [ID_A],
    { services: ["platform-api"] },
    { fetchImpl, sleepImpl: noSleep, attempts: 2 }
  );
  assert.equal(r.result, "DEGRADED");
});

test("evaluateTraceScenario: genuine 404 absence → FAILED", async () => {
  const fetchImpl = tempoFor({ [ID_A]: () => res(404) });
  const r = await evaluateTraceScenario(
    "http://t",
    [ID_A],
    { services: ["platform-api"] },
    { fetchImpl, sleepImpl: noSleep, attempts: 2 }
  );
  assert.equal(r.result, "FAILED");
});

test("evaluateTraceScenario: found but missing required service → FAILED", async () => {
  const fetchImpl = tempoFor({
    [ID_A]: () => res(200, trace([{ name: "platform-api" }], { traceId: ID_A })),
  });
  const r = await evaluateTraceScenario(
    "http://t",
    [ID_A],
    { services: ["react-enterprise-app", "platform-api"] },
    { fetchImpl, sleepImpl: noSleep, attempts: 1 }
  );
  assert.equal(r.result, "FAILED");
});
