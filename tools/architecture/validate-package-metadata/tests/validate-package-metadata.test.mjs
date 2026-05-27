#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../..");
const script = path.join(
  repoRoot,
  "tools",
  "architecture",
  "validate-package-metadata",
  "src",
  "index.mjs"
);
const packageJsonPath = path.join(
  repoRoot,
  "tools",
  "architecture",
  "validate-package-metadata",
  "package.json"
);

function run(args) {
  return spawnSync(
    process.execPath,
    [
      script,
      "--root",
      repoRoot,
      "--allow-missing-ajv",
      "--no-reports",
      "--format",
      "json",
      ...args,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
    }
  );
}

function parse(result) {
  assert.doesNotThrow(() => JSON.parse(result.stdout), result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
assert.equal(packageJson.dependencies.ajv, "^8.17.1");

const strictMissingAjv = spawnSync(
  process.execPath,
  [
    script,
    "--root",
    repoRoot,
    "--no-reports",
    "--format",
    "json",
    "tools/architecture/validate-package-metadata/tests/fixtures/valid",
  ],
  {
    cwd: repoRoot,
    encoding: "utf8",
  }
);

const strictMissingAjvPayload = JSON.parse(strictMissingAjv.stdout);
if (strictMissingAjvPayload.schemaValidator.available === false) {
  assert.equal(strictMissingAjv.status, 1, strictMissingAjv.stderr || strictMissingAjv.stdout);
  assert.equal(strictMissingAjvPayload.failed, 1);
  assert.equal(strictMissingAjvPayload.schemaValidator.missingAllowed, false);
}

const valid = run(["tools/architecture/validate-package-metadata/tests/fixtures/valid"]);
assert.equal(valid.status, 0, valid.stderr || valid.stdout);
const validPayload = parse(valid);
assert.equal(validPayload.failed, 0);
assert.equal(validPayload.schemaValidator.name, "ajv");

const missing = run([
  "tools/architecture/validate-package-metadata/tests/fixtures/invalid/missing-architecture",
]);
assert.equal(missing.status, 1, missing.stderr || missing.stdout);
const missingPayload = parse(missing);
assert.equal(missingPayload.failed, 1);

const invalidEnum = run([
  "tools/architecture/validate-package-metadata/tests/fixtures/invalid/invalid-enum",
]);
assert.equal(invalidEnum.status, 1, invalidEnum.stderr || invalidEnum.stdout);
assert.equal(parse(invalidEnum).failed, 1);

const semantic = run([
  "tools/architecture/validate-package-metadata/tests/fixtures/invalid/semantic-lifecycle-class",
]);
assert.equal(semantic.status, 1, semantic.stderr || semantic.stdout);
assert.equal(parse(semantic).failed, 1);

const deprecatedIneligible = run([
  "tools/architecture/validate-package-metadata/tests/fixtures/invalid/lifecycle-deprecated-ineligible",
]);
assert.equal(
  deprecatedIneligible.status,
  1,
  deprecatedIneligible.stderr || deprecatedIneligible.stdout
);
assert.equal(parse(deprecatedIneligible).failed, 1);

const externalPolicy = run([
  "tools/architecture/validate-package-metadata/tests/fixtures/invalid/lifecycle-external-policy",
]);
assert.equal(externalPolicy.status, 1, externalPolicy.stderr || externalPolicy.stdout);
assert.equal(parse(externalPolicy).failed, 1);

const noReportsResult = run(["tools/architecture/validate-package-metadata"]);
assert.equal(noReportsResult.status, 0, noReportsResult.stderr || noReportsResult.stdout);
const noReportsPayload = parse(noReportsResult);
assert.equal(noReportsPayload.toolName, "validate-package-metadata");
assert.equal(noReportsPayload.selfEvidencePath, null);

const reportResult = spawnSync(
  process.execPath,
  [
    script,
    "--root",
    repoRoot,
    "--allow-missing-ajv",
    "tools/architecture/validate-package-metadata",
  ],
  {
    cwd: repoRoot,
    encoding: "utf8",
  }
);

assert.equal(reportResult.status, 0, reportResult.stderr || reportResult.stdout);
assert.match(reportResult.stdout, /Validated 1 package\.json file\(s\)\./);
assert.match(reportResult.stdout, /Schema validator: ajv/);
assert.ok(
  fs.existsSync(path.join(repoRoot, "reports", "validation", "package-metadata-validation.json"))
);
assert.ok(
  fs.existsSync(path.join(repoRoot, "reports", "validation", "package-metadata-validation.md"))
);
assert.match(reportResult.stdout, /Self-evidence:/);

console.log("validate-package-metadata self-test passed");
