// scripts/env/lib/manifests.mjs
//
// Shared library for the Makefile-driven environment substrate (ADR-0072).
//
// The environment MANIFESTS at config/environments/<stage>.json are the
// tracked, non-secret source of truth for environment bootstrap intent.
// Hand-maintained .env.<stage> files are NO LONGER a required source input.
//
// Runtime env files (.env/<stage>.env) are produced FROM the manifest
// and are gitignored, reproducible, non-authoritative artifacts — safe to delete.
//
// This module is consumed by:
//   - scripts/env/generate-runtime-env.mjs   (manifest -> generated runtime env)
//   - scripts/env/validate-manifests.mjs     (manifest + generated-output validation)
//
// It performs NO I/O beyond reading manifest JSON. It must stay dependency-free.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, "..", "..", "..");

export const STAGES = ["dev", "test", "staging", "prod"];

export const MANIFEST_DIR = resolve(REPO_ROOT, "config", "environments");
// Generated runtime env artifacts live under .env/ (gitignored by the existing
// `.env` directory rule). Layout: .env/<stage>.env, .env/secrets/<stage>.env.
export const GENERATED_ENV_DIR = resolve(REPO_ROOT, ".env");
export const GENERATED_SECRETS_DIR = resolve(REPO_ROOT, ".env", "secrets");

// Canonical stage → policy expectations. These are POLICY INVARIANTS and are
// enforced by the validator; a manifest that contradicts them is rejected.
// This replaces the hard-coded rules formerly living in check-env-drift.mjs.
export const STAGE_POLICY = {
  dev: {
    stage: "development",
    executor: "tilt",
    authMode: "fixture",
    cookieSecure: false,
    destructiveAllowed: true,
    dataPreservation: "ephemeral",
    logLevels: ["debug", "info", "warn"],
    apex: "dev.localhost",
    mocksAllowed: true,
    nodeEnv: "development",
  },
  test: {
    stage: "test",
    executor: "compose",
    authMode: "fixture",
    cookieSecure: false,
    destructiveAllowed: true,
    dataPreservation: "ephemeral",
    logLevels: ["debug", "info", "warn"],
    apex: "test.localhost",
    mocksAllowed: true,
    nodeEnv: "test",
  },
  staging: {
    stage: "staging",
    executor: "compose",
    authMode: "real",
    cookieSecure: true,
    destructiveAllowed: false,
    dataPreservation: "preserve",
    logLevels: ["info", "warn"],
    apex: "staging.aldous.info",
    mocksAllowed: false,
    nodeEnv: "staging",
  },
  prod: {
    stage: "production",
    executor: "compose",
    authMode: "real",
    cookieSecure: true,
    destructiveAllowed: false,
    dataPreservation: "preserve",
    logLevels: ["info", "warn"],
    apex: "aldous.info",
    mocksAllowed: false,
    nodeEnv: "production",
  },
};

// Runtime env keys whose VALUES are secrets. These keys must NEVER appear in a
// tracked manifest. The generator sources them from the secret material file
// (.env/secrets/<stage>.env, produced by `make env-seed-secrets`) or
// synthesises local-bootstrap values for dev/test. They are written only into
// the gitignored runtime artifact.
export const SECRET_ENV_KEYS = [
  "KEYCLOAK_CLIENT_SECRET",
  "KEYCLOAK_PROVISIONER_CLIENT_SECRET",
  "CADDY_INTERNAL_SECRET",
  "TENANT_SECRET_ENCRYPTION_KEY",
  "API_KEY_PEPPER",
  "GRAFANA_ADMIN_PASSWORD",
  "KEYCLOAK_TEST_PASSWORD",
  "WEBHOOK_SIGNING_SECRET",
  "SYSADMIN_BOOTSTRAP_PASSWORD",
  // Shared service / container-bootstrap credentials (formerly the hand-maintained
  // root .env "shared service credentials" block). Emitted only into the generated
  // runtime artifact, never the manifest.
  "POSTGRES_PASSWORD",
  "CLICKHOUSE_PASSWORD",
  "MINIO_ROOT_PASSWORD",
  "KEYCLOAK_DB_PASSWORD",
  "KEYCLOAK_ADMIN_PASSWORD",
  "SENTRY_DB_PASSWORD",
  "SENTRY_SECRET_KEY",
  // Composed-service SSO confidential client secrets (ADR-0073). Match the Keycloak
  // clients (Terraform sets them from these via TF_VAR). Per-environment.
  "GRAFANA_OIDC_CLIENT_SECRET",
  "SONAR_OIDC_CLIENT_SECRET",
  "PGADMIN_OIDC_CLIENT_SECRET",
];

