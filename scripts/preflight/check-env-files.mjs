#!/usr/bin/env node
// Validates .env.* files exist and have required keys.
// Usage: node check-env-files.mjs [--all]
//   --all : check all four env files (dev/test/staging/prod)
//   default: check only .env.dev

import { readFileSync, existsSync } from "node:fs";
import process from "node:process";

const ALL = process.argv.includes("--all");
const STAGES = ALL ? ["dev", "test", "staging", "prod"] : ["dev"];

const REQUIRED_ALL = [
  "POSTGRES_PORT",
  "REDIS_PORT",
  "PLATFORM_API_PORT",
  "WEB_HTTP_PORT",
  "APEX_DOMAIN",
  "LOG_LEVEL",
  // Compose project isolation — all four envs must declare their project name.
  "COMPOSE_PROJECT",
  "COMPOSE_PROJECT_FILTER",
  // Node environment — controls test behaviour and Vitest mode.
  "NODE_ENV",
];

const REQUIRED_BY_STAGE = {
  staging: ["KEYCLOAK_PORT"],
  prod: ["KEYCLOAK_PORT"],
};

// These keys must be completely absent (not just empty) in staging/prod.
// Their presence — even with an empty value — is a misconfiguration.
const MUST_BE_ABSENT_IN_PROD_STAGING = [
  {
    key: "LOCAL_FIXTURE_SESSION",
    reason: "fixture sessions must not exist in staging/prod — remove the key entirely",
  },
];

const EXPECTED_APEX = {
  dev: "dev.localhost",
  test: "test.localhost",
  staging: "staging.aldous.info",
  prod: "aldous.info",
};

let errors = 0;

function parseEnv(path) {
  const content = readFileSync(path, "utf8");
  const map = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    map[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return map;
}

function fail(msg) {
  console.error(`  ✗ ${msg}`);
  errors++;
}

function ok(msg) {
  console.log(`  ✓ ${msg}`);
}

for (const stage of STAGES) {
  const path = `.env.${stage}`;
  console.log(`\nChecking ${path}...`);

  if (!existsSync(path)) {
    fail(`${path} does not exist`);
    continue;
  }

  const env = parseEnv(path);

  for (const key of REQUIRED_ALL) {
    if (!env[key]) fail(`${key} is missing`);
    else ok(`${key} present`);
  }

  for (const key of REQUIRED_BY_STAGE[stage] ?? []) {
    if (!env[key]) fail(`${key} required for ${stage} but missing`);
    else ok(`${key} present`);
  }

  // apex domain check
  if (env.APEX_DOMAIN && env.APEX_DOMAIN !== EXPECTED_APEX[stage]) {
    fail(`APEX_DOMAIN="${env.APEX_DOMAIN}" expected "${EXPECTED_APEX[stage]}" for ${stage}`);
  } else if (env.APEX_DOMAIN) {
    ok(`APEX_DOMAIN="${env.APEX_DOMAIN}" matches expected`);
  }

  // These keys must be completely absent from staging/prod.
  // Even an empty value (KEY=) is rejected — the key must not appear in the file.
  if (stage === "prod" || stage === "staging") {
    for (const { key, reason } of MUST_BE_ABSENT_IN_PROD_STAGING) {
      if (env[key] !== undefined) fail(`${key} must be absent from ${stage}: ${reason}`);
      else ok(`${key} absent (correct)`);
    }
  }

  // NODE_ENV must be "production" in prod
  if (stage === "prod" && env.NODE_ENV !== "production") {
    fail(`NODE_ENV="${env.NODE_ENV}" must be "production" in prod`);
  }

  // NODE_ENV must not be "production" in dev/test (breaks Vitest)
  if ((stage === "dev" || stage === "test") && env.NODE_ENV === "production") {
    fail(`NODE_ENV="production" must not be set in ${stage} — breaks Vitest`);
  }
}

if (errors > 0) {
  console.error(`\n✗ ${errors} env file error(s) found`);
  process.exit(1);
}
console.log(`\n✓ all env files valid`);
