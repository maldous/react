#!/usr/bin/env node
/**
 * Unit tests for the orchestrator's internal functions.
 * Imports functions directly (not via spawnSync) to boost in-process coverage.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

import { parseArgs, findRepoRoot, buildStepCatalog, planFor } from "../src/index.mjs";

// ─── parseArgs ───────────────────────────────────────────────────────────────

test("parseArgs: defaults to validate command with text format", () => {
  const opts = parseArgs([]);
  assert.equal(opts.command, "validate");
  assert.equal(opts.format, "text");
  assert.equal(opts.noReports, false);
  assert.equal(opts.planOnly, false);
  assert.equal(opts.allowMissingAjv, false);
  assert.equal(opts.evidenceGenerationRequested, false);
  assert.equal(opts.strict, false);
});

test("parseArgs: recognizes all valid commands", () => {
  const commands = [
    "validate",
    "all",
    "generate-readmes",
    "generate-inventory",
    "generate-lifecycle-reports",
    "validate-evidence",
    "generate-lifecycle-evidence",
  ];
  for (const cmd of commands) {
    const opts = parseArgs([cmd]);
    assert.equal(opts.command, cmd, `command ${cmd} must be recognized`);
  }
});

test("parseArgs: --format json sets json format", () => {
  const opts = parseArgs(["--format", "json"]);
  assert.equal(opts.format, "json");
});

test("parseArgs: --no-reports sets noReports flag", () => {
  const opts = parseArgs(["--no-reports"]);
  assert.equal(opts.noReports, true);
});

test("parseArgs: --plan-only sets planOnly flag", () => {
  const opts = parseArgs(["--plan-only"]);
  assert.equal(opts.planOnly, true);
});

test("parseArgs: --allow-missing-ajv sets flag", () => {
  const opts = parseArgs(["--allow-missing-ajv"]);
  assert.equal(opts.allowMissingAjv, true);
});

test("parseArgs: --evidence-generation-requested sets flag", () => {
  const opts = parseArgs(["--evidence-generation-requested"]);
  assert.equal(opts.evidenceGenerationRequested, true);
});

test("parseArgs: --strict sets strict flag", () => {
  const opts = parseArgs(["--strict"]);
  assert.equal(opts.strict, true);
});

test("parseArgs: --root sets root path", () => {
  const opts = parseArgs(["--root", "/some/path"]);
  assert.equal(opts.root, "/some/path");
});

test("parseArgs: command followed by options", () => {
  const opts = parseArgs(["all", "--no-reports", "--format", "json"]);
  assert.equal(opts.command, "all");
  assert.equal(opts.noReports, true);
  assert.equal(opts.format, "json");
});

test("parseArgs: throws on invalid format", () => {
  assert.throws(() => parseArgs(["--format", "csv"]), /--format must be text or json/);
});

test("parseArgs: throws on unknown option", () => {
  assert.throws(() => parseArgs(["--unknown"]), /Unknown option: --unknown/);
});

// ─── findRepoRoot ─────────────────────────────────────────────────────────────

test("findRepoRoot: finds repo root from inside the tools directory", () => {
  const found = findRepoRoot(path.join(repoRoot, "tools", "architecture", "orchestrator"));
  assert.equal(found, repoRoot);
});

test("findRepoRoot: returns startDir when schema not found", () => {
  const found = findRepoRoot("/nonexistent/path/xyz");
  assert.equal(found, "/nonexistent/path/xyz");
});

// ─── buildStepCatalog ─────────────────────────────────────────────────────────

function defaultOptions(overrides = {}) {
  return {
    command: "validate",
    root: repoRoot,
    format: "text",
    noReports: false,
    planOnly: false,
    allowMissingAjv: false,
    evidenceGenerationRequested: false,
    strict: false,
    ...overrides,
  };
}

test("buildStepCatalog: returns all expected step keys", () => {
  const catalog = buildStepCatalog(defaultOptions(), repoRoot);
  const expectedKeys = [
    "metadata",
    "sourceImports",
    "readmesCheck",
    "readmesWrite",
    "inventoryWrite",
    "lifecycleReportsWrite",
    "evidenceCheck",
    "evidenceWrite",
  ];
  for (const key of expectedKeys) {
    assert.ok(key in catalog, `catalog must have key: ${key}`);
  }
});

test("buildStepCatalog: each step has required shape", () => {
  const catalog = buildStepCatalog(defaultOptions(), repoRoot);
  for (const [key, step] of Object.entries(catalog)) {
    assert.equal(typeof step.name, "string", `${key}.name must be string`);
    assert.equal(typeof step.toolPath, "string", `${key}.toolPath must be string`);
    assert.equal(typeof step.scriptPath, "string", `${key}.scriptPath must be string`);
    assert.ok(Array.isArray(step.args), `${key}.args must be array`);
    assert.equal(typeof step.required, "boolean", `${key}.required must be boolean`);
  }
});

test("buildStepCatalog: metadata step includes --root and REPO_ROOT", () => {
  const catalog = buildStepCatalog(defaultOptions(), repoRoot);
  assert.ok(catalog.metadata.args.includes("--root"));
  assert.ok(catalog.metadata.args.includes(repoRoot));
});

test("buildStepCatalog: noReports adds --no-reports flag to steps", () => {
  const catalog = buildStepCatalog(defaultOptions({ noReports: true }), repoRoot);
  assert.ok(catalog.metadata.args.includes("--no-reports"));
  assert.ok(catalog.sourceImports.args.includes("--no-reports"));
  assert.ok(catalog.evidenceCheck.args.includes("--no-reports"));
});

test("buildStepCatalog: strict adds --strict flag to sourceImports step", () => {
  const catalog = buildStepCatalog(defaultOptions({ strict: true }), repoRoot);
  assert.ok(catalog.sourceImports.args.includes("--strict"));
  // strict flag should NOT appear in metadata step
  assert.ok(!catalog.metadata.args.includes("--strict"));
});

test("buildStepCatalog: allowMissingAjv adds flag to metadata and evidenceCheck", () => {
  const catalog = buildStepCatalog(defaultOptions({ allowMissingAjv: true }), repoRoot);
  assert.ok(catalog.metadata.args.includes("--allow-missing-ajv"));
  assert.ok(catalog.evidenceCheck.args.includes("--allow-missing-ajv"));
  // sourceImports should NOT have allow-missing-ajv
  assert.ok(!catalog.sourceImports.args.includes("--allow-missing-ajv"));
});

test("buildStepCatalog: lifecycleReportsWrite is not required", () => {
  const catalog = buildStepCatalog(defaultOptions(), repoRoot);
  assert.equal(catalog.lifecycleReportsWrite.required, false);
});

test("buildStepCatalog: scriptPaths are rooted in repoRoot", () => {
  const catalog = buildStepCatalog(defaultOptions(), repoRoot);
  for (const [, step] of Object.entries(catalog)) {
    assert.ok(
      step.scriptPath.startsWith(repoRoot),
      `scriptPath must be absolute under repoRoot: ${step.scriptPath}`
    );
    assert.ok(step.scriptPath.endsWith("src/index.mjs"));
  }
});

// ─── planFor ─────────────────────────────────────────────────────────────────

test("planFor: validate returns just metadata step", () => {
  const opts = defaultOptions({ command: "validate" });
  const plan = planFor("validate", opts, repoRoot);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].name, "validate-package-metadata");
});

test("planFor: all returns 6 steps in dependency order", () => {
  const opts = defaultOptions({ command: "all" });
  const plan = planFor("all", opts, repoRoot);
  assert.equal(plan.length, 6);
  const names = plan.map((s) => s.name);
  // metadata must come first
  assert.equal(names[0], "validate-package-metadata");
  // evidence check comes last
  assert.equal(names[names.length - 1], "validate-lifecycle-evidence");
});

test("planFor: generate-readmes returns metadata + readmesWrite", () => {
  const opts = defaultOptions({ command: "generate-readmes" });
  const plan = planFor("generate-readmes", opts, repoRoot);
  assert.equal(plan.length, 2);
  assert.equal(plan[0].name, "validate-package-metadata");
  assert.equal(plan[1].name, "generate-package-readmes");
});

test("planFor: generate-inventory includes metadata, readmesCheck, inventoryWrite", () => {
  const opts = defaultOptions({ command: "generate-inventory" });
  const plan = planFor("generate-inventory", opts, repoRoot);
  assert.equal(plan.length, 3);
  const names = plan.map((s) => s.name);
  assert.ok(names.includes("validate-package-metadata"));
  assert.ok(names.includes("generate-package-readmes"));
  assert.ok(names.includes("generate-package-inventory"));
});

test("planFor: generate-lifecycle-reports has 4 steps", () => {
  const opts = defaultOptions({ command: "generate-lifecycle-reports" });
  const plan = planFor("generate-lifecycle-reports", opts, repoRoot);
  assert.equal(plan.length, 4);
});

test("planFor: validate-evidence has 6 steps", () => {
  const opts = defaultOptions({ command: "validate-evidence" });
  const plan = planFor("validate-evidence", opts, repoRoot);
  assert.equal(plan.length, 6);
  const names = plan.map((s) => s.name);
  assert.ok(names.includes("validate-source-imports"));
  assert.ok(names.includes("validate-lifecycle-evidence"));
});

test("planFor: generate-lifecycle-evidence without evidenceGenerationRequested returns error step", () => {
  const opts = defaultOptions({
    command: "generate-lifecycle-evidence",
    evidenceGenerationRequested: false,
  });
  const plan = planFor("generate-lifecycle-evidence", opts, repoRoot);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].name, "generate-lifecycle-evidence");
  assert.ok(plan[0].error, "must have an error field");
  assert.ok(plan[0].error.includes("explicit transition intent"));
});

test("planFor: generate-lifecycle-evidence with evidenceGenerationRequested returns full plan", () => {
  const opts = defaultOptions({
    command: "generate-lifecycle-evidence",
    evidenceGenerationRequested: true,
  });
  const plan = planFor("generate-lifecycle-evidence", opts, repoRoot);
  assert.ok(plan.length > 1, "must have multiple steps when evidence generation is requested");
  const names = plan.map((s) => s.name);
  assert.ok(names.includes("validate-package-metadata"));
  assert.ok(names.includes("validate-source-imports"));
  // evidenceWrite and evidenceCheck should both appear
  const evidenceSteps = names.filter(
    (n) => n === "validate-lifecycle-evidence" || n === "generate-lifecycle-evidence"
  );
  assert.ok(evidenceSteps.length >= 2, "must include both write and check steps");
});

test("planFor: throws on unsupported command", () => {
  const opts = defaultOptions();
  assert.throws(() => planFor("invalid-command", opts, repoRoot), /Unsupported command/);
});
