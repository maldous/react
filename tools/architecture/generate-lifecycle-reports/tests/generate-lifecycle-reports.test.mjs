#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../..");
const script = path.join(repoRoot, "tools", "architecture", "generate-lifecycle-reports", "src", "index.mjs");
const fixtureRoot = path.join(repoRoot, "tools", "architecture", "generate-lifecycle-reports", "tests", "fixtures", "valid");
const goldenRoot = path.join(repoRoot, "tools", "architecture", "generate-lifecycle-reports", "tests", "fixtures", "golden");

function copyDir(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDir(sourcePath, targetPath);
    } else {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function makeFixtureRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "generate-lifecycle-reports-"));
  copyDir(fixtureRoot, root);
  return root;
}

function run(root, args) {
  return spawnSync(process.execPath, [script, "--root", root, "--no-reports", "--format", "json", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ARCHITECTURE_REPORT_GENERATED_AT: "2026-05-26T00:00:00.000Z"
    }
  });
}

function assertFileEquals(actual, expected) {
  assert.equal(fs.readFileSync(actual, "utf8"), fs.readFileSync(expected, "utf8"));
}

// Stale check: fresh fixture has no reports yet, so check should fail
const staleRoot = makeFixtureRepo();
const staleResult = run(staleRoot, ["--check", "packages"]);
assert.equal(staleResult.status, 1, staleResult.stderr || staleResult.stdout);
const stalePayload = JSON.parse(staleResult.stdout);
assert.equal(stalePayload.stale, 2);

// Write mode: generate reports
const writeRoot = makeFixtureRepo();
const writeResult = run(writeRoot, ["--write", "packages"]);
assert.equal(writeResult.status, 0, writeResult.stderr || writeResult.stdout);
const writePayload = JSON.parse(writeResult.stdout);
assert.equal(writePayload.totalPackages, 5);
assert.equal(writePayload.written, 2);

// Golden file comparison
assertFileEquals(
  path.join(writeRoot, "reports", "lifecycle", "lifecycle-governance-report.json"),
  path.join(goldenRoot, "reports", "lifecycle", "lifecycle-governance-report.json")
);
assertFileEquals(
  path.join(writeRoot, "reports", "lifecycle", "lifecycle-governance-report.md"),
  path.join(goldenRoot, "reports", "lifecycle", "lifecycle-governance-report.md")
);

// Spot-check report content
const governanceJson = JSON.parse(
  fs.readFileSync(path.join(writeRoot, "reports", "lifecycle", "lifecycle-governance-report.json"), "utf8")
);
assert.equal(governanceJson.totalPackages, 5);
assert.equal(governanceJson.promotionEligiblePackages.length, 1);
assert.equal(governanceJson.promotionEligiblePackages[0].name, "@fixture/active-platform");
assert.equal(governanceJson.maintenancePackages.length, 1);
assert.equal(governanceJson.deprecatedPackages.length, 1);
assert.equal(governanceJson.externalPackages.length, 1);
assert.deepEqual(Object.keys(governanceJson.byDomain).sort(), ["core", "experience", "integration"]);
assert.deepEqual(Object.keys(governanceJson.byOwner).sort(), ["team-api", "team-app", "team-core", "team-infra"]);

// Fresh check: after write, check should pass
const freshResult = run(writeRoot, ["--check", "packages"]);
assert.equal(freshResult.status, 0, freshResult.stderr || freshResult.stdout);
assert.equal(JSON.parse(freshResult.stdout).stale, 0);

// Self-evidence: --write without --no-reports emits tooling report
const evidenceRoot = makeFixtureRepo();
const evidenceResult = spawnSync(process.execPath, [script, "--root", evidenceRoot, "--write", "--format", "json", "packages"], {
  cwd: repoRoot,
  encoding: "utf8",
  env: {
    ...process.env,
    ARCHITECTURE_REPORT_GENERATED_AT: "2026-05-26T00:00:00.000Z"
  }
});
assert.equal(evidenceResult.status, 0, evidenceResult.stderr || evidenceResult.stdout);
const evidencePayload = JSON.parse(evidenceResult.stdout);
assert.match(evidencePayload.selfEvidencePath, /^reports\/tooling\/generate-lifecycle-reports\/.+-run\.json$/);
assert.equal(fs.existsSync(path.join(evidenceRoot, evidencePayload.selfEvidencePath)), true);

console.log("generate-lifecycle-reports test passed");
