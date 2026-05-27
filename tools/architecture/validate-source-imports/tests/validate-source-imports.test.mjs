#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../..");
const toolScript = path.join(repoRoot, "tools", "architecture", "validate-source-imports", "src", "index.mjs");
const fixturesDir = path.join(repoRoot, "tools", "architecture", "validate-source-imports", "tests", "fixtures");

function rel(fixturePath) {
  return path.relative(repoRoot, fixturePath);
}

function run(scanPaths, extraArgs = []) {
  const args = [toolScript, "--root", repoRoot, "--format", "json", "--no-reports", ...extraArgs, ...scanPaths];
  return spawnSync(process.execPath, args, { cwd: repoRoot, encoding: "utf8" });
}

function parseOutput(result) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

// Valid fixtures — each should exit 0 with no violations
const validFixtures = [
  { name: "domain-core (no imports)", dir: "valid/domain-core" },
  { name: "feature-workflow (permitted imports)", dir: "valid/feature-workflow" },
  { name: "access-control (permitted imports)", dir: "valid/access-control" },
  { name: "contracts-graphql (no adapter imports)", dir: "valid/contracts-graphql" }
];

for (const fixture of validFixtures) {
  const fixturePath = path.join(fixturesDir, fixture.dir);
  const result = run([rel(fixturePath)]);
  const payload = parseOutput(result);
  assert.equal(result.status, 0, `${fixture.name}: expected exit 0\n${result.stdout}\n${result.stderr}`);
  assert.equal(payload?.violations?.length ?? 0, 0, `${fixture.name}: expected no violations`);
  console.log(`✓ valid: ${fixture.name}`);
}

// Invalid fixtures — each should exit 1 with the expected rule in violations
const invalidFixtures = [
  { name: "deep-import", dir: "invalid/deep-import", rule: "no-deep-import" },
  { name: "test-support-in-prod", dir: "invalid/test-support-in-prod", rule: "no-test-support-in-prod" },
  { name: "domain-imports-react", dir: "invalid/domain-imports-react", rule: "no-react-in-domain" },
  { name: "domain-imports-graphql", dir: "invalid/domain-imports-graphql", rule: "no-graphql-in-domain" },
  { name: "domain-imports-adapter", dir: "invalid/domain-imports-adapter", rule: "no-adapters-in-domain" },
  { name: "feature-imports-postgres", dir: "invalid/feature-imports-postgres", rule: "no-adapters-in-feature" },
  { name: "feature-imports-clickhouse", dir: "invalid/feature-imports-clickhouse", rule: "no-adapters-in-feature" },
  { name: "contract-imports-adapter", dir: "invalid/contract-imports-adapter", rule: "no-adapters-in-contracts-graphql" },
  { name: "contracts-ingestion-imports-adapter", dir: "invalid/contracts-ingestion-imports-adapter", rule: "no-adapters-in-contracts-ingestion" },
  { name: "contracts-analytics-imports-adapter", dir: "invalid/contracts-analytics-imports-adapter", rule: "no-adapters-in-contracts-analytics" },
  { name: "ui-imports-domain", dir: "invalid/ui-imports-domain", rule: "no-domain-in-ui" },
  { name: "access-imports-react", dir: "invalid/access-imports-react", rule: "no-react-in-access-control" },
  { name: "profile-imports-postgres", dir: "invalid/profile-imports-postgres", rule: "no-adapters-in-profile" },
  { name: "relative-cross-package-import", dir: "invalid/relative-cross-package-import/packages", rule: "no-relative-cross-package-import" },
  { name: "adapter-imports-unlisted", dir: "invalid/adapter-imports-unlisted", rule: "no-unlisted-platform-import" },
  { name: "empty-dep-list-imports-platform", dir: "invalid/empty-dep-list-imports-platform", rule: "no-unlisted-platform-import" }
];

for (const fixture of invalidFixtures) {
  const fixturePath = path.join(fixturesDir, fixture.dir);
  const result = run([rel(fixturePath)]);
  const payload = parseOutput(result);
  assert.equal(result.status, 1, `${fixture.name}: expected exit 1\n${result.stdout}\n${result.stderr}`);
  assert.ok(payload?.violations?.length > 0, `${fixture.name}: expected violations`);
  const ruleIds = payload.violations.map((v) => v.rule);
  assert.ok(ruleIds.includes(fixture.rule), `${fixture.name}: expected rule ${fixture.rule}, got ${ruleIds.join(", ")}`);
  console.log(`✓ invalid: ${fixture.name} (rule: ${fixture.rule})`);
}

// Test that --no-reports suppresses report file writing (already using --no-reports above)
// Test that tool exits 0 on real repo (apps + packages have no violations)
const repoResult = run(["apps", "packages"]);
const repoPayload = parseOutput(repoResult);
assert.equal(repoResult.status, 0, `real repo scan should pass\n${repoResult.stdout}\n${repoResult.stderr}`);
assert.equal(repoPayload?.violations?.length ?? 0, 0, "real repo should have no violations");
console.log("✓ real repo scan: no violations");

// Test --write emits committed evidence
const writeResult = run(["apps", "packages"], ["--write"]);
assert.equal(writeResult.status, 0, `--write should pass\n${writeResult.stdout}\n${writeResult.stderr}`);
const writePayload = parseOutput(writeResult);
assert.ok(
  writePayload?.outputPaths?.some((p) => p.includes("source-import-boundary-validation.json")),
  "--write should emit committed evidence JSON"
);
console.log("✓ --write emits committed evidence");

console.log("validate-source-imports test passed");
