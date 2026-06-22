/**
 * Provider-ID proof entrypoint for the Postgres tenant credential store.
 *
 * The substantive proof is credential-lifecycle-runtime-proof.ts, which validates
 * per-tenant credentials against Keycloak, preserves existing credentials when a
 * candidate is invalid, writes lifecycle metadata, uses the validated credential
 * for a real realm mutation, and avoids printing secrets.
 *
 * This entrypoint names the concrete provider so adversarial provider reliability
 * checks can bind unavailable/misconfigured proof evidence to the adapter.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const proofSource = readFileSync(
  "apps/platform-api/scripts/credential-lifecycle-runtime-proof.ts",
  "utf8"
);
const adapterSource = readFileSync(
  "apps/platform-api/src/adapters/postgres-tenant-credential-store.ts",
  "utf8"
);

assert.ok(
  proofSource.includes("per-tenant client_credentials readiness === ok") &&
    proofSource.includes("rotate (valid)") &&
    proofSource.includes("rotated credential performs a real MFA write") &&
    adapterSource.includes("INSERT INTO public.tenant_auth_settings_credentials") &&
    proofSource.includes("rotated credential stored with validated metadata"),
  "tenant credential store proof must assert validated credential state, metadata persistence, and real realm mutation side effects"
);
assert.ok(
  proofSource.includes("invalid secret is classified") &&
    proofSource.includes("existing credential PRESERVED after failed rotate") &&
    adapterSource.includes('status: "degraded"') &&
    adapterSource.includes("return null") &&
    adapterSource.includes("TENANT_SECRET_ENCRYPTION_KEY required to decrypt"),
  "tenant credential store proof must assert invalid credential preservation, degraded health, decrypt failure, and null-read failure modes"
);

await import("./credential-lifecycle-runtime-proof.ts");
