/**
 * Provider-level contract proof for keycloak-realm-admin-adapter.
 *
 * The live Keycloak behavioural checks run as their own proof commands:
 * auth-settings-runtime-proof.ts and credential-lifecycle-runtime-proof.ts.
 * This wrapper intentionally verifies that those lower-level live proofs and
 * adapter/test contracts remain wired, without importing and re-running the
 * mutable proof modules in the same process.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../..");
const authSettingsProofSource = readFileSync(
  join(scriptDir, "auth-settings-runtime-proof.ts"),
  "utf8"
);
const credentialProofSource = readFileSync(
  join(scriptDir, "credential-lifecycle-runtime-proof.ts"),
  "utf8"
);
const keycloakAdapterSource = readFileSync(
  join(repoRoot, "packages/adapters-keycloak/src/index.ts"),
  "utf8"
);
const authReadinessTestSource = readFileSync(
  join(repoRoot, "apps/platform-api/tests/unit/auth-settings-readiness.test.ts"),
  "utf8"
);

assert.ok(
  authSettingsProofSource.includes("adapter.probeReadiness") &&
    authSettingsProofSource.includes("readiness (valid credentials) === ok") &&
    authSettingsProofSource.includes("badAdapter") &&
    authSettingsProofSource.includes('badReady !== "ok"'),
  "delegated Keycloak proof must assert live readiness status and bad-credential failure state"
);
assert.ok(
  authSettingsProofSource.includes("setMfaPolicy") &&
    authSettingsProofSource.includes("getMfaPolicy") &&
    authSettingsProofSource.includes("MFA write required") &&
    authSettingsProofSource.includes("MFA restored to original") &&
    authSettingsProofSource.includes("setSessionPolicy") &&
    authSettingsProofSource.includes("Session write") &&
    authSettingsProofSource.includes("Session restored to original"),
  "delegated Keycloak proof must assert MFA/session write, read-back, and restore side effects"
);
assert.ok(
  credentialProofSource.includes("per-tenant client_credentials readiness === ok") &&
    credentialProofSource.includes("rotated credential stored with validated metadata") &&
    credentialProofSource.includes("existing credential PRESERVED after failed rotate") &&
    credentialProofSource.includes("rotated credential performs a real MFA write"),
  "delegated credential lifecycle proof must assert tenant credential validation, stored state, preserved failure state, and real realm mutation"
);
assert.ok(
  keycloakAdapterSource.includes("assertAdminOk") &&
    keycloakAdapterSource.includes("throw new Error") &&
    keycloakAdapterSource.includes("setMfaPolicy") &&
    keycloakAdapterSource.includes("setSessionPolicy") &&
    keycloakAdapterSource.includes("probeReadiness") &&
    keycloakAdapterSource.includes('return "invalid_credential"') &&
    keycloakAdapterSource.includes('return "unreachable"'),
  "Keycloak adapter must implement fail-closed admin mutations and classified readiness state"
);
assert.ok(
  authReadinessTestSource.includes("audit still emitted") &&
    authReadinessTestSource.includes("forbidden_realm_operation") &&
    authReadinessTestSource.includes("realm_unreachable") &&
    authReadinessTestSource.includes(
      "does NOT store and does NOT audit when the credential fails validation"
    ) &&
    authReadinessTestSource.includes("audited clientId, NEVER the secret"),
  "auth settings tests must assert audit ordering, no-secret audit state, and invalid credential failure behavior"
);
