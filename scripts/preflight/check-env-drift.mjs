#!/usr/bin/env node
// Validates env files against declared policy constraints.
// Catches drift: staging/prod with fixture auth, insecure cookies, wrong log level, etc.

import { readFileSync, existsSync } from "node:fs";
import process from "node:process";

function parseEnv(path) {
  if (!existsSync(path)) return {};
  const map = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    map[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return map;
}

const RULES = {
  dev: {
    authMode: "fixture",
    secure: false,
    logLevels: ["debug", "info", "warn"],
    apex: "dev.localhost",
  },
  test: {
    authMode: "fixture",
    secure: false,
    logLevels: ["warn", "info", "debug"],
    apex: "test.localhost",
  },
  staging: {
    authMode: "real",
    secure: true,
    logLevels: ["info", "warn"],
    apex: "staging.aldous.info",
  },
  prod: {
    authMode: "real",
    secure: true,
    logLevels: ["info", "warn"],
    apex: "aldous.info",
  },
};

let errors = 0;

function fail(msg) {
  console.error(`  ✗ ${msg}`);
  errors++;
}
function ok(msg) {
  console.log(`  ✓ ${msg}`);
}

for (const [stage, rules] of Object.entries(RULES)) {
  const path = `.env.${stage}`;
  console.log(`\nDrift check: ${path}`);

  if (!existsSync(path)) {
    console.warn(`  ⚠ ${path} not found — skipping`);
    continue;
  }

  const env = parseEnv(path);

  // authMode: real → LOCAL_FIXTURE_SESSION must be absent or empty
  if (rules.authMode === "real") {
    if (env.LOCAL_FIXTURE_SESSION) {
      fail(`LOCAL_FIXTURE_SESSION must not be set in ${stage} (authMode=real)`);
    } else {
      ok("LOCAL_FIXTURE_SESSION absent or empty");
    }
  }

  // secure: COOKIE_SECURE must not be "false"
  if (rules.secure) {
    if (env.COOKIE_SECURE === "false") {
      fail(`COOKIE_SECURE=false in ${stage} — must be true or unset in production-like envs`);
    } else {
      ok("COOKIE_SECURE not false");
    }
  }

  // LOG_LEVEL must be in allowed set
  if (env.LOG_LEVEL && !rules.logLevels.includes(env.LOG_LEVEL)) {
    fail(
      `LOG_LEVEL="${env.LOG_LEVEL}" not allowed in ${stage} (allowed: ${rules.logLevels.join(", ")})`
    );
  } else if (env.LOG_LEVEL) {
    ok(`LOG_LEVEL="${env.LOG_LEVEL}" acceptable`);
  }

  // APEX_DOMAIN must match expected value
  if (env.APEX_DOMAIN && env.APEX_DOMAIN !== rules.apex) {
    fail(`APEX_DOMAIN="${env.APEX_DOMAIN}" expected "${rules.apex}" for ${stage}`);
  } else if (env.APEX_DOMAIN) {
    ok(`APEX_DOMAIN="${env.APEX_DOMAIN}" matches policy`);
  }
}

if (errors > 0) {
  console.error(`\n✗ ${errors} env drift error(s) found`);
  process.exit(1);
}
console.log("\n✓ no env drift detected");
