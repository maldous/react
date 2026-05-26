#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../..");
const script = path.join(repoRoot, "tools", "architecture", "orchestrator", "src", "index.mjs");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "architecture-orchestrator-invalid-"));

fs.mkdirSync(path.join(tempRoot, "docs", "schemas"), { recursive: true });
fs.mkdirSync(path.join(tempRoot, "tools", "architecture", "validate-package-metadata", "src"), { recursive: true });
fs.copyFileSync(
  path.join(repoRoot, "docs", "schemas", "package-json-architecture.schema.json"),
  path.join(tempRoot, "docs", "schemas", "package-json-architecture.schema.json")
);
fs.copyFileSync(
  path.join(repoRoot, "tools", "architecture", "validate-package-metadata", "src", "index.mjs"),
  path.join(tempRoot, "tools", "architecture", "validate-package-metadata", "src", "index.mjs")
);
fs.writeFileSync(
  path.join(tempRoot, "tools", "architecture", "validate-package-metadata", "package.json"),
  JSON.stringify({ name: "@architecture/validate-package-metadata", version: "0.1.0" }, null, 2)
);

fs.mkdirSync(path.join(tempRoot, "packages", "bad"), { recursive: true });
fs.writeFileSync(path.join(tempRoot, "packages", "bad", "package.json"), JSON.stringify({
  name: "@fixture/bad",
  version: "1.0.0",
  description: "invalid package",
  private: true,
  type: "module",
  exports: {},
  architecture: {
    schemaVersion: "1.0",
    component: { type: "library", name: "bad", system: "fixture", domain: "fixture", boundedContext: "fixture", owner: "fixture" },
    lifecycle: { stage: "active", role: "tooling", class: "wrong", catalogLifecycle: "production", visibility: "internal", supportLevel: "standard", reviewCadence: "quarterly" },
    governance: { decisionRefs: ["ADR-0005"], semverPolicy: "internal-traceable", changeControl: "owner-review", promotionEligible: true },
    runtime: { production: false, testOnly: false, serviceName: "bad", serviceNamespace: "fixture", deploymentEnvironments: ["local"] },
    boundaries: { publicExportsOnly: true, deepImportsAllowed: false, allowedConsumers: ["tooling"], forbiddenConsumers: ["external"] },
    relations: { dependsOn: [], providesApis: [], consumesApis: [] },
    tags: { scope: "architecture", type: "tooling", stage: "active", role: "tooling", layer: "tooling" },
    readme: { generated: true, summary: "bad", responsibilities: [], nonResponsibilities: [], usage: [], operationalNotes: [] }
  }
}, null, 2));

const result = spawnSync(process.execPath, [script, "all", "--root", tempRoot, "--no-reports", "--allow-missing-ajv", "--format", "json"], {
  cwd: repoRoot,
  encoding: "utf8"
});

assert.equal(result.status, 1, result.stderr || result.stdout);
const payload = JSON.parse(result.stdout);
assert.equal(payload.failedStep, "validate-package-metadata");
assert.equal(payload.results[0].status, "failed");
assert.equal(payload.results[1].status, "skipped");
assert.match(payload.results[1].reason, /validate-package-metadata failed/);
console.log("orchestrator failure-stop test passed");
