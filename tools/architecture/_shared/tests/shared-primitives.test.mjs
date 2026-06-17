#!/usr/bin/env node
// Characterisation tests for the shared architecture-tool primitives.
// These pin the EXACT behaviour lifted from the per-tool copies so the
// extraction is provably behaviour-preserving (ADR-0011 / ADR-0012).
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { findRepoRoot } from "../repo-root.mjs";
import { readJson } from "../json.mjs";
import { walkPackageJson } from "../files.mjs";
import { writeSelfEvidence, REQUIRED_EVIDENCE_FIELDS } from "../self-evidence.mjs";

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "shared-prim-"));
}

test("findRepoRoot ascends to the ancestor holding a file marker", () => {
  const root = fs.realpathSync(tmp());
  const nested = path.join(root, "a", "b", "c");
  fs.mkdirSync(nested, { recursive: true });
  fs.mkdirSync(path.join(root, "docs", "schemas"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "docs", "schemas", "package-json-architecture.schema.json"),
    "{}"
  );
  assert.equal(findRepoRoot(nested, ["docs/schemas/package-json-architecture.schema.json"]), root);
});

test("findRepoRoot accepts a directory marker (docs/schemas)", () => {
  const root = fs.realpathSync(tmp());
  const nested = path.join(root, "x", "y");
  fs.mkdirSync(nested, { recursive: true });
  fs.mkdirSync(path.join(root, "docs", "schemas"), { recursive: true });
  assert.equal(findRepoRoot(nested, ["docs/schemas"]), root);
});

test("findRepoRoot falls back to resolve(startDir) when no marker is found", () => {
  const start = fs.realpathSync(tmp());
  // A marker name that cannot exist anywhere up the tree.
  assert.equal(findRepoRoot(start, ["__no_such_marker_42__"]), path.resolve(start));
});

test("findRepoRoot returns the first ancestor matching ANY of several markers", () => {
  const root = fs.realpathSync(tmp());
  const nested = path.join(root, "deep");
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), "{}");
  // first marker absent everywhere, second present at root
  assert.equal(findRepoRoot(nested, ["__nope__", "package.json"]), root);
});

test("readJson parses a JSON file", () => {
  const dir = tmp();
  const f = path.join(dir, "x.json");
  fs.writeFileSync(f, JSON.stringify({ a: 1, b: ["c"] }));
  assert.deepEqual(readJson(f), { a: 1, b: ["c"] });
});

function scaffoldPackages(root) {
  fs.mkdirSync(path.join(root, "pkg-a"), { recursive: true });
  fs.writeFileSync(path.join(root, "pkg-a", "package.json"), "{}");
  fs.mkdirSync(path.join(root, "node_modules", "dep"), { recursive: true });
  fs.writeFileSync(path.join(root, "node_modules", "dep", "package.json"), "{}");
  fs.mkdirSync(path.join(root, "tests", "fixtures", "fx"), { recursive: true });
  fs.writeFileSync(path.join(root, "tests", "fixtures", "fx", "package.json"), "{}");
}

const IGNORED = new Set(["node_modules", ".git"]);
const isFixtureDir = (dir) => {
  const parts = dir.split(path.sep);
  return parts.includes("tests") && parts.includes("fixtures");
};

test("walkPackageJson collects package.json and prunes ignored dirs", () => {
  const root = fs.realpathSync(tmp());
  scaffoldPackages(root);
  const results = [];
  walkPackageJson(root, results, { ignored: IGNORED, isFixtureDir, explicitFixtureScan: false });
  assert.deepEqual(
    results.sort(),
    [path.join(root, "pkg-a", "package.json")] // node_modules + fixtures pruned
  );
});

test("walkPackageJson includes fixtures when explicitFixtureScan is true", () => {
  const root = fs.realpathSync(tmp());
  scaffoldPackages(root);
  const results = [];
  walkPackageJson(root, results, { ignored: IGNORED, isFixtureDir, explicitFixtureScan: true });
  assert.ok(results.includes(path.join(root, "tests", "fixtures", "fx", "package.json")));
  assert.ok(!results.some((p) => p.includes("node_modules"))); // ignored still pruned
});

