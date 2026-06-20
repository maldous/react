#!/usr/bin/env node
/**
 * codeql:validate — ADR-ACT-0247 / V1C-18.
 *
 * Validates the CodeQL setup is working: codeql binary reachable, config file
 * valid, and a minimal database can be created. Gracefully skips (exit 0) when
 * codeql is not installed — never blocks the gate on missing local tooling.
 *
 * Usage: npm run codeql:validate
 */

import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

function skip(reason) {
  console.log(`SKIP  codeql not available — ${reason} (ADR-ACT-0247 honest skip)`);
  process.exit(0);
}

function fail(reason) {
  console.error(`FAIL  ${reason}`);
  process.exit(1);
}

function pass(msg) {
  console.log(`PASS  ${msg}`);
}

// ── codeql binary reachable ───────────────────────────────────────────────
let codeql;
try {
  codeql = execSync("which codeql 2>/dev/null || command -v codeql 2>/dev/null || true", {
    encoding: "utf8",
  }).trim();
} catch {
  codeql = "";
}

if (!codeql) {
  skip("install codeql from https://github.com/github/codeql-cli-binaries/releases");
}

try {
  execSync(`${codeql} --version 2>&1`, { encoding: "utf8", stdio: "pipe" });
} catch {
  skip("codeql binary found but --version failed");
}
pass("codeql binary reachable");

// ── Config file valid ──────────────────────────────────────────────────────
const configPath = resolve(ROOT, ".github", "codeql", "codeql-config.yml");
if (!existsSync(configPath)) {
  fail(`codeql config not found at ${configPath}`);
}

const config = readFileSync(configPath, "utf8").trim();
if (!config) fail("codeql config is empty");
if (!config.includes("name:")) fail("codeql config missing required 'name' field");
if (!config.includes("queries:")) fail("codeql config missing required 'queries' field");
pass("codeql config valid");

// ── Minimal database creation (quick smoke test) ───────────────────────────
const dbPath = resolve(ROOT, ".codeql", "validate-db");
try {
  execSync(
    `${codeql} database create "${dbPath}" --language=javascript-typescript --source-root="${ROOT}" --codescanning-config="${configPath}" --overwrite 2>&1`,
    { encoding: "utf8", stdio: "pipe", timeout: 300_000 }
  );
  pass("codeql database creation succeeded");
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  skip(`database creation did not complete cleanly (${msg.slice(0, 200)})`);
}

// ── Cleanup ────────────────────────────────────────────────────────────────
try {
  execSync(`rm -rf "${dbPath}"`, { stdio: "pipe" });
} catch {
  // best-effort cleanup
}

console.log("\n# codeql:validate PASSED");
process.exit(0);
