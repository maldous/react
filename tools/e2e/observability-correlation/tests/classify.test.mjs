import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyCorrelation } from "../src/index.mjs";
import { exitCodeForResult } from "../../result-contract.mjs";

// End-to-end through the shared contract: classify → exit code.
const code = (args) => exitCodeForResult(classifyCorrelation(args));

const base = {
  lokiReachable: true,
  testRunId: "run-test-x",
  lineCount: 5,
  tempoRequired: false,
  tempoReachable: false,
};

test("missing testRunId → DEGRADED (exit 2)", () => {
  assert.equal(classifyCorrelation({ ...base, testRunId: "", lineCount: 0 }), "DEGRADED");
  assert.equal(code({ ...base, testRunId: "", lineCount: 0 }), 2);
});

test("Loki unreachable → DEGRADED (exit 2)", () => {
  assert.equal(classifyCorrelation({ ...base, lokiReachable: false }), "DEGRADED");
  assert.equal(code({ ...base, lokiReachable: false }), 2);
});

test("known testRunId with ZERO Loki lines → FAILED (exit 1)", () => {
  assert.equal(classifyCorrelation({ ...base, lineCount: 0 }), "FAILED");
  assert.equal(code({ ...base, lineCount: 0 }), 1);
});

test("lines>0 + required Tempo unreachable → DEGRADED (exit 2) — no FULL on Loki alone", () => {
  assert.equal(
    classifyCorrelation({ ...base, tempoRequired: true, tempoReachable: false }),
    "DEGRADED"
  );
  assert.equal(code({ ...base, tempoRequired: true, tempoReachable: false }), 2);
});

test("lines>0 + Tempo not required → FULL (exit 0)", () => {
  assert.equal(classifyCorrelation(base), "FULL");
  assert.equal(code(base), 0);
});

test("lines>0 + required Tempo reachable → FULL (exit 0)", () => {
  assert.equal(classifyCorrelation({ ...base, tempoRequired: true, tempoReachable: true }), "FULL");
  assert.equal(code({ ...base, tempoRequired: true, tempoReachable: true }), 0);
});
