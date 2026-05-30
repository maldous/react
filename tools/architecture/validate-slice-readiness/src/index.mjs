#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

// Known readiness tiers per ADR-0024
const VALID_TIERS = [0, 1, 2, 3, 4];

// Known capability IDs per ADR-0024 Tier 1+
const KNOWN_CAPABILITIES = new Set([
  "local-postgres",
  "platform-api",
  "react-spa",
  "fixture-session",
  "playwright-e2e",
  "structured-logging",
  "permission-guards",
  "migration-runner",
  "keycloak-provisioned",
  "real-sso",
  "cloud-vpc",
  "cloud-rds",
  "cloud-redis",
  "cloud-s3",
  "cloud-iam",
  "ci-oidc",
  "secrets-manager",
  "backup-restore",
  "alerting",
  "log-retention",
  "release-approval",
]);

// Known forbidden dependencies
const KNOWN_FORBIDDEN = new Set(["live-keycloak", "cloud-production", "real-sso"]);

// ADR-ACT-NNNN pattern
const ADR_ACT_PATTERN = /^ADR-ACT-\d{4}$/;

export function findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(dir, "docs", "schemas"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(startDir);
    dir = parent;
  }
}

export function readActionRegisterStatuses(repoRoot) {
  const arPath = path.join(repoRoot, "docs", "adr", "ACTION-REGISTER.md");
  if (!fs.existsSync(arPath)) return new Map();
  const content = fs.readFileSync(arPath, "utf8");
  const statuses = new Map();
  for (const line of content.split("\n")) {
    const m = line.match(
      /^\s*\|\s*(ADR-ACT-\d{4})\s*\|[^|]+\|[^|]+\|[^|]+\|\s*(Done|Open|Blocked|In Progress|Not Started)\s*\|/i
    );
    if (m) {
      statuses.set(m[1], m[2].trim().toLowerCase().replace(" ", "-"));
    }
  }
  return statuses;
}

const VALID_STATUSES = ["not-started", "in-progress", "done", "blocked"];

function validateRequiredFields(manifest, fail) {
  if (!manifest.actionId) fail("Missing actionId");
  if (!manifest.name) fail("Missing name");
  if (!manifest.status) fail("Missing status");
}

function validateTier(manifest, fail) {
  const tier = manifest.requiredReadinessTier;
  if (tier === undefined || tier === null) {
    fail("Missing requiredReadinessTier");
  } else if (!VALID_TIERS.includes(tier)) {
    fail(`requiredReadinessTier must be 0-4, got: ${tier}`);
  }
}

function validateCapabilities(manifest, fail) {
  const caps = manifest.requiredCapabilities ?? [];
  if (!Array.isArray(caps)) {
    fail("requiredCapabilities must be an array");
    return;
  }
  for (const cap of caps) {
    if (!KNOWN_CAPABILITIES.has(cap)) fail(`Unknown capability: ${cap}`);
  }
}

function validateBlockers(manifest, fail) {
  const blockers = manifest.blockedBy ?? [];
  if (!Array.isArray(blockers)) {
    fail("blockedBy must be an array");
    return;
  }
  for (const blocker of blockers) {
    if (!ADR_ACT_PATTERN.test(blocker)) fail(`Invalid blocker format: ${blocker}`);
  }
}

function validateForbiddenDeps(manifest, fail, warn) {
  const forbidden = manifest.forbiddenDependencies ?? [];
  if (!Array.isArray(forbidden)) {
    fail("forbiddenDependencies must be an array");
    return;
  }
  for (const dep of forbidden) {
    if (!KNOWN_FORBIDDEN.has(dep)) warn(`Unrecognised forbidden dependency: ${dep}`);
  }
}

function validateStatus(manifest, fail) {
  if (manifest.status && !VALID_STATUSES.includes(manifest.status)) {
    fail(`Invalid status: ${manifest.status}. Must be one of: ${VALID_STATUSES.join(", ")}`);
  }
}

function validateBlockerGovernance(manifest, actionStatuses, fail) {
  const blockers = manifest.blockedBy ?? [];
  if (!Array.isArray(blockers) || blockers.length === 0) return;

  for (const blocker of blockers) {
    if (!ADR_ACT_PATTERN.test(blocker)) continue; // format already checked by validateBlockers

    const status = actionStatuses.get(blocker);
    if (!status) {
      fail(`Blocker ${blocker} not found in ACTION-REGISTER`);
      continue;
    }

    // A blocker that is already Done should be removed from blockedBy
    if (status === "done") {
      fail(`Blocker ${blocker} is Done ? remove it from blockedBy`);
    }
  }
}

export function validateManifest(manifest, _filePath, actionStatuses = new Map()) {
  const errors = [];
  const warn = (msg) => errors.push(`WARN: ${msg}`);
  const fail = (msg) => errors.push(`ERROR: ${msg}`);

  validateRequiredFields(manifest, fail);
  validateTier(manifest, fail);
  validateCapabilities(manifest, fail);
  validateBlockers(manifest, fail);
  validateForbiddenDeps(manifest, fail, warn);
  validateStatus(manifest, fail);
  validateBlockerGovernance(manifest, actionStatuses, fail);

  return errors;
}

function main() {
  const repoRoot = findRepoRoot(process.cwd());
  const slicesDir = path.join(repoRoot, "docs", "slices");

  if (!fs.existsSync(slicesDir)) {
    process.stdout.write("No docs/slices/ directory found ? nothing to validate.\n");
    process.exit(0);
  }

  const files = fs.readdirSync(slicesDir).filter((f) => f.endsWith(".json"));

  if (files.length === 0) {
    process.stdout.write("No slice manifests found in docs/slices/\n");
    process.exit(0);
  }

  const actionStatuses = readActionRegisterStatuses(repoRoot);

  let totalErrors = 0;
  let totalWarnings = 0;
  const results = [];

  for (const file of files) {
    const filePath = path.join(slicesDir, file);
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (err) {
      process.stderr.write(`ERROR: Cannot parse ${file}: ${err.message}\n`);
      totalErrors++;
      continue;
    }

    const issues = validateManifest(manifest, filePath, actionStatuses);
    const errors = issues.filter((i) => i.startsWith("ERROR:"));
    const warnings = issues.filter((i) => i.startsWith("WARN:"));
    totalErrors += errors.length;
    totalWarnings += warnings.length;
    results.push({ file, manifest, errors, warnings });
  }

  process.stdout.write(`Slice readiness validation\n`);
  process.stdout.write(`Manifests: ${files.length}\n`);
  for (const { file, errors, warnings } of results) {
    const status = errors.length > 0 ? "FAIL" : "PASS";
    process.stdout.write(`  ${status}: ${file}\n`);
    for (const e of errors) process.stderr.write(`    ${e}\n`);
    for (const w of warnings) process.stdout.write(`    ${w}\n`);
  }

  if (totalErrors > 0) {
    process.stderr.write(`\nFailed: ${totalErrors} error(s)\n`);
    process.exit(1);
  }

  process.stdout.write(`\nPassed: ${files.length} manifest(s) valid\n`);
  if (totalWarnings > 0) {
    process.stdout.write(`Warnings: ${totalWarnings}\n`);
  }
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
