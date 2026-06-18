#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("orchestrator validate mode runs only the metadata validator", async () => {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../..");
  const script = path.join(repoRoot, "tools", "architecture", "orchestrator", "src", "index.mjs");

  const result = spawnSync(
    process.execPath,
    [
      script,
      "validate",
      "--root",
      repoRoot,
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

  assert.equal(payload.dependencyOrder.length, 1);
  assert.equal(payload.dependencyOrder[0], "validate-package-metadata");
  assert.equal(payload.results[0].status, "passed");
  assert.equal(payload.evidencePath, null);
  console.log("orchestrator check-mode test passed");
});
