#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("generate-package-inventory check, write, golden, and self-evidence", async () => {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../..");
  const script = path.join(
    repoRoot,
    "tools",
    "architecture",
    "generate-package-inventory",
    "src",
    "index.mjs"
  );
  const fixtureRoot = path.join(
    repoRoot,
    "tools",
    "architecture",
    "generate-package-inventory",
    "tests",
    "fixtures",
    "valid"
  );
  const goldenRoot = path.join(
    repoRoot,
    "tools",
    "architecture",
    "generate-package-inventory",
    "tests",
    "fixtures",
    "golden"
  );

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
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "generate-package-inventory-"));
    copyDir(fixtureRoot, root);
    return root;
  }

  function run(root, args) {
    return spawnSync(
      process.execPath,
      [script, "--root", root, "--no-reports", "--format", "json", ...args],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          ARCHITECTURE_REPORT_GENERATED_AT: "2026-05-26T00:00:00.000Z",
        },
      }
    );
  }

  function assertFileEquals(actual, expected) {
    assert.equal(fs.readFileSync(actual, "utf8"), fs.readFileSync(expected, "utf8"));
  }

  const staleRoot = makeFixtureRepo();
  const staleResult = run(staleRoot, ["--check", "packages"]);
  assert.equal(staleResult.status, 1, staleResult.stderr || staleResult.stdout);
  const stalePayload = JSON.parse(staleResult.stdout);
  assert.equal(stalePayload.stale, 4);

  const writeRoot = makeFixtureRepo();
  const writeResult = run(writeRoot, ["--write", "packages"]);
  assert.equal(writeResult.status, 0, writeResult.stderr || writeResult.stdout);
  const writePayload = JSON.parse(writeResult.stdout);
  assert.equal(writePayload.totalPackages, 8);
  assert.equal(writePayload.written, 4);

  assertFileEquals(
    path.join(writeRoot, "reports", "package-inventory", "package-inventory.json"),
    path.join(goldenRoot, "reports", "package-inventory", "package-inventory.json")
  );
  assertFileEquals(
    path.join(writeRoot, "reports", "package-inventory", "package-inventory.md"),
    path.join(goldenRoot, "reports", "package-inventory", "package-inventory.md")
  );
  assertFileEquals(
    path.join(writeRoot, "reports", "lifecycle", "package-lifecycle-summary.json"),
    path.join(goldenRoot, "reports", "lifecycle", "package-lifecycle-summary.json")
  );
  assertFileEquals(
    path.join(writeRoot, "reports", "lifecycle", "package-lifecycle-summary.md"),
    path.join(goldenRoot, "reports", "lifecycle", "package-lifecycle-summary.md")
  );

  const inventoryJson = JSON.parse(
    fs.readFileSync(
      path.join(writeRoot, "reports", "package-inventory", "package-inventory.json"),
      "utf8"
    )
  );
  const lifecycleJson = JSON.parse(
    fs.readFileSync(
      path.join(writeRoot, "reports", "lifecycle", "package-lifecycle-summary.json"),
      "utf8"
    )
  );

  assert.equal(inventoryJson.totalPackages, 8);
  assert.deepEqual(Object.keys(lifecycleJson.byClass).sort(), [
    "active.contract",
    "active.feature",
    "active.platform",
    "active.test",
    "active.tooling",
    "external.adapter",
    "stable.platform",
  ]);
  assert.equal(lifecycleJson.byClass["active.feature"], 2);
  assert.equal(lifecycleJson.byRole.adapter, 1);
  assert.equal(lifecycleJson.byRole.contract, 1);
  assert.equal(lifecycleJson.byRole.feature, 2);
  assert.equal(lifecycleJson.byRole.platform, 2);
  assert.equal(lifecycleJson.byRole.test, 1);
  assert.equal(lifecycleJson.byRole.tooling, 1);

  const byName = Object.fromEntries(inventoryJson.packages.map((record) => [record.name, record]));
  assert.equal(byName["@fixture/app"].component.owner, "team-app");
  assert.equal(byName["@fixture/app"].component.domain, "experience");
  assert.equal(byName["@fixture/app"].component.boundedContext, "checkout");
  assert.equal(byName["@fixture/app"].lifecycle.class, "active.feature");
  assert.equal(byName["@fixture/app"].governance.promotionEligible, true);
  assert.deepEqual(byName["@fixture/app"].governance.decisionRefs, ["ADR-0009"]);
  assert.deepEqual(byName["@fixture/app"].relations.dependsOn, ["@fixture/feature"]);
  assert.deepEqual(byName["@fixture/app"].relations.providesApis, ["checkout-ui"]);
  assert.deepEqual(byName["@fixture/app"].relations.consumesApis, ["checkout-command"]);

  assert.equal(byName["@fixture/adapter"].lifecycle.class, "external.adapter");
  assert.equal(byName["@fixture/adapter"].lifecycle.visibility, "external");
  assert.equal(byName["@fixture/adapter"].governance.promotionEligible, false);
  assert.deepEqual(byName["@fixture/adapter"].relations.dependsOn, ["@fixture/contract"]);
  assert.deepEqual(byName["@fixture/test"].runtime.testOnly, true);

  const freshResult = run(writeRoot, ["--check", "packages"]);
  assert.equal(freshResult.status, 0, freshResult.stderr || freshResult.stdout);
  assert.equal(JSON.parse(freshResult.stdout).stale, 0);

  const evidenceRoot = makeFixtureRepo();
  const evidenceResult = spawnSync(
    process.execPath,
    [script, "--root", evidenceRoot, "--write", "--format", "json", "packages"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        ARCHITECTURE_REPORT_GENERATED_AT: "2026-05-26T00:00:00.000Z",
      },
    }
  );
  assert.equal(evidenceResult.status, 0, evidenceResult.stderr || evidenceResult.stdout);
  const evidencePayload = JSON.parse(evidenceResult.stdout);
  assert.match(
    evidencePayload.selfEvidencePath,
    /^reports\/tooling\/generate-package-inventory\/.+-run\.json$/
  );
  assert.equal(fs.existsSync(path.join(evidenceRoot, evidencePayload.selfEvidencePath)), true);

  console.log("generate-package-inventory test passed");
});
