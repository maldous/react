// ADR-ACT-0285 Phase 5.5 — unit + guard tests for the Sentry API event
// assertion. All effects (fetch, sleep, clock) are injected so these run with
// NO live Sentry and NO network — keeping `make all`'s node:test layer green.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tagsToMap,
  assertEventMetadata,
  pickIssueId,
  findUnexpectedIssues,
  runAssertion,
} from "../src/lib.mjs";

const eventWith = (overrides = {}) => ({
  eventID: "evt-1",
  environment: "production",
  release: "1.2.3",
  tags: [
    { key: "trace_id", value: "abc123" },
    { key: "requestId", value: "req-1" },
    { key: "testRunId", value: "trid-1" },
    { key: "scenarioId", value: "scn-1" },
  ],
  ...overrides,
});

const fullExpected = {
  environment: "production",
  release: "1.2.3",
  tags: { requestId: "req-1", testRunId: "trid-1", scenarioId: "scn-1" },
  requireTags: ["trace_id"],
};

test("tagsToMap flattens the Sentry tags array", () => {
  assert.deepEqual(tagsToMap(eventWith()), {
    trace_id: "abc123",
    requestId: "req-1",
    testRunId: "trid-1",
    scenarioId: "scn-1",
  });
  assert.deepEqual(tagsToMap(null), {});
  assert.deepEqual(tagsToMap({ tags: undefined }), {});
});

test("assertEventMetadata: a complete event passes", () => {
  const v = assertEventMetadata({ event: eventWith(), expected: fullExpected });
  assert.equal(v.ok, true);
  assert.deepEqual(v.failures, []);
});

test("assertEventMetadata: missing presence-tag (trace_id) fails", () => {
  const event = eventWith({
    tags: [
      { key: "requestId", value: "req-1" },
      { key: "testRunId", value: "trid-1" },
      { key: "scenarioId", value: "scn-1" },
    ],
  });
  const v = assertEventMetadata({ event, expected: fullExpected });
  assert.equal(v.ok, false);
  assert.ok(v.failures.some((f) => f.includes("trace_id missing")));
});

test("assertEventMetadata: wrong exact-match tag (requestId) fails", () => {
  const event = eventWith();
  const v = assertEventMetadata({
    event,
    expected: { ...fullExpected, tags: { ...fullExpected.tags, requestId: "DIFFERENT" } },
  });
  assert.equal(v.ok, false);
  assert.ok(v.failures.some((f) => f.includes("tag requestId mismatch")));
});

test("assertEventMetadata: environment mismatch fails", () => {
  const v = assertEventMetadata({
    event: eventWith({ environment: "staging" }),
    expected: fullExpected,
  });
  assert.equal(v.ok, false);
  assert.ok(v.failures.some((f) => f.includes("environment mismatch")));
});

test("assertEventMetadata: release not asserted when no expected release", () => {
  const v = assertEventMetadata({
    event: eventWith({ release: null }),
    expected: { ...fullExpected, release: undefined },
  });
  assert.equal(v.ok, true);
});

test("assertEventMetadata: wrong release fails when expected", () => {
  const v = assertEventMetadata({
    event: eventWith({ release: "9.9.9" }),
    expected: fullExpected,
  });
  assert.equal(v.ok, false);
  assert.ok(v.failures.some((f) => f.includes("release mismatch")));
});

test("pickIssueId chooses the newest lastSeen, null when empty", () => {
  assert.equal(pickIssueId([]), null);
  assert.equal(pickIssueId(null), null);
  assert.equal(
    pickIssueId([
      { id: "old", lastSeen: "2026-01-01T00:00:00Z" },
      { id: "new", lastSeen: "2026-06-01T00:00:00Z" },
    ]),
    "new"
  );
});

test("findUnexpectedIssues ignores our testRunId and pre-window issues", () => {
  const windowStartMs = Date.parse("2026-06-15T12:00:00Z");
  const issues = [
    { id: "ours", firstSeen: "2026-06-15T12:00:05Z", tags: [{ key: "testRunId", value: "mine" }] },
    { id: "old", firstSeen: "2026-06-01T00:00:00Z", tags: [] },
    { id: "rogue", firstSeen: "2026-06-15T12:00:10Z", tags: [] },
  ];
  const unexpected = findUnexpectedIssues({ issues, ourTestRunId: "mine", windowStartMs });
  assert.deepEqual(
    unexpected.map((u) => u.id),
    ["rogue"]
  );
});

// --- runAssertion orchestration with injected fetch ---------------------------

const noopDeps = (fetchImpl) => ({
  fetchImpl,
  sleep: async () => {},
  log: () => {},
  now: () => Date.parse("2026-06-15T12:00:00Z"),
});

const triggerRes = { status: 500, headers: { get: () => "req-1" } };
const okJson = (body) => ({ ok: true, status: 200, json: async () => body });

const baseConfig = {
  stage: "test",
  isProd: false,
  apiBase: "http://localhost:3001",
  sentry: {
    baseUrl: "http://localhost:9060",
    token: "tok",
    orgSlug: "sentry",
    projectSlug: "react-sentry",
  },
  testRunId: "trid-1",
  scenarioId: "scn-1",
  expectedEnvironment: "production",
  expectedRelease: "1.2.3",
  triggerWaitMs: 0,
  pollAttempts: 3,
  pollIntervalMs: 0,
};

