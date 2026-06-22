/**
 * Provider-ID proof entrypoint for postgres-provider-config-repository.
 *
 * The substantive proof is provider-config-runtime-proof.ts, which validates
 * live provider config put/list/delete, opaque credential refs, secret-policy
 * rejection, production forbiddance, lifecycle degradation, and audit behavior.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import "./provider-config-runtime-proof.ts";

const proofSource = readFileSync(
  "apps/platform-api/scripts/provider-config-runtime-proof.ts",
  "utf8"
);
const adapterSource = readFileSync(
  "apps/platform-api/src/adapters/postgres-provider-config-repository.ts",
  "utf8"
);

assert.ok(
  proofSource.includes("put returns the provider config") &&
    proofSource.includes("list returns the provider config") &&
    proofSource.includes("provider-config mutations are audited with no secret") &&
    proofSource.includes("delete removes the provider config") &&
    adapterSource.includes("lifecycle_state"),
  "provider config proof must assert put/list/lifecycle/delete state and secret-free audit side effects"
);
assert.ok(
  proofSource.includes("a plaintext-looking credentialRef is rejected") &&
    proofSource.includes("config with a secret-bearing key is rejected") &&
    proofSource.includes("forbidden-in-production provider cannot be active in prod") &&
    adapterSource.includes("postgres-provider-config-repository unavailable") &&
    adapterSource.includes("fail-closed after retry attempts"),
  "provider config proof must assert credential/config rejection, production forbiddance, and unavailable fail-closed modes"
);
