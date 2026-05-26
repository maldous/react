#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../..");
const script = path.join(repoRoot, "tools", "architecture", "validate-lifecycle-evidence", "src", "index.mjs");
const validRoot = path.join(repoRoot, "tools", "architecture", "validate-lifecycle-evidence", "tests", "fixtures", "valid");
const invalidRoot = path.join(repoRoot, "tools", "architecture", "validate-lifecycle-evidence", "tests", "fixtures", "invalid", "missing-approver");
const sourceRoot = path.join(repoRoot, "tools", "architecture", "validate-lifecycle-evidence", "tests", "fixtures", "source-repo");
const goldenLifecycleEvidenceRoot = path.join(repoRoot, "tools", "architecture", "validate-lifecycle-evidence", "tests", "fixtures", "golden", "generated-lifecycle-evidence");

function run(root, args) {
  return spawnSync(process.execPath, [script, "--root", root, "--allow-missing-ajv", "--no-reports", "--format", "json", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ARCHITECTURE_EVIDENCE_CREATED_AT: "2026-05-26T00:00:00.000Z"
    }
  });
}

function assertGeneratedFileEquals(actualRoot, goldenRoot, relativePath) {
  assert.equal(
    fs.readFileSync(path.join(actualRoot, relativePath), "utf8"),
    fs.readFileSync(path.join(goldenRoot, relativePath), "utf8")
  );
}

const valid = run(validRoot, ["--check"]);
assert.equal(valid.status, 0, valid.stderr || valid.stdout);
const validPayload = JSON.parse(valid.stdout);
assert.equal(validPayload.totalEvidenceFiles, 1);
assert.equal(validPayload.passed, 1);
assert.equal(validPayload.failed, 0);

const invalid = run(invalidRoot, ["--check"]);
assert.equal(invalid.status, 1, invalid.stderr || invalid.stdout);
const invalidPayload = JSON.parse(invalid.stdout);
assert.equal(invalidPayload.failed, 1);


const coverageRoot = path.join(repoRoot, "tools", "architecture", "validate-lifecycle-evidence", "tests", "fixtures", "coverage");
const validCoverageRoot = path.join(coverageRoot, "valid");
const invalidCoverageRoot = path.join(coverageRoot, "invalid");

const validTransitionExpectations = {
  "stable-transition": ["active.feature", "stable.platform"],
  "external-transition": ["active.adapter", "external.adapter"],
  "deprecated-transition": ["maintenance.adapter", "deprecated.adapter"],
  "contract-transition": ["active.feature", "active.contract"],
  "adapter-transition": ["active.contract", "active.adapter"],
  "tooling-transition": ["active.feature", "active.tooling"],
  "test-transition": ["active.feature", "active.test"]
};

for (const [fixtureName, [fromClass, toClass]] of Object.entries(validTransitionExpectations)) {
  const fixturePath = path.join(validCoverageRoot, fixtureName);
  const result = run(fixturePath, ["--check"]);
  assert.equal(result.status, 0, `${fixtureName} should pass\n${result.stdout}\n${result.stderr}`);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.totalEvidenceFiles, 1);
  assert.equal(payload.passed, 1);
  assert.equal(payload.failed, 0);

  const evidenceFile = path.join(
    fixturePath,
    "docs",
    "evidence",
    "lifecycle",
    fixtureName,
    `2026-05-26-${fromClass.replace(".", "-")}-to-${toClass.replace(".", "-")}`,
    "transition-evidence.json"
  );
  const bundle = JSON.parse(fs.readFileSync(evidenceFile, "utf8"));
  assert.equal(bundle.transition.fromClass, fromClass);
  assert.equal(bundle.transition.toClass, toClass);
}

const invalidTransitionExpectations = {
  "missing-reviewer": "reviewers",
  "missing-approver": "approvers",
  "invalid-adr-ref": "decisionRefs",
  "invalid-lifecycle-class": "fromClass",
  "missing-source-metadata-snapshot": "sourceMetadataSnapshot",
  "missing-test-evidence": "testing.evidence",
  "missing-rollback-strategy": "rollback"
};

for (const [fixtureName, expectedErrorFragment] of Object.entries(invalidTransitionExpectations)) {
  const fixturePath = path.join(invalidCoverageRoot, fixtureName);
  const result = run(fixturePath, ["--check"]);
  assert.equal(result.status, 1, `${fixtureName} should fail\n${result.stdout}\n${result.stderr}`);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.totalEvidenceFiles, 1);
  assert.equal(payload.passed, 0);
  assert.equal(payload.failed, 1);
  const errorText = JSON.stringify(payload.results[0].errors);
  assert.match(errorText, new RegExp(expectedErrorFragment.replace(".", "\\.")), `${fixtureName} error should mention ${expectedErrorFragment}: ${errorText}`);
}

const generated = run(sourceRoot, [
  "--write",
  "--package", "@fixture/package-a",
  "--from-class", "active.feature",
  "--to-class", "stable.platform",
  "--reason", "Ready for stable platform promotion"
]);
assert.equal(generated.status, 0, generated.stderr || generated.stdout);
const generatedPayload = JSON.parse(generated.stdout);
assert.equal(generatedPayload.outputPaths.length, 2);
assert.equal(generatedPayload.passed, 1);
assert.equal(fs.existsSync(path.join(sourceRoot, generatedPayload.outputPaths[0])), true);
assert.equal(fs.existsSync(path.join(sourceRoot, generatedPayload.outputPaths[1])), true);

const generatedBundle = JSON.parse(fs.readFileSync(path.join(sourceRoot, generatedPayload.outputPaths[0]), "utf8"));
assert.equal(generatedBundle.package.name, "@fixture/package-a");
assert.equal(generatedBundle.transition.fromClass, "active.feature");
assert.equal(generatedBundle.transition.toClass, "stable.platform");
assert.equal(generatedBundle.governance.decisionRefs[0], "ADR-0010");
assert.equal(generatedBundle.sourceMetadataSnapshot.packageJsonPath, "packages/package-a/package.json");

assertGeneratedFileEquals(sourceRoot, goldenLifecycleEvidenceRoot, generatedPayload.outputPaths[0]);
assertGeneratedFileEquals(sourceRoot, goldenLifecycleEvidenceRoot, generatedPayload.outputPaths[1]);

const evidence = spawnSync(process.execPath, [script, "--root", validRoot, "--allow-missing-ajv", "--format", "json"], {
  cwd: repoRoot,
  encoding: "utf8"
});
assert.equal(evidence.status, 0, evidence.stderr || evidence.stdout);
const evidencePayload = JSON.parse(evidence.stdout);
assert.match(evidencePayload.selfEvidencePath, /^reports\/tooling\/validate-lifecycle-evidence\/.+-run\.json$/);
assert.equal(fs.existsSync(path.join(validRoot, evidencePayload.selfEvidencePath)), true);

console.log("validate-lifecycle-evidence test passed");
