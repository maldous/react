#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../..");
const script = path.join(repoRoot, "tools", "architecture", "orchestrator", "src", "index.mjs");

const result = spawnSync(
  process.execPath,
  [
    script,
    "all",
    "--root",
    repoRoot,
    "--plan-only",
    "--no-reports",
    "--allow-missing-ajv",
    "--format",
    "json",
  ],
  {
    cwd: repoRoot,
    encoding: "utf8",
  }
);

assert.equal(result.status, 0, result.stderr || result.stdout);
const payload = JSON.parse(result.stdout);

assert.deepEqual(payload.dependencyOrder, [
  "validate-package-metadata",
  "validate-source-imports",
  "generate-package-readmes",
  "generate-package-inventory",
  "generate-lifecycle-reports",
  "validate-lifecycle-evidence",
  "validate-slice-readiness",
  "validate-i18n",
]);

assert.equal(payload.exitCode, 0);
assert.equal(payload.evidencePath, null);
console.log("orchestrator dependency-order test passed");
