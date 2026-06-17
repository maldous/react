// ADR-ACT-0285 Phase 3 + closure — observability-correlation completeness + pagination.
// (Replaces the legacy single-line classifier test: the harness now asserts per-scenario
// completeness, not just "≥1 line exists".)
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupByScenario, computeCompleteness, lokiQueryAll } from "../src/index.mjs";

const sc = (scenarioId, logs) => ({ scenarioId, correlation: { logs }, persona: null });

test("groupByScenario counts lines + collects distinct traceIds per scenario", () => {
  const lines = [
    { line: JSON.stringify({ scenarioId: "a", traceId: "t1" }) },
    { line: JSON.stringify({ scenarioId: "a", traceId: "t1" }) },
    { line: JSON.stringify({ scenarioId: "a", traceId: "t2" }) },
    { line: JSON.stringify({ scenarioId: "b" }) },
    { line: "non-json line" },
  ];
  const m = groupByScenario(lines);
  assert.equal(m.get("a").lines, 3);
  assert.deepEqual([...m.get("a").traceIds].sort(), ["t1", "t2"]);
  assert.equal(m.get("b").lines, 1);
  assert.equal(m.get("unknown").lines, 1);
});

test("computeCompleteness: all required observed → PASSED; best-effort absent is fine", () => {
  const stageScenarios = [sc("probe", "required"), sc("best", "best-effort")];
  const observed = new Map([["probe", { lines: 3, traceIds: new Set(["t1"]) }]]);
  const r = computeCompleteness(stageScenarios, "test", observed);
  assert.equal(r.result, "PASSED");
  assert.deepEqual(r.missingRequired, []);
  assert.equal(r.perScenario.find((s) => s.scenarioId === "probe").result, "OK");
  assert.equal(r.perScenario.find((s) => s.scenarioId === "best").result, "ABSENT");
});

test("computeCompleteness: a MISSING required scenario → FAILED", () => {
  const stageScenarios = [sc("probe", "required"), sc("persona-x", "required")];
  const observed = new Map([["probe", { lines: 1, traceIds: new Set() }]]);
  const r = computeCompleteness(stageScenarios, "test", observed);
  assert.equal(r.result, "FAILED");
  assert.deepEqual(r.missingRequired, ["persona-x"]);
  assert.equal(r.perScenario.find((s) => s.scenarioId === "persona-x").result, "MISSING");
});

test("computeCompleteness: observed ids not in the stage set are reported as unexpected", () => {
  const stageScenarios = [sc("probe", "required")];
  const observed = new Map([
    ["probe", { lines: 1, traceIds: new Set() }],
    ["stray-title-derived", { lines: 4, traceIds: new Set() }],
  ]);
  const r = computeCompleteness(stageScenarios, "test", observed);
  assert.deepEqual(r.unexpected, ["stray-title-derived"]);
  assert.equal(r.result, "PASSED"); // unexpected is reported, not a hard fail
});

// ── Loki pagination (no fixed 200-line blind spot) ──────────────────────────
function pagedFetch(pages) {
  let i = 0;
  return async () => {
    const values = pages[i] ?? [];
    i++;
    return { ok: true, status: 200, json: async () => ({ data: { result: [{ values }] } }) };
  };
}

test("lokiQueryAll paginates past the per-page limit without truncating", async () => {
  // perPage 2: page1 full (2) → continue; page2 partial (1) → stop. 3 lines total.
  const fetchImpl = pagedFetch([
    [
      ["300", JSON.stringify({ scenarioId: "a" })],
      ["299", JSON.stringify({ scenarioId: "a" })],
    ],
    [["100", JSON.stringify({ scenarioId: "b" })]],
  ]);
  const r = await lokiQueryAll("http://loki", "{x}", {
    fetchImpl,
    perPage: 2,
    maxPages: 10,
    nowMs: 1000,
  });
  assert.equal(r.lines.length, 3);
  assert.equal(r.truncated, false);
});

test("lokiQueryAll flags truncation honestly when the safety cap is hit", async () => {
  // each page returns DISTINCT full pages (older ts) so pageCount stays == perPage until
  // the cap is reached → truncated must be surfaced honestly (never silent).
  let n = 1000;
  const fetchImpl = async () => {
    const values = [
      [String(n--), JSON.stringify({ scenarioId: "a" })],
      [String(n--), JSON.stringify({ scenarioId: "a" })],
    ];
    return { ok: true, status: 200, json: async () => ({ data: { result: [{ values }] } }) };
  };
  const r = await lokiQueryAll("http://loki", "{x}", {
    fetchImpl,
    perPage: 2,
    maxPages: 2,
    nowMs: 1000,
  });
  assert.equal(r.truncated, true);
});

test("lokiQueryAll throws on a non-OK Loki response (surfaced as unreachable upstream)", async () => {
  const fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await assert.rejects(
    () => lokiQueryAll("http://loki", "{x}", { fetchImpl, nowMs: 1000 }),
    /loki 503/
  );
});
