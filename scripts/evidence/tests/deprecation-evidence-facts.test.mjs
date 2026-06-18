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

const NINE = [
  "domain-core",
  "access-control",
  "feature-workflow",
  "profile-configuration",
  "security-auth",
  "queue-runtime",
  "search-runtime",
  "notification-runtime",
  "worker-runtime",
];

// Per the evidence: exactly these four are project-referenced in tsconfig.packages.json.
const TSCONFIG_REFERENCED = new Set([
  "notification-runtime",
  "queue-runtime",
  "search-runtime",
  "worker-runtime",
]);

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

test("each deprecated package dir exists and is lifecycle.stage=deprecated", () => {
  for (const n of NINE) {
    const pj = readJson(`packages/${n}/package.json`);
    assert.equal(pj.architecture.lifecycle.stage, "deprecated", `${n} must be deprecated`);
    assert.equal(pj.architecture.tags.stage, "deprecated", `${n} tags.stage must be deprecated`);
  }
});

test("tsconfig.packages.json references exactly the four the evidence claims", () => {
  const tsconfig = read("packages/tsconfig.packages.json");
  for (const n of NINE) {
    const referenced = new RegExp(`"\\./${n}"`).test(tsconfig);
    assert.equal(
      referenced,
      TSCONFIG_REFERENCED.has(n),
      `${n}: tsconfig reference present=${referenced} but evidence says ${TSCONFIG_REFERENCED.has(n)}`
    );
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
