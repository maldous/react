// ADR-ACT-0285 (closure) — direct-vs-continuation stage exit-code contract.
// Exercises the REAL sourced helper scripts/stages/stage-exit.sh that run-stage.sh uses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HELPER = resolve(dirname(fileURLToPath(import.meta.url)), "../../stages/stage-exit.sh");

function exitCode(stageResult, degraded, cont) {
  return execFileSync(
    "bash",
    ["-c", `. "${HELPER}"; stage_exit_code "${stageResult}" "${degraded}" "${cont}"`],
    { encoding: "utf8" }
  ).trim();
}

test("FULL (result 0, not degraded) → exit 0", () => {
  assert.equal(exitCode("0", "0", ""), "0");
  assert.equal(exitCode("0", "0", "1"), "0");
});

test("FAILED (result != 0) → exit 1 always, even in continuation mode", () => {
  assert.equal(exitCode("1", "0", ""), "1");
  assert.equal(exitCode("1", "1", "1"), "1", "a FAILED stage halts even when continuation is on");
});

test("DIRECT degraded → exit 2 (a degraded required group never passes)", () => {
  assert.equal(exitCode("0", "1", ""), "2");
  assert.equal(exitCode("0", "1", "0"), "2");
});

test("ORCHESTRATOR degraded with LADDER_CONTINUE_ON_DEGRADED=1 → exit 0 (collects later stages)", () => {
  assert.equal(exitCode("0", "1", "1"), "0");
});
