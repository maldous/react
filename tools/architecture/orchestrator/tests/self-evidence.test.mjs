#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../..");

const requiredToolFields = [
  "toolName",
  "toolVersion",
  "command",
  "mode",
  "root",
  "startedAt",
  "finishedAt",
  "durationMs",
  "inputRoots",
  "outputPaths",
  "rulesEvaluated",
  "checksPassed",
  "checksFailed",
  "warnings",
  "errors",
  "dependencySteps",
  "gitTreatment",
  "exitCode"
];

const requiredOrchestratorFields = [
  "dependencyOrder",
  "stepsRun",
  "stepsSkipped",
  "failedStep",
  "stopReason",
  "evidenceGenerationRequested",
  "evidenceGenerated"
];

function copyDir(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) copyDir(sourcePath, targetPath);
    else fs.copyFileSync(sourcePath, targetPath);
  }
}

function makeRepo() {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "architecture-self-evidence-"));
  copyDir(repoRoot, target);
  fs.rmSync(path.join(target, "reports"), { recursive: true, force: true });
  return target;
}

function run(root, args, env = {}) {
  return spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      ARCHITECTURE_REPORT_GENERATED_AT: "2026-05-26T00:00:00.000Z",
      ARCHITECTURE_EVIDENCE_CREATED_AT: "2026-05-26T00:00:00.000Z",
      ...env
    }
  });
}

function newestEvidence(root, toolName) {
  const dir = path.join(root, "reports", "tooling", toolName);
  assert.equal(fs.existsSync(dir), true, `${toolName} evidence dir should exist`);
  const files = fs.readdirSync(dir).filter((file) => file.endsWith("-run.json")).sort();
  assert.ok(files.length > 0, `${toolName} should emit evidence`);
  return JSON.parse(fs.readFileSync(path.join(dir, files.at(-1)), "utf8"));
}

function assertRequiredFields(evidence, fields, label) {
  for (const field of fields) {
    assert.ok(Object.prototype.hasOwnProperty.call(evidence, field), `${label} missing ${field}`);
  }
}

function assertNoEvidence(root, toolName) {
  const dir = path.join(root, "reports", "tooling", toolName);
  assert.equal(fs.existsSync(dir), false, `${toolName} should not emit self-evidence with --no-reports`);
}

const root = makeRepo();

const validator = run(root, [
  "tools/architecture/validate-package-metadata/src/index.mjs",
  "--root", root,
  "--allow-missing-ajv",
  "--format", "json",
  "tools/architecture"
]);
assert.equal(validator.status, 0, validator.stderr || validator.stdout);
const validatorEvidence = newestEvidence(root, "validate-package-metadata");
assertRequiredFields(validatorEvidence, requiredToolFields, "validate-package-metadata");
assert.equal(validatorEvidence.toolName, "validate-package-metadata");

const readmes = run(root, [
  "tools/architecture/generate-package-readmes/src/index.mjs",
  "--root", root,
  "--check",
  "--format", "json",
  "tools/architecture"
]);
assert.equal(readmes.status, 0, readmes.stderr || readmes.stdout);
const readmesEvidence = newestEvidence(root, "generate-package-readmes");
assertRequiredFields(readmesEvidence, requiredToolFields, "generate-package-readmes");
assert.equal(readmesEvidence.toolName, "generate-package-readmes");

const inventoryWrite = run(root, [
  "tools/architecture/generate-package-inventory/src/index.mjs",
  "--root", root,
  "--write",
  "--format", "json",
  "apps",
  "packages",
  "tools/architecture"
]);
assert.equal(inventoryWrite.status, 0, inventoryWrite.stderr || inventoryWrite.stdout);
const inventoryEvidence = newestEvidence(root, "generate-package-inventory");
assertRequiredFields(inventoryEvidence, requiredToolFields, "generate-package-inventory");
assert.equal(inventoryEvidence.toolName, "generate-package-inventory");

const sourceImports = run(root, [
  "tools/architecture/validate-source-imports/src/index.mjs",
  "--root", root,
  "--format", "json",
  "--check",
  "apps",
  "packages"
]);
assert.equal(sourceImports.status, 0, sourceImports.stderr || sourceImports.stdout);
const sourceImportsEvidence = newestEvidence(root, "validate-source-imports");
assertRequiredFields(sourceImportsEvidence, requiredToolFields, "validate-source-imports");
assert.equal(sourceImportsEvidence.toolName, "validate-source-imports");

