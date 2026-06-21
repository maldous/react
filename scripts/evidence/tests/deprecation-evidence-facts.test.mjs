#!/usr/bin/env node
// Validates the FACTS asserted in docs/evidence/lifecycle/adr-act-0288-c1-deprecation.md
// against the live repository, so the (partly hand-written) evidence cannot drift
// from reality (ADR-0006 / ADR-ACT-0289).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const read = (p) => fs.readFileSync(path.join(repoRoot, p), "utf8");
const readJson = (p) => JSON.parse(read(p));

const DEPRECATED_PACKAGES = [];

// Application-local replacement files the evidence cites — must exist.
const REPLACEMENT_FILES = [
  "apps/platform-api/src/usecases/profile.ts",
  "apps/platform-api/src/ports/profile-repository.ts",
  "apps/platform-api/src/usecases/search.ts",
  "apps/platform-api/src/adapters/postgres-search-repository.ts",
  "apps/platform-api/src/usecases/notifications.ts",
  "apps/platform-api/src/adapters/postgres-notification-repository.ts",
  "apps/platform-api/src/server/worker-registry.ts",
  "apps/platform-api/src/usecases/webhook-worker.ts",
];

test("there are no deprecated package directories remaining", () => {
  const packagesDir = path.join(repoRoot, "packages");
  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pjPath = path.join(packagesDir, entry.name, "package.json");
    if (!fs.existsSync(pjPath)) continue;
    const pj = readJson(`packages/${entry.name}/package.json`);
    assert.notEqual(
      pj.architecture.lifecycle.stage,
      "deprecated",
      `${entry.name} should no longer be deprecated`
    );
  }
});

test("tsconfig.packages.json does not reference removed package scaffolds", () => {
  const tsconfig = read("packages/tsconfig.packages.json");
  for (const n of DEPRECATED_PACKAGES) {
    const referenced = new RegExp(`"\\./${n}"`).test(tsconfig);
    assert.equal(referenced, false, `${n}: removed package must not be referenced`);
  }
});

test("every application-local replacement file cited in the evidence exists", () => {
  for (const f of REPLACEMENT_FILES) {
    assert.ok(fs.existsSync(path.join(repoRoot, f)), `replacement file missing: ${f}`);
  }
});

test("the evidence document references the authoritative action ADR-ACT-0289", () => {
  const doc = read("docs/evidence/lifecycle/adr-act-0288-c1-deprecation.md");
  assert.match(doc, /ADR-ACT-0289/);
});
