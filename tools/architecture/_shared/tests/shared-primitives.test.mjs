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