// Shared cross-environment services (single instance, react-sonar / react-shared
// Compose projects) — NOT part of the per-environment deployment ladder. Their
// runtime env is generated to .env/<target>.env from config/environments/shared.json
// so NO hand-maintained .env.sonar / .env.sentry is required (ADR-0072).
export const SHARED_TARGETS = ["sonar", "sentry"];
export const SHARED_SECRET_KEYS = {
  sonar: ["SONAR_DB_PASSWORD", "SONAR_ADMIN_PASSWORD", "SONAR_TOKEN"],
  sentry: ["SENTRY_SECRET_KEY", "SENTRY_ADMIN_PASSWORD"],
};
// Secret keys left EMPTY when not seeded — runtime-provisioned, never derived
// (e.g. SonarQube analysis token, minted by scripts/sonar/provision-token.sh).
export const RUNTIME_PROVISIONED_KEYS = ["SONAR_TOKEN"];
export const SHARED_PATH = resolve(MANIFEST_DIR, "shared.json");
export function loadShared() {
  if (!existsSync(SHARED_PATH)) return {};
  return JSON.parse(readFileSync(SHARED_PATH, "utf8"));
}

export const COMMON_PATH = resolve(MANIFEST_DIR, "common.json");

// Load the shared, non-secret base config merged UNDER every stage's runtime
// (formerly the non-secret half of the root .env "shared service credentials").
export function loadCommon() {
  if (!existsSync(COMMON_PATH)) return { runtime: {} };
  return JSON.parse(readFileSync(COMMON_PATH, "utf8"));
}

// Heuristic used by the validator to reject secret-looking keys in a manifest.
// A manifest is non-secret bootstrap intent ONLY.
const SECRET_KEY_PATTERN =
  /(secret|password|passwd|pepper|token|api[_-]?key|private[_-]?key|encryption[_-]?key|credential)/i;

export function looksSecret(key) {
  return SECRET_KEY_PATTERN.test(key) || SECRET_ENV_KEYS.includes(key);
}

export function manifestPath(stage) {
  return resolve(MANIFEST_DIR, `${stage}.json`);
}

export function generatedEnvPath(stage) {
  return resolve(GENERATED_ENV_DIR, `${stage}.env`);
}

export function generatedSecretsPath(stage) {
  return resolve(GENERATED_SECRETS_DIR, `${stage}.env`);
}

export function loadManifest(stage) {
  const path = manifestPath(stage);
  if (!existsSync(path)) {
    throw new Error(`environment manifest missing: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

// Parse a KEY=VALUE env-style file into a flat object. Used for generated
// runtime/secret artifacts (NOT for manifests).
export function parseEnvFile(path) {
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

// Recursively walk a manifest object yielding [keyPath, key, value] for every
// leaf. Used by the validator to detect secret-looking keys anywhere.
export function* walkLeaves(obj, prefix = "") {
  if (obj === null || typeof obj !== "object") return;
  for (const [k, v] of Object.entries(obj)) {
    const keyPath = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object") {
      yield* walkLeaves(v, keyPath);
    } else {
      yield [keyPath, k, v];
    }
  }
}