const lifecycleReports = run(root, [
  "tools/architecture/generate-lifecycle-reports/src/index.mjs",
  "--root", root,
  "--write",
  "--format", "json",
  "apps",
  "packages",
  "tools/architecture"
]);
assert.equal(lifecycleReports.status, 0, lifecycleReports.stderr || lifecycleReports.stdout);
const lifecycleReportsEvidence = newestEvidence(root, "generate-lifecycle-reports");
assertRequiredFields(lifecycleReportsEvidence, requiredToolFields, "generate-lifecycle-reports");
assert.equal(lifecycleReportsEvidence.toolName, "generate-lifecycle-reports");

const lifecycle = run(root, [
  "tools/architecture/validate-lifecycle-evidence/src/index.mjs",
  "--root", root,
  "--allow-missing-ajv",
  "--format", "json"
]);
assert.equal(lifecycle.status, 0, lifecycle.stderr || lifecycle.stdout);
const lifecycleEvidence = newestEvidence(root, "validate-lifecycle-evidence");
assertRequiredFields(lifecycleEvidence, requiredToolFields, "validate-lifecycle-evidence");
assert.equal(lifecycleEvidence.toolName, "validate-lifecycle-evidence");

const orchestrator = run(root, [
  "tools/architecture/orchestrator/src/index.mjs",
  "all",
  "--root", root,
  "--allow-missing-ajv",
  "--format", "json"
]);
assert.equal(orchestrator.status, 0, orchestrator.stderr || orchestrator.stdout);
const orchestratorEvidence = newestEvidence(root, "orchestrator");
assertRequiredFields(orchestratorEvidence, requiredToolFields, "orchestrator");
assertRequiredFields(orchestratorEvidence, requiredOrchestratorFields, "orchestrator");
assert.equal(orchestratorEvidence.toolName, "orchestrator");
assert.equal(orchestratorEvidence.evidenceGenerationRequested, false);

const noReportsRoot = makeRepo();
const noReports = [
  ["validate-package-metadata", [
    "tools/architecture/validate-package-metadata/src/index.mjs",
    "--root", noReportsRoot,
    "--allow-missing-ajv",
    "--no-reports",
    "--format", "json",
    "tools/architecture"
  ]],
  ["generate-package-readmes", [
    "tools/architecture/generate-package-readmes/src/index.mjs",
    "--root", noReportsRoot,
    "--check",
    "--no-reports",
    "--format", "json",
    "tools/architecture"
  ]],
  ["generate-package-inventory", [
    "tools/architecture/generate-package-inventory/src/index.mjs",
    "--root", noReportsRoot,
    "--write",
    "--no-reports",
    "--format", "json",
    "apps",
    "packages",
    "tools/architecture"
  ]],
  ["validate-source-imports", [
    "tools/architecture/validate-source-imports/src/index.mjs",
    "--root", noReportsRoot,
    "--check",
    "--no-reports",
    "--format", "json",
    "apps",
    "packages"
  ]],
  ["generate-lifecycle-reports", [
    "tools/architecture/generate-lifecycle-reports/src/index.mjs",
    "--root", noReportsRoot,
    "--write",
    "--no-reports",
    "--format", "json",
    "apps",
    "packages",
    "tools/architecture"
  ]],
  ["validate-lifecycle-evidence", [
    "tools/architecture/validate-lifecycle-evidence/src/index.mjs",
    "--root", noReportsRoot,
    "--allow-missing-ajv",
    "--no-reports",
    "--format", "json"
  ]],
  ["orchestrator", [
    "tools/architecture/orchestrator/src/index.mjs",
    "all",
    "--root", noReportsRoot,
    "--allow-missing-ajv",
    "--plan-only",
    "--no-reports",
    "--format", "json"
  ]]
];

for (const [toolName, args] of noReports) {
  const result = run(noReportsRoot, args);
  assert.equal(result.status, 0, `${toolName} --no-reports should pass\n${result.stdout}\n${result.stderr}`);
  assertNoEvidence(noReportsRoot, toolName);
}

console.log("self-evidence coverage test passed");
