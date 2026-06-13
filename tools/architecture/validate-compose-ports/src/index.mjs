#!/usr/bin/env node
/**
 * validate-compose-ports — Guard against port allocation clashes across environments.
 *
 * Reads each .env.<ENV> file, merges compose.yaml defaults for unset PORT
 * variables, then checks for within-env and cross-env host-port clashes.
 *
 * Usage:
 *   node tools/architecture/validate-compose-ports/src/index.mjs
 *   node tools/architecture/validate-compose-ports/src/index.mjs --root /path/to/repo
 *   node tools/architecture/validate-compose-ports/src/index.mjs --format json
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const rootIdx = args.indexOf("--root");
const repoRoot = rootIdx !== -1 ? args[rootIdx + 1] : process.cwd();
const jsonMode = args.includes("--format") && args[args.indexOf("--format") + 1] === "json";

// Defaults from compose.yaml ${VAR:-default} expressions.
// These apply when a variable is not set in the env file.
const COMPOSE_DEFAULTS = {
  KEYCLOAK_PORT: "8090",
  LOCALSTACK_PORT: "4566",
  PGADMIN_PORT: "5050",
  POSTGRES_PORT: "5433",
  REDIS_PORT: "6379",
  WEB_HTTP_PORT: "80",
  WIREMOCK_PORT: "8089",
};

const ENVS = ["dev", "test", "staging", "prod"];

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return null; // null = file absent, skip this env
  const ports = {};
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("PORT")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (/^\d+$/.test(val)) ports[key] = val;
  }
  return ports;
}

const resolved = {};
const warnings = [];
for (const env of ENVS) {
  // ADR-0072: the generated runtime artifact .env/<env>.env (from the manifest) is
  // the source; fall back to a legacy .env.<env> file only if present.
  const generated = parseEnvFile(path.join(repoRoot, ".env", `${env}.env`));
  const explicit = generated ?? parseEnvFile(path.join(repoRoot, `.env.${env}`));
  if (explicit === null) {
    warnings.push(
      `[${env}] no .env/${env}.env or .env.${env} — run: make env-generate-runtime ENV=${env}`
    );
    continue; // absent env files are normal in CI; only check what's present
  }
  resolved[env] = { ...COMPOSE_DEFAULTS, ...explicit };
}

const errors = [];

// 1. Within-environment clashes
for (const [env, ports] of Object.entries(resolved)) {
  const seen = new Map();
  for (const [key, port] of Object.entries(ports)) {
    if (seen.has(port)) {
      errors.push(`[${env}] port ${port} allocated to both ${key} and ${seen.get(port)}`);
    } else {
      seen.set(port, key);
    }
  }
}

// 2. Cross-environment clashes (same host port, different envs)
const allPorts = new Map();
for (const [env, ports] of Object.entries(resolved)) {
  for (const [key, port] of Object.entries(ports)) {
    if (!allPorts.has(port)) allPorts.set(port, []);
    allPorts.get(port).push(`${env}:${key}`);
  }
}
for (const [port, uses] of allPorts) {
  const envNames = [...new Set(uses.map((u) => u.split(":")[0]))];
  if (envNames.length > 1) {
    errors.push(`port ${port} used in multiple environments: ${uses.join(", ")}`);
  }
}

const checkedEnvs = Object.keys(resolved);
const skipped = ENVS.filter((e) => !checkedEnvs.includes(e));
const skippedSuffix = skipped.length ? `; skipped: ${skipped.join(", ")}` : "";

if (jsonMode) {
  const summary =
    errors.length === 0
      ? `No port clashes detected (checked: ${checkedEnvs.join(", ")}${skippedSuffix}).`
      : `${errors.length} port clash(es) found.`;
  const result = {
    tool: "validate-compose-ports",
    passed: errors.length === 0,
    errors,
    warnings,
    summary,
  };
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exit(errors.length > 0 ? 1 : 0);
}

if (errors.length > 0) {
  console.error("validate-compose-ports: FAILED");
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

if (warnings.length > 0) {
  for (const w of warnings) console.warn(`  ⚠ ${w}`);
}
console.log(`validate-compose-ports: passed (checked: ${checkedEnvs.join(", ")}${skippedSuffix})`);
