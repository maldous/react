#!/usr/bin/env node
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { parseCodemap, checkCodemap, loadPackages } from "../src/index.mjs";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../..");

// A small, internally-consistent synthetic codemap + matching package set.
const GOOD_MD = `# Packages Codemap

## Group A (2)

| Name | Lifecycle | Context | Deps |
| ---- | --------- | ------- | ---- |
| @platform/alpha | active | a | — |
| @platform/beta | deprecated | b | — |

## Group B (1)

| Name | Lifecycle | Context | Deps |
| ---- | --------- | ------- | ---- |
| @platform/gamma | experimental | g | — |

## Total: 3 packages

**Lifecycle Distribution**: 1 active, 1 experimental, 1 deprecated
`;

const GOOD_PKGS = new Map([
  ["@platform/alpha", { stage: "active" }],
  ["@platform/beta", { stage: "deprecated" }],
  ["@platform/gamma", { stage: "experimental" }],
]);

test("consistent codemap produces no errors", () => {
  assert.deepEqual(checkCodemap(parseCodemap(GOOD_MD), GOOD_PKGS), []);
});

test("duplicate package row is detected", () => {
  const md = GOOD_MD.replace(
    "| @platform/gamma | experimental | g | — |",
    "| @platform/gamma | experimental | g | — |\n| @platform/alpha | active | a | — |"
  ).replace("## Group B (1)", "## Group B (2)");
  const errors = checkCodemap(parseCodemap(md), GOOD_PKGS);
  assert.ok(errors.some((e) => /duplicate package row: @platform\/alpha/.test(e)));
});

test("incorrect section count is detected", () => {
  const md = GOOD_MD.replace("## Group A (2)", "## Group A (3)");
  const errors = checkCodemap(parseCodemap(md), GOOD_PKGS);
  assert.ok(errors.some((e) => /section "Group A": header count 3 != 2/.test(e)));
});

test("incorrect total is detected", () => {
  const md = GOOD_MD.replace("## Total: 3 packages", "## Total: 5 packages");
  const errors = checkCodemap(parseCodemap(md), GOOD_PKGS);
  assert.ok(errors.some((e) => /Total \(5\)/.test(e)));
});

test("incorrect lifecycle distribution is detected", () => {
  const md = GOOD_MD.replace(
    "**Lifecycle Distribution**: 1 active, 1 experimental, 1 deprecated",
    "**Lifecycle Distribution**: 2 active, 1 experimental, 1 deprecated"
  );
  const errors = checkCodemap(parseCodemap(md), GOOD_PKGS);
  assert.ok(errors.some((e) => /distribution active=2 != actual 1/.test(e)));
});

test("missing package (in repo, not in codemap) is detected", () => {
  const pkgs = new Map(GOOD_PKGS);
  pkgs.set("@platform/delta", { stage: "active" });
  const errors = checkCodemap(parseCodemap(GOOD_MD), pkgs);
  assert.ok(errors.some((e) => /missing package.*@platform\/delta/.test(e)));
});

test("unknown package (in codemap, not in repo) is detected", () => {
  const pkgs = new Map(GOOD_PKGS);
  pkgs.delete("@platform/gamma");
  const errors = checkCodemap(parseCodemap(GOOD_MD), pkgs);
  assert.ok(errors.some((e) => /unknown package.*@platform\/gamma/.test(e)));
});

test("lifecycle value mismatch is detected", () => {
  const pkgs = new Map(GOOD_PKGS);
  pkgs.set("@platform/beta", { stage: "active" }); // codemap says deprecated
  const errors = checkCodemap(parseCodemap(GOOD_MD), pkgs);
  assert.ok(errors.some((e) => /lifecycle mismatch for @platform\/beta/.test(e)));
});

test("parseCodemap is deterministic", () => {
  assert.deepEqual(parseCodemap(GOOD_MD), parseCodemap(GOOD_MD));
});

test("LIVE: the committed codemap is consistent with package metadata", () => {
  const md = fs.readFileSync(path.join(repoRoot, "docs", "CODEMAPS", "packages.md"), "utf8");
  const errors = checkCodemap(parseCodemap(md), loadPackages(repoRoot));
  assert.deepEqual(errors, [], `live codemap inconsistencies:\n${errors.join("\n")}`);
});
