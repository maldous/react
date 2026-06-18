#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("orchestrator requires explicit transition intent for lifecycle evidence", async () => {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../..");
  const script = path.join(repoRoot, "tools", "architecture", "orchestrator", "src", "index.mjs");

  const result = spawnSync(
    process.execPath,
    [
      script,
      "generate-lifecycle-evidence",
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

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.failedStep, "generate-lifecycle-evidence");
  assert.match(payload.results[0].reason, /explicit transition intent/);
  console.log("orchestrator write-mode test passed");
});
