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
];

const REQUIRED_BY_STAGE = {
  staging: ["KEYCLOAK_PORT"],
  prod: ["KEYCLOAK_PORT", "NODE_ENV"],
};

const FORBIDDEN_IN_PROD_STAGING = [
  {
    key: "LOCAL_FIXTURE_SESSION",
    reason: "fixture sessions must not exist in staging/prod",
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

  // forbidden keys in prod/staging
  if (stage === "prod" || stage === "staging") {
    for (const { key, reason } of FORBIDDEN_IN_PROD_STAGING) {
      if (env[key] !== undefined) fail(`${key} must not be set in ${stage}: ${reason}`);
      else ok(`${key} absent (required)`);
    }
  }

  // NODE_ENV must be "production" in prod (checked via REQUIRED_BY_STAGE + drift check)
  if (stage === "prod" && env.NODE_ENV && env.NODE_ENV !== "production") {
    fail(`NODE_ENV="${env.NODE_ENV}" must be "production" in prod`);
  }
}

if (errors > 0) {
  console.error(`\n✗ ${errors} env file error(s) found`);
  process.exit(1);
}
console.log(`\n✓ all env files valid`);
