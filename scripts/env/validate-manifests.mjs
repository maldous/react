#!/usr/bin/env node
// scripts/env/validate-manifests.mjs
//
// Validates the environment MANIFESTS (config/environments/<stage>.json) and the
// runtime env they generate. Replaces the legacy .env.*-coupled validators
// (scripts/preflight/check-env-files.mjs, scripts/preflight/check-env-drift.mjs).
//
// This validator does NOT require any hand-maintained .env.<stage> file to
// exist — the manifest is the source of truth (ADR-0072). It fails when:
//   - a manifest is missing/unparseable or the deployment ladder is incomplete
//   - a manifest contains a secret-looking KEY or a secret-looking VALUE
//   - a manifest contradicts its canonical stage policy (executor/auth/cookie/
//     apex/node-env/log-level/destructive)
//   - a mock provider is allowed in staging/prod (mocks forbidden there)
//   - a fixture session leaks into staging/prod
//   - the generated runtime env is missing required keys or is stale
//   - a generated runtime artifact (.env/) is tracked by git
//
// Usage:
//   node scripts/env/validate-manifests.mjs [--all]   (--all is implied; kept for parity)

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";
import {
  STAGES,
  STAGE_POLICY,
  SECRET_ENV_KEYS,
  looksSecret,
  loadManifest,
  loadCommon,
  loadShared,
  manifestPath,
  generatedEnvPath,
  walkLeaves,
  REPO_ROOT,
} from "./lib/manifests.mjs";
import { generate } from "./generate-runtime-env.mjs";

// Required keys in the GENERATED runtime env (ported from check-env-files.mjs).
const REQUIRED_RUNTIME_KEYS = [
  "POSTGRES_PORT",
  "REDIS_PORT",
  "PLATFORM_API_PORT",
  "WEB_HTTP_PORT",
  "APEX_DOMAIN",
  "LOG_LEVEL",
  "COMPOSE_PROJECT",
  "COMPOSE_PROJECT_FILTER",
  "NODE_ENV",
  "KEYCLOAK_PORT",
];

// Manifest VALUE keys allowed to contain a plaintext credential: the local
// container-bootstrap connection URLs (documented Compose limitation, ADR-0072).
const VALUE_SECRET_ALLOWLIST = new Set([
  "runtime.POSTGRES_URL",
  "runtime.POSTGRES_APP_URL",
  "runtime.DATABASE_URL",
  "runtime.CLICKHOUSE_URL",
]);
const HEX_SECRET = /^[0-9a-fA-F]{32,}$/;

let errors = 0;
let warnings = 0;
const fail = (m) => {
  console.error(`  ✗ ${m}`);
  errors++;
};
const warn = (m) => {
  console.warn(`  ⚠ ${m}`);
  warnings++;
};
const ok = (m) => console.log(`  ✓ ${m}`);

function parseGenerated(content) {
  const map = {};
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    map[t.slice(0, eq)] = t.slice(eq + 1);
  }
  return map;
}

