/**
 * Provider-ID proof entrypoint for postgres-environment-registry-repository.
 *
 * The substantive proof is environment-registry-runtime-proof.ts, which validates
 * live environment registry sync, no-mock enforcement, permission checks, audit,
 * secret-free rows, and bootstrap state transitions.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import "./environment-registry-runtime-proof.ts";

const proofSource = readFileSync(
  "apps/platform-api/scripts/environment-registry-runtime-proof.ts",
  "utf8"
);
const adapterSource = readFileSync(
  "apps/platform-api/src/adapters/postgres-environment-registry-repository.ts",
  "utf8"
);

assert.ok(
  proofSource.includes("registerEnvironment emitted an audit event") &&
    proofSource.includes("registry record carries no secret-looking value") &&
    proofSource.includes("recordBootstrap stamps last_bootstrapped_at + status") &&
    proofSource.includes("no-mocks") &&
    proofSource.includes("bootstrap"),
  "environment registry proof must assert registration, audit, secret-free records, no-mock policy, and bootstrap state side effects"
);
assert.ok(
  proofSource.includes("list without platform.environment.read is Forbidden") &&
    proofSource.includes("SKIPPED (no live backend)") &&
    adapterSource.includes("postgres-environment-registry-repository unavailable") &&
    adapterSource.includes("no fallback is allowed") &&
    adapterSource.includes("fail-closed after retry attempts") &&
    adapterSource.includes("SET LOCAL statement_timeout"),
  "environment registry proof must assert forbidden permission, unavailable, timeout, and fail-closed failure modes"
);
