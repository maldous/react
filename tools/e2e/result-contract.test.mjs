import { test } from "node:test";
import assert from "node:assert/strict";
import { exitCodeForResult, worstResult } from "./result-contract.mjs";

test("exitCodeForResult: PASSED/FULL → 0, FAILED → 1, DEGRADED → 2", () => {
  assert.equal(exitCodeForResult("PASSED"), 0);
  assert.equal(exitCodeForResult("FULL"), 0);
  assert.equal(exitCodeForResult("FAILED"), 1);
  assert.equal(exitCodeForResult("DEGRADED"), 2);
  assert.equal(exitCodeForResult("degraded"), 2, "case-insensitive");
});

test("exitCodeForResult: unknown result throws — never silently a pass", () => {
  assert.throws(() => exitCodeForResult("MAYBE"));
  assert.throws(() => exitCodeForResult(""));
  assert.throws(() => exitCodeForResult(undefined));
});

test("worstResult: any FAILED → FAILED", () => {
  assert.equal(worstResult(["PASSED", "FAILED", "DEGRADED"]), "FAILED");
  assert.equal(worstResult(["FAILED"]), "FAILED");
});

test("worstResult: else any DEGRADED → DEGRADED", () => {
  assert.equal(worstResult(["DEGRADED", "DEGRADED"]), "DEGRADED");
  assert.equal(worstResult(["PASSED", "DEGRADED"]), "DEGRADED");
});

test("worstResult: all PASSED/FULL → PASSED", () => {
  assert.equal(worstResult(["PASSED", "FULL", "PASSED"]), "PASSED");
  assert.equal(worstResult([]), "PASSED");
});

test("failure-rootcause combine → exit codes (any FAILED→1, else any DEGRADED→2, else 0)", () => {
  assert.equal(exitCodeForResult(worstResult(["PASSED", "PASSED"])), 0);
  // backend unavailable: both sub-results DEGRADED → exit 2
  assert.equal(exitCodeForResult(worstResult(["DEGRADED", "DEGRADED"])), 2);
  assert.equal(exitCodeForResult(worstResult(["DEGRADED", "PASSED"])), 2);
  assert.equal(exitCodeForResult(worstResult(["FAILED", "DEGRADED"])), 1);
});
