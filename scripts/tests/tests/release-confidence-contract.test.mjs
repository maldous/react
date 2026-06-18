// ADR-ACT-0290 / ADR-ACT-0291 — full-confidence Sonar contract.
//
// REALITY (verified by running the ladder): `make all` already runs the Sonar
// absolute-zero gate, at the TEST stage, via scripts/stages/run-stage.sh §9
// (`make sonar`, gated to STAGE=test — the gating stage before staging/prod
// promote). So a green `make all` proves Sonar passed, and Sonar runs EXACTLY
// ONCE in the ladder. These tests lock that contract so it can't silently drift:
//   1. run-stage.sh invokes `make sonar` exactly once, gated to the test stage.
//   2. the fast `make check` and the `quality` composite never invoke sonar.
//   3. `release-confidence` runs `make all` and does NOT append a second `make
//      sonar` (which would re-scan).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel) => readFileSync(resolve(repoRoot, rel), "utf8");
const makefile = read("Makefile");
const qualityMk = read("make/quality.mk");
const runStage = read("scripts/stages/run-stage.sh");

/** Extract a target's recipe + prerequisites as one text block from a makefile. */
function targetBlock(text, name) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^${name}:`).test(l));
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && (lines[end].startsWith("\t") || lines[end].trim() === "")) end++;
  return lines.slice(start, end).join("\n");
}

test("run-stage.sh runs the Sonar gate exactly once, gated to the test stage", () => {
  const sonarInvocations = (runStage.match(/make sonar\b/g) ?? []).length;
  assert.equal(sonarInvocations, 1, "run-stage.sh must invoke `make sonar` exactly once");
  // It must be guarded to the test stage (so dev/staging/prod don't re-scan).
  assert.match(runStage, /STAGE"?\s*=\s*"?test"?/);
});

test("the fast `check` target never invokes sonar", () => {
  const block = targetBlock(qualityMk, "check");
  assert.ok(block, "check target present");
  assert.ok(!/\bsonar\b/.test(block), "`check` must stay fast — no sonar");
});

test("the `quality` composite (used by make all) does not itself list sonar", () => {
  // Sonar is run by the test STAGE (run-stage.sh), not by the early `quality` step,
  // so `quality` must not also list it (that would double-scan within make all).
  const block = targetBlock(qualityMk, "quality");
  assert.ok(block, "quality target present");
  assert.ok(!/\bsonar\b/.test(block), "`quality` must not include sonar");
});

test("release-confidence runs `make all` and does NOT append a second `make sonar`", () => {
  const block = targetBlock(makefile, "release-confidence");
  assert.ok(block, "release-confidence target present");
  assert.match(block, /\$\(MAKE\)\s+all\b/, "must run make all");
  const sonarInvocations = (block.match(/\$\(MAKE\)\s+sonar\b/g) ?? []).length;
  assert.equal(sonarInvocations, 0, "must not re-run sonar (make all already gates on it)");
});