// Router: trigger → 500; issues search → [issue]; latest event → event.
const happyFetch = (
  event = eventWith(),
  issues = [{ id: "i1", lastSeen: "2026-06-15T12:00:01Z" }]
) => {
  return async (url) => {
    const s = String(url);
    if (s.includes("/internal/e2e/trigger-failure")) return triggerRes;
    if (s.includes("/issues/i1/events/latest/")) return okJson(event);
    if (s.includes("/issues/")) return okJson(issues);
    throw new Error(`unexpected url ${s}`);
  };
};

test("runAssertion: happy path PASSES", async () => {
  const out = await runAssertion(noopDeps(happyFetch()), baseConfig);
  assert.equal(out.result, "PASSED");
  assert.equal(out.testRunId, "trid-1");
});

test("runAssertion: Sentry not configured → DEGRADED", async () => {
  const out = await runAssertion(noopDeps(happyFetch()), { ...baseConfig, sentry: null });
  assert.equal(out.result, "DEGRADED");
  assert.ok(out.lines.some((l) => l.includes("not configured")));
});

test("runAssertion: trigger endpoint 404 → DEGRADED", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("trigger-failure"))
      return { status: 404, headers: { get: () => null } };
    throw new Error("should not query sentry");
  };
  const out = await runAssertion(noopDeps(fetchImpl), baseConfig);
  assert.equal(out.result, "DEGRADED");
  assert.ok(out.lines.some((l) => l.includes("404")));
});

test("runAssertion: API unreachable for trigger → DEGRADED", async () => {
  const fetchImpl = async () => {
    throw new Error("ECONNREFUSED");
  };
  const out = await runAssertion(noopDeps(fetchImpl), baseConfig);
  assert.equal(out.result, "DEGRADED");
});

test("runAssertion: Sentry reachable but no event → FAILED", async () => {
  const fetchImpl = async (url) => {
    const s = String(url);
    if (s.includes("trigger-failure")) return triggerRes;
    if (s.includes("/issues/")) return okJson([]); // never any issue
    throw new Error(`unexpected ${s}`);
  };
  const out = await runAssertion(noopDeps(fetchImpl), baseConfig);
  assert.equal(out.result, "FAILED");
  assert.ok(out.lines.some((l) => l.includes("NO event")));
});

test("runAssertion: Sentry API unreachable while querying → DEGRADED", async () => {
  const fetchImpl = async (url) => {
    const s = String(url);
    if (s.includes("trigger-failure")) return triggerRes;
    return { ok: false, status: 503, json: async () => ({}) };
  };
  const out = await runAssertion(noopDeps(fetchImpl), baseConfig);
  assert.equal(out.result, "DEGRADED");
});

test("runAssertion: event found but metadata wrong → FAILED", async () => {
  const badEvent = eventWith({ environment: "staging" }); // mismatch vs expected production
  const out = await runAssertion(noopDeps(happyFetch(badEvent)), baseConfig);
  assert.equal(out.result, "FAILED");
  assert.ok(out.lines.some((l) => l.includes("missing/wrong metadata")));
});

test("runAssertion: prod no-unexpected-events gate FAILS on a rogue event", async () => {
  const event = eventWith();
  const fetchImpl = async (url) => {
    const s = String(url);
    if (s.includes("trigger-failure")) return triggerRes;
    if (s.includes("/issues/i1/events/latest/")) return okJson(event);
    if (s.includes("environment%3Aproduction") || s.includes("environment:production")) {
      // prod gate query — return a rogue issue first seen during the window
      return okJson([
        { id: "rogue", firstSeen: "2026-06-15T12:00:30Z", tags: [] },
        {
          id: "ours",
          firstSeen: "2026-06-15T12:00:01Z",
          tags: [{ key: "testRunId", value: "trid-1" }],
        },
      ]);
    }
    if (s.includes("/issues/")) return okJson([{ id: "i1", lastSeen: "2026-06-15T12:00:01Z" }]);
    throw new Error(`unexpected ${s}`);
  };
  const out = await runAssertion(noopDeps(fetchImpl), { ...baseConfig, isProd: true });
  assert.equal(out.result, "FAILED");
  assert.ok(out.lines.some((l) => l.includes("no-unexpected-events")));
});

test("runAssertion: prod gate PASSES when only our event is present", async () => {
  const event = eventWith();
  const fetchImpl = async (url) => {
    const s = String(url);
    if (s.includes("trigger-failure")) return triggerRes;
    if (s.includes("/issues/i1/events/latest/")) return okJson(event);
    if (s.includes("environment%3Aproduction") || s.includes("environment:production")) {
      return okJson([
        {
          id: "ours",
          firstSeen: "2026-06-15T12:00:01Z",
          tags: [{ key: "testRunId", value: "trid-1" }],
        },
      ]);
    }
    if (s.includes("/issues/")) return okJson([{ id: "i1", lastSeen: "2026-06-15T12:00:01Z" }]);
    throw new Error(`unexpected ${s}`);
  };
  const out = await runAssertion(noopDeps(fetchImpl), { ...baseConfig, isProd: true });
  assert.equal(out.result, "PASSED");
});