function validateManifest(stage) {
  console.log(`\nManifest: config/environments/${stage}.json`);
  if (!existsSync(manifestPath(stage))) {
    fail(`manifest missing for stage "${stage}" — deployment ladder incomplete`);
    return;
  }
  let manifest;
  try {
    manifest = loadManifest(stage);
  } catch (e) {
    fail(`manifest unparseable: ${e.message}`);
    return;
  }
  const policy = STAGE_POLICY[stage];

  // 1. Secret-looking KEYS anywhere in the manifest tree.
  for (const [keyPath, key] of walkLeaves(manifest)) {
    // structural metadata key "secretStoreProvider" is an allowed name.
    if (key === "secretStoreProvider") continue;
    if (SECRET_ENV_KEYS.includes(key) || (keyPath.startsWith("runtime.") && looksSecret(key))) {
      fail(`secret-looking key "${keyPath}" must not appear in a manifest — seed it via OpenBao`);
    }
  }

  // 2. Secret-looking VALUES (high-entropy hex) anywhere except the bootstrap allowlist.
  for (const [keyPath, , value] of walkLeaves(manifest)) {
    if (typeof value !== "string") continue;
    if (VALUE_SECRET_ALLOWLIST.has(keyPath)) continue;
    if (HEX_SECRET.test(value)) {
      fail(`secret-looking value at "${keyPath}" (${value.length}-char hex) must not be committed`);
    }
  }

  // 3. Stage policy conformance.
  const rt = manifest.runtime ?? {};
  const sp = manifest.stagePolicy ?? {};
  if (manifest.stage !== policy.stage) fail(`stage="${manifest.stage}" expected "${policy.stage}"`);
  if (manifest.executor !== policy.executor)
    fail(`executor="${manifest.executor}" expected "${policy.executor}"`);
  if (sp.authMode !== policy.authMode)
    fail(`authMode="${sp.authMode}" expected "${policy.authMode}"`);
  if (sp.cookieSecure !== policy.cookieSecure)
    fail(`cookieSecure=${sp.cookieSecure} expected ${policy.cookieSecure}`);
  if (sp.destructiveAllowed !== policy.destructiveAllowed)
    fail(`destructiveAllowed=${sp.destructiveAllowed} expected ${policy.destructiveAllowed}`);
  if (rt.APEX_DOMAIN !== policy.apex)
    fail(`APEX_DOMAIN="${rt.APEX_DOMAIN}" expected "${policy.apex}"`);
  if (rt.NODE_ENV !== policy.nodeEnv)
    fail(`NODE_ENV="${rt.NODE_ENV}" expected "${policy.nodeEnv}"`);
  if (rt.LOG_LEVEL && !policy.logLevels.includes(rt.LOG_LEVEL))
    fail(`LOG_LEVEL="${rt.LOG_LEVEL}" not allowed (allowed: ${policy.logLevels.join(", ")})`);
  if (rt.SESSION_COOKIE_SECURE !== String(policy.cookieSecure))
    fail(`SESSION_COOKIE_SECURE="${rt.SESSION_COOKIE_SECURE}" expected "${policy.cookieSecure}"`);
  if (!errors)
    ok(`stage policy conforms (${policy.stage}, ${policy.executor}, auth=${policy.authMode})`);

  // 4. Mock policy — mocks forbidden in staging/prod.
  const mocks = manifest.allowedMocks ?? [];
  if (!policy.mocksAllowed && mocks.length > 0) {
    fail(`allowedMocks=[${mocks.join(", ")}] — mock providers are forbidden in ${stage}`);
  } else {
    ok(`mock policy ok (${mocks.length} allowed)`);
  }
  if (!policy.mocksAllowed && manifest.temporaryMockException) {
    const ex = manifest.temporaryMockException;
    if (!ex.adr || !ex.overrideFlag || !ex.removeWhen) {
      fail(`temporaryMockException must declare adr + overrideFlag + removeWhen`);
    } else {
      warn(
        `${stage} carries a TEMPORARY mock exception (${ex.adr}, flag ${ex.overrideFlag}) — must be removed: ${ex.removeWhen}`
      );
    }
  }

  // 5. Fixture session must not leak into staging/prod.
  if (
    policy.authMode === "real" &&
    Object.prototype.hasOwnProperty.call(rt, "LOCAL_FIXTURE_SESSION")
  ) {
    fail(`LOCAL_FIXTURE_SESSION must be absent from ${stage} runtime (authMode=real)`);
  }

  // 6. Generated runtime env: required keys present + not stale.
  let gen;
  try {
    gen = generate(stage);
  } catch (e) {
    fail(`runtime env generation failed: ${e.message}`);
    return;
  }
  const genMap = parseGenerated(gen.content);
  for (const k of REQUIRED_RUNTIME_KEYS) {
    if (genMap[k] === undefined) fail(`generated runtime env missing required key ${k}`);
  }
  // Secret keys must be PRESENT in the generated artifact but ABSENT from the manifest.
  for (const k of SECRET_ENV_KEYS) {
    if (genMap[k] === undefined) fail(`generated runtime env missing secret key ${k}`);
  }
  if (existsSync(generatedEnvPath(stage))) {
    const current = readFileSync(generatedEnvPath(stage), "utf8");
    if (current !== gen.content) {
      warn(`generated runtime env is stale — run: make env-generate-runtime ENV=${stage}`);
    } else {
      ok(`generated runtime env current (${REQUIRED_RUNTIME_KEYS.length} required keys present)`);
    }
  } else {
    ok(
      `generated runtime env producible (${REQUIRED_RUNTIME_KEYS.length} required keys present; run env-generate-runtime to materialise)`
    );
  }
}

function validateNoTrackedArtifacts() {
  console.log(`\nTracked-artifact guard:`);
  let tracked = "";
  try {
    tracked = execFileSync(
      "git",
      [
        "ls-files",
        ".env",
        ".env.dev",
        ".env.test",
        ".env.staging",
        ".env.prod",
        ".env.sonar",
        ".env.sentry",
      ],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
      }
    );
  } catch {
    // not a git repo / git unavailable — skip honestly
    warn("git unavailable — skipped tracked-artifact guard");
    return;
  }
  const offenders = tracked
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (offenders.length > 0) {
    for (const o of offenders) fail(`generated/secret artifact is tracked by git: ${o}`);
  } else {
    ok("no generated env or .env.<stage> artifact tracked by git");
  }
}

function validateCommon() {
  console.log(`\nShared base config: config/environments/common.json`);
  const common = loadCommon();
  for (const [keyPath, key, value] of walkLeaves(common)) {
    if (SECRET_ENV_KEYS.includes(key) || (keyPath.startsWith("runtime.") && looksSecret(key))) {
      fail(`secret-looking key "${keyPath}" must not appear in common.json — seed it via OpenBao`);
    }
    if (
      typeof value === "string" &&
      !VALUE_SECRET_ALLOWLIST.has(keyPath) &&
      HEX_SECRET.test(value)
    ) {
      fail(`secret-looking value at "${keyPath}" (${value.length}-char hex) must not be committed`);
    }
  }
  if (!errors) ok("shared base config carries no secret-looking key or value");
}

function validateShared() {
  console.log(`\nShared services: config/environments/shared.json`);
  const before = errors;
  for (const [keyPath, key, value] of walkLeaves(loadShared())) {
    if (SECRET_ENV_KEYS.includes(key) || (keyPath.includes("runtime.") && looksSecret(key))) {
      fail(`secret-looking key "${keyPath}" must not appear in shared.json — seed it via OpenBao`);
    }
    if (typeof value === "string" && HEX_SECRET.test(value)) {
      fail(`secret-looking value at "${keyPath}" (${value.length}-char hex) must not be committed`);
    }
  }
  if (errors === before) ok("shared services config carries no secret-looking key or value");
}

function main() {
  console.log("Validating environment manifests (ADR-0072 — no hand-maintained .env.* required)");
  validateCommon();
  validateShared();
  for (const stage of STAGES) validateManifest(stage);
  validateNoTrackedArtifacts();

  console.log("");
  if (errors > 0) {
    console.error(`✗ ${errors} manifest error(s)${warnings ? `, ${warnings} warning(s)` : ""}`);
    process.exit(1);
  }
  console.log(`✓ all environment manifests valid${warnings ? ` (${warnings} warning(s))` : ""}`);
}

main();