// A complete, schema-valid evidence object. null values are intentional: the
// schema requires property PRESENCE, not truthiness.
function completeEvidence(overrides = {}) {
  const base = {};
  for (const field of REQUIRED_EVIDENCE_FIELDS) {
    base[field] = null;
  }
  return {
    ...base,
    toolName: "sample-tool",
    toolVersion: "0.0.0",
    command: ["node", "sample"],
    mode: "check",
    root: "/repo",
    startedAt: "2026-05-26T00:00:00.000Z",
    finishedAt: "2026-05-26T00:00:00.000Z",
    durationMs: 0,
    inputRoots: [],
    outputPaths: [],
    rulesEvaluated: [],
    checksPassed: 1,
    checksFailed: 0,
    warnings: [],
    errors: [],
    dependencySteps: [],
    gitTreatment: "reports/** ignored by default",
    exitCode: 0,
    ...overrides,
  };
}

test("REQUIRED_EVIDENCE_FIELDS pins the ADR-0012 self-evidence schema (18 fields)", () => {
  // Matches orchestrator/tests/self-evidence.test.mjs requiredToolFields.
  assert.equal(REQUIRED_EVIDENCE_FIELDS.length, 18);
  for (const f of [
    "toolName",
    "command",
    "mode",
    "root",
    "durationMs",
    "exitCode",
    "gitTreatment",
  ]) {
    assert.ok(REQUIRED_EVIDENCE_FIELDS.includes(f), `missing required field ${f}`);
  }
});

test("writeSelfEvidence writes <timestamp>-run.json with JSON + trailing newline", () => {
  const dir = path.join(tmp(), "tooling", "sample-tool");
  const evidence = completeEvidence();
  const result = writeSelfEvidence({ evidence, toolingReportDir: dir, noReports: false });
  assert.equal(result, path.join(dir, "2026-05-26T00-00-00-000Z-run.json"));
  const raw = fs.readFileSync(result, "utf8");
  assert.ok(raw.endsWith("\n"));
  assert.deepEqual(JSON.parse(raw), evidence);
});

test("writeSelfEvidence accepts a present-but-null required field (presence, not truthiness)", () => {
  const dir = path.join(tmp(), "tooling", "sample-tool");
  const evidence = completeEvidence({ warnings: null, errors: null });
  const result = writeSelfEvidence({ evidence, toolingReportDir: dir, noReports: false });
  assert.ok(result && fs.existsSync(result));
});

test("writeSelfEvidence throws when a required field is absent", () => {
  const dir = path.join(tmp(), "tooling", "sample-tool");
  const evidence = completeEvidence();
  delete evidence.gitTreatment;
  assert.throws(
    () => writeSelfEvidence({ evidence, toolingReportDir: dir, noReports: false }),
    /gitTreatment/
  );
  assert.equal(fs.existsSync(dir), false);
});

test("writeSelfEvidence throws when evidence is not a plain object", () => {
  const dir = path.join(tmp(), "tooling", "sample-tool");
  for (const bad of [null, undefined, "x", 42, [1, 2]]) {
    assert.throws(() =>
      writeSelfEvidence({ evidence: bad, toolingReportDir: dir, noReports: false })
    );
  }
});

test("writeSelfEvidence throws when finishedAt is missing or invalid for a filename", () => {
  const dir = path.join(tmp(), "tooling", "sample-tool");
  for (const bad of [null, "", 1748217600000, "2026/05/26"]) {
    const evidence = completeEvidence({ finishedAt: bad });
    assert.throws(
      () => writeSelfEvidence({ evidence, toolingReportDir: dir, noReports: false }),
      /finishedAt/
    );
  }
});

test("writeSelfEvidence with noReports returns null BEFORE validation and writes nothing", () => {
  const dir = path.join(tmp(), "tooling", "sample-tool");
  // Deliberately invalid evidence — must still short-circuit on noReports.
  const result = writeSelfEvidence({
    evidence: { toolName: "x" },
    toolingReportDir: dir,
    noReports: true,
  });
  assert.equal(result, null);
  assert.equal(fs.existsSync(dir), false);
});
