import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Exercise the REAL sourced helper (scripts/tests/aggregate-confidence.sh) that
// run-env-tests.sh uses to classify each group's exit code.
const HELPER = resolve(dirname(fileURLToPath(import.meta.url)), "../aggregate-confidence.sh");

function classify(group, rc) {
  return execFileSync("bash", ["-c", `. "${HELPER}"; classify_group_rc "${group}" "${rc}"`], {
    encoding: "utf8",
  }).trim();
}

test("contract group exit 2 → DEGRADED (not FULL)", () => {
  assert.equal(classify("e2e-observability-correlation", 2), "DEGRADED");
  assert.equal(classify("e2e-failure-rootcause", 2), "DEGRADED");
  assert.equal(classify("e2e-sentry-assertion", 2), "DEGRADED");
  assert.equal(classify("auth-e2e", 2), "DEGRADED");
});

test("contract group exit 1/other → FAIL", () => {
  assert.equal(classify("e2e-sentry-assertion", 1), "FAIL");
  assert.equal(classify("e2e-failure-rootcause", 3), "FAIL");
});

test("contract group exit 0 → OK", () => {
  assert.equal(classify("e2e-observability-correlation", 0), "OK");
});

test("non-contract group: make's exit 2 is FAIL, not DEGRADED", () => {
  assert.equal(classify("e2e-smoke", 2), "FAIL");
  assert.equal(classify("unit", 1), "FAIL");
  assert.equal(classify("compose-smoke", 2), "FAIL");
});

test("non-contract group exit 0 → OK", () => {
  assert.equal(classify("e2e-smoke", 0), "OK");
});

// Stage-level aggregation mirrors run-env-tests.sh: FAIL short-circuits to FAILED,
// else any DEGRADED → DEGRADED, else FULL.
function stage(groupCodes) {
  let degraded = false;
  for (const [g, rc] of groupCodes) {
    const c = classify(g, rc);
    if (c === "FAIL") return "FAILED";
    if (c === "DEGRADED") degraded = true;
  }
  return degraded ? "DEGRADED" : "FULL";
}

test("stage CANNOT be FULL when any required group exits 2", () => {
  assert.equal(
    stage([
      ["unit", 0],
      ["e2e-smoke", 0],
      ["e2e-observability-correlation", 2],
    ]),
    "DEGRADED"
  );
});

test("all-zero groups → FULL", () => {
  assert.equal(
    stage([
      ["unit", 0],
      ["compose-smoke", 0],
      ["e2e-smoke", 0],
      ["e2e-observability-correlation", 0],
      ["e2e-sentry-assertion", 0],
    ]),
    "FULL"
  );
});

test("any required group failing → FAILED (overrides degrade)", () => {
  assert.equal(
    stage([
      ["e2e-observability-correlation", 2],
      ["e2e-smoke", 2],
    ]),
    "FAILED"
  );
});
