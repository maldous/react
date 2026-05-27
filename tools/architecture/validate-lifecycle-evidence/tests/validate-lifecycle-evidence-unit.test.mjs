#!/usr/bin/env node
/**
 * Unit tests for validate-lifecycle-evidence internal functions.
 * Imports functions directly (not via spawnSync) to boost in-process coverage.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

import {
  parseArgs,
  findRepoRoot,
  VALUE_OPTS,
  FLAG_OPTS,
  validateBundleTopLevelFields,
  validateBundleTransition,
  validateBundleGovernance,
  validateBundleTesting,
  validateBundleRollback,
  validateBundleSnapshot,
  fallbackValidate,
} from "../src/index.mjs";

// ─── VALUE_OPTS and FLAG_OPTS maps ────────────────────────────────────────────

test("VALUE_OPTS: is a Map with all expected option keys", () => {
  assert.ok(VALUE_OPTS instanceof Map);
  const expectedKeys = [
    "--root",
    "--format",
    "--package",
    "--from-class",
    "--to-class",
    "--reason",
    "--created-by",
    "--reviewer",
    "--approver",
  ];
  for (const key of expectedKeys) {
    assert.ok(VALUE_OPTS.has(key), `VALUE_OPTS must have key: ${key}`);
  }
});

test("VALUE_OPTS: maps to correct option names", () => {
  assert.equal(VALUE_OPTS.get("--root"), "root");
  assert.equal(VALUE_OPTS.get("--format"), "format");
  assert.equal(VALUE_OPTS.get("--package"), "packageName");
  assert.equal(VALUE_OPTS.get("--from-class"), "fromClass");
  assert.equal(VALUE_OPTS.get("--to-class"), "toClass");
  assert.equal(VALUE_OPTS.get("--reason"), "reason");
});

test("FLAG_OPTS: is a Map with all expected flag keys", () => {
  assert.ok(FLAG_OPTS instanceof Map);
  const expectedKeys = ["--no-reports", "--write", "--check", "--allow-missing-ajv"];
  for (const key of expectedKeys) {
    assert.ok(FLAG_OPTS.has(key), `FLAG_OPTS must have key: ${key}`);
  }
});

test("FLAG_OPTS: --write sets write=true, --check sets write=false", () => {
  const [writeKey, writeVal] = FLAG_OPTS.get("--write");
  const [checkKey, checkVal] = FLAG_OPTS.get("--check");
  assert.equal(writeKey, "write");
  assert.equal(writeVal, true);
  assert.equal(checkKey, "write");
  assert.equal(checkVal, false);
});

// ─── parseArgs ───────────────────────────────────────────────────────────────

test("parseArgs: defaults", () => {
  const opts = parseArgs([]);
  assert.equal(opts.root, null);
  assert.equal(opts.format, "text");
  assert.equal(opts.noReports, false);
  assert.equal(opts.write, false);
  assert.equal(opts.allowMissingAjv, false);
  assert.equal(opts.packageName, null);
  assert.equal(opts.fromClass, null);
  assert.equal(opts.toClass, null);
  assert.equal(opts.reason, null);
  assert.equal(opts.createdBy, "architecture-tooling");
  assert.equal(opts.reviewer, "architecture-reviewer");
  assert.equal(opts.approver, "architecture-approver");
  assert.deepEqual(opts.roots, []);
});

test("parseArgs: --root sets root", () => {
  const opts = parseArgs(["--root", "/my/path"]);
  assert.equal(opts.root, "/my/path");
});

test("parseArgs: --format json", () => {
  const opts = parseArgs(["--format", "json"]);
  assert.equal(opts.format, "json");
});

test("parseArgs: --write sets write=true", () => {
  const opts = parseArgs(["--write"]);
  assert.equal(opts.write, true);
});

test("parseArgs: --check sets write=false", () => {
  const opts = parseArgs(["--write", "--check"]); // check overrides write
  assert.equal(opts.write, false);
});

test("parseArgs: --no-reports sets noReports=true", () => {
  const opts = parseArgs(["--no-reports"]);
  assert.equal(opts.noReports, true);
});

test("parseArgs: --allow-missing-ajv sets flag", () => {
  const opts = parseArgs(["--allow-missing-ajv"]);
  assert.equal(opts.allowMissingAjv, true);
});

test("parseArgs: --package sets packageName", () => {
  const opts = parseArgs(["--package", "@platform/foo"]);
  assert.equal(opts.packageName, "@platform/foo");
});

test("parseArgs: --from-class and --to-class", () => {
  const opts = parseArgs([
    "--from-class",
    "experimental.feature",
    "--to-class",
    "candidate.feature",
  ]);
  assert.equal(opts.fromClass, "experimental.feature");
  assert.equal(opts.toClass, "candidate.feature");
});

test("parseArgs: --reason sets reason", () => {
  const opts = parseArgs(["--reason", "Package is ready for promotion"]);
  assert.equal(opts.reason, "Package is ready for promotion");
});

test("parseArgs: --created-by, --reviewer, --approver override defaults", () => {
  const opts = parseArgs(["--created-by", "alice", "--reviewer", "bob", "--approver", "carol"]);
  assert.equal(opts.createdBy, "alice");
  assert.equal(opts.reviewer, "bob");
  assert.equal(opts.approver, "carol");
});

test("parseArgs: positional args go to roots", () => {
  const opts = parseArgs(["docs/evidence/lifecycle", "docs/evidence/exceptions"]);
  assert.deepEqual(opts.roots, ["docs/evidence/lifecycle", "docs/evidence/exceptions"]);
});

test("parseArgs: throws on invalid format", () => {
  assert.throws(() => parseArgs(["--format", "yaml"]), /--format must be text or json/);
});

test("parseArgs: throws on unknown option", () => {
  assert.throws(() => parseArgs(["--unknown-flag"]), /Unknown option: --unknown-flag/);
});

// ─── findRepoRoot ─────────────────────────────────────────────────────────────

test("findRepoRoot: finds repo root from deep inside the tools directory", () => {
  const found = findRepoRoot(
    path.join(repoRoot, "tools", "architecture", "validate-lifecycle-evidence", "src")
  );
  assert.equal(found, repoRoot);
});

test("findRepoRoot: returns startDir when docs/schemas not found", () => {
  const found = findRepoRoot("/nonexistent/path");
  assert.equal(found, "/nonexistent/path");
});

// ─── validateBundleTopLevelFields ─────────────────────────────────────────────

function makeValidBundle(overrides = {}) {
  return {
    schemaVersion: "1.0",
    bundle: {
      id: "test:from->to:2024-01-01",
      createdAt: "2024-01-01T00:00:00.000Z",
      status: "draft",
    },
    package: { name: "@platform/foo", path: "packages/foo/package.json", owner: "team-platform" },
    transition: {
      fromClass: "experimental.feature",
      toClass: "candidate.feature",
      reason: "ready",
      requestedAt: "2024-01-01T00:00:00.000Z",
    },
    governance: {
      decisionRefs: ["ADR-0010"],
      reviewers: [
        {
          name: "alice",
          role: "reviewer",
          reviewedAt: "2024-01-01T00:00:00.000Z",
          evidenceRef: "test",
        },
      ],
      approvers: [
        {
          name: "bob",
          role: "approver",
          reviewedAt: "2024-01-01T00:00:00.000Z",
          evidenceRef: "test",
        },
      ],
    },
    risk: { level: "low", assessment: "Low risk", mitigations: [] },
    testing: { summary: "Tests pass", evidence: [{ path: "test.json", description: "evidence" }] },
    impact: { runtimeImpact: "None", consumerImpact: "None" },
    rollback: { strategy: "Revert the change" },
    sourceMetadataSnapshot: { packageJsonPath: "packages/foo/package.json", architecture: {} },
    reportReferences: [{ path: "report.json", description: "Report" }],
    ...overrides,
  };
}

test("validateBundleTopLevelFields: no errors for complete bundle", () => {
  const errors = [];
  validateBundleTopLevelFields(makeValidBundle(), errors);
  assert.equal(errors.length, 0);
});

test("validateBundleTopLevelFields: reports missing required fields", () => {
  const errors = [];
  validateBundleTopLevelFields({}, errors);
  const requiredFields = [
    "schemaVersion",
    "bundle",
    "package",
    "transition",
    "governance",
    "risk",
    "testing",
    "impact",
    "rollback",
    "sourceMetadataSnapshot",
    "reportReferences",
  ];
  for (const field of requiredFields) {
    assert.ok(
      errors.some((e) => e.includes(field)),
      `must report missing ${field}`
    );
  }
});

test("validateBundleTopLevelFields: wrong schemaVersion produces error", () => {
  const errors = [];
  validateBundleTopLevelFields(makeValidBundle({ schemaVersion: "2.0" }), errors);
  assert.ok(errors.some((e) => e.includes("schemaVersion must be 1.0")));
});

// ─── validateBundleTransition ─────────────────────────────────────────────────

test("validateBundleTransition: valid transition has no errors", () => {
  const errors = [];
  validateBundleTransition(makeValidBundle(), errors);
  assert.equal(errors.length, 0);
});

test("validateBundleTransition: invalid fromClass format produces error", () => {
  const errors = [];
  validateBundleTransition(
    { transition: { fromClass: "invalid", toClass: "candidate.feature" } },
    errors
  );
  assert.ok(errors.some((e) => e.includes("fromClass must use <stage>.<role> format")));
});

test("validateBundleTransition: invalid toClass format produces error", () => {
  const errors = [];
  validateBundleTransition(
    { transition: { fromClass: "experimental.feature", toClass: "INVALID" } },
    errors
  );
  assert.ok(errors.some((e) => e.includes("toClass must use <stage>.<role> format")));
});

test("validateBundleTransition: missing transition produces errors", () => {
  const errors = [];
  validateBundleTransition({}, errors);
  assert.ok(errors.some((e) => e.includes("fromClass")));
  assert.ok(errors.some((e) => e.includes("toClass")));
});

test("validateBundleTransition: valid multi-word stage.role", () => {
  const errors = [];
  validateBundleTransition(
    {
      transition: { fromClass: "experimental.feature", toClass: "stable.platform" },
    },
    errors
  );
  assert.equal(errors.length, 0);
});

// ─── validateBundleGovernance ─────────────────────────────────────────────────

test("validateBundleGovernance: valid governance has no errors", () => {
  const errors = [];
  validateBundleGovernance(makeValidBundle(), errors);
  assert.equal(errors.length, 0);
});

test("validateBundleGovernance: empty decisionRefs produces error", () => {
  const errors = [];
  validateBundleGovernance(
    { governance: { decisionRefs: [], reviewers: [{}], approvers: [{}] } },
    errors
  );
  assert.ok(errors.some((e) => e.includes("decisionRefs must be non-empty")));
});

test("validateBundleGovernance: invalid ADR ref format produces error", () => {
  const errors = [];
  validateBundleGovernance(
    {
      governance: {
        decisionRefs: ["adr-001"], // wrong format
        reviewers: [{}],
        approvers: [{}],
      },
    },
    errors
  );
  assert.ok(errors.some((e) => e.includes("invalid ADR ref")));
});

test("validateBundleGovernance: empty reviewers produces error", () => {
  const errors = [];
  validateBundleGovernance(
    {
      governance: {
        decisionRefs: ["ADR-0010"],
        reviewers: [],
        approvers: [{}],
      },
    },
    errors
  );
  assert.ok(errors.some((e) => e.includes("reviewers must be non-empty")));
});

test("validateBundleGovernance: empty approvers produces error", () => {
  const errors = [];
  validateBundleGovernance(
    {
      governance: {
        decisionRefs: ["ADR-0010"],
        reviewers: [{}],
        approvers: [],
      },
    },
    errors
  );
  assert.ok(errors.some((e) => e.includes("approvers must be non-empty")));
});

test("validateBundleGovernance: missing governance produces errors", () => {
  const errors = [];
  validateBundleGovernance({}, errors);
  assert.ok(errors.length > 0);
});

// ─── validateBundleTesting ────────────────────────────────────────────────────

test("validateBundleTesting: valid testing has no errors", () => {
  const errors = [];
  validateBundleTesting(makeValidBundle(), errors);
  assert.equal(errors.length, 0);
});

test("validateBundleTesting: empty evidence array produces error", () => {
  const errors = [];
  validateBundleTesting({ testing: { evidence: [] } }, errors);
  assert.ok(errors.some((e) => e.includes("testing.evidence must be non-empty")));
});

test("validateBundleTesting: missing testing produces error", () => {
  const errors = [];
  validateBundleTesting({}, errors);
  assert.ok(errors.length > 0);
});

// ─── validateBundleRollback ───────────────────────────────────────────────────

test("validateBundleRollback: valid rollback has no errors", () => {
  const errors = [];
  validateBundleRollback(makeValidBundle(), errors);
  assert.equal(errors.length, 0);
});

test("validateBundleRollback: missing strategy produces error", () => {
  const errors = [];
  validateBundleRollback({ rollback: {} }, errors);
  assert.ok(errors.some((e) => e.includes("rollback.strategy must be present")));
});

test("validateBundleRollback: missing rollback produces error", () => {
  const errors = [];
  validateBundleRollback({}, errors);
  assert.ok(errors.some((e) => e.includes("rollback.strategy")));
});

// ─── validateBundleSnapshot ───────────────────────────────────────────────────

test("validateBundleSnapshot: valid snapshot has no errors", () => {
  const errors = [];
  validateBundleSnapshot(makeValidBundle(), errors);
  assert.equal(errors.length, 0);
});

test("validateBundleSnapshot: missing packageJsonPath produces error", () => {
  const errors = [];
  validateBundleSnapshot({ sourceMetadataSnapshot: { architecture: {} } }, errors);
  assert.ok(errors.some((e) => e.includes("sourceMetadataSnapshot must include packageJsonPath")));
});

test("validateBundleSnapshot: missing architecture produces error", () => {
  const errors = [];
  validateBundleSnapshot(
    { sourceMetadataSnapshot: { packageJsonPath: "packages/foo/package.json" } },
    errors
  );
  assert.ok(errors.some((e) => e.includes("sourceMetadataSnapshot must include")));
});

test("validateBundleSnapshot: missing sourceMetadataSnapshot produces error", () => {
  const errors = [];
  validateBundleSnapshot({}, errors);
  assert.ok(errors.length > 0);
});

// ─── fallbackValidate ─────────────────────────────────────────────────────────

test("fallbackValidate: valid bundle returns valid=true with no errors", () => {
  const result = fallbackValidate(makeValidBundle());
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test("fallbackValidate: empty bundle returns valid=false with many errors", () => {
  const result = fallbackValidate({});
  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
  // Should report all the missing required fields
  assert.ok(result.errors.some((e) => e.includes("schemaVersion")));
  assert.ok(result.errors.some((e) => e.includes("bundle")));
  assert.ok(result.errors.some((e) => e.includes("transition")));
});

test("fallbackValidate: only schemaVersion wrong returns specific error", () => {
  const bundle = makeValidBundle({ schemaVersion: "99.0" });
  const result = fallbackValidate(bundle);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("schemaVersion must be 1.0")));
});

test("fallbackValidate: invalid transition returns specific error", () => {
  const bundle = makeValidBundle({
    transition: { fromClass: "INVALID", toClass: "also-invalid" },
  });
  const result = fallbackValidate(bundle);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("fromClass must use <stage>.<role> format")));
  assert.ok(result.errors.some((e) => e.includes("toClass must use <stage>.<role> format")));
});

test("fallbackValidate: missing governance elements", () => {
  const bundle = makeValidBundle({
    governance: { decisionRefs: [], reviewers: [], approvers: [] },
  });
  const result = fallbackValidate(bundle);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("decisionRefs must be non-empty")));
});

test("fallbackValidate: missing rollback strategy", () => {
  const bundle = makeValidBundle({ rollback: { notes: "some notes" } });
  const result = fallbackValidate(bundle);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("rollback.strategy")));
});
