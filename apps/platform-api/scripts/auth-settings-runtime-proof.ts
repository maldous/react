/**
 * Auth Settings runtime proof (ADR-0042 / ADR-ACT-0210).
 *
 * Exercises the real credentialed realm-write path end to end against a running
 * Keycloak — the confidence gap ADR-0041 left open. For a configured realm it:
 *   1. probes readiness with valid creds  → expects "ok"
 *   2. probes readiness with a bad secret  → expects "invalid_credential"
 *   3. reads, writes, and reads back the MFA policy (required: optional→required)
 *   4. reads, writes, and reads back the Session policy (access token lifespan)
 *   5. RESTORES both to their original values
 * It asserts each read-back reflects the write, then prints a PASS/FAIL summary.
 *
 * This proves RealmAdminPort → Keycloak → read-back + the readiness classifier
 * against a live realm. The BFF route wiring, audit-first ordering, and
 * no-secret-in-audit guarantees are covered by node:test + MSW integration tests.
 *
 * Usage (Keycloak must be up; `make compose-up-identity`):
 *   KC_PROOF_REALM=platform \
 *   node --loader ./apps/platform-api/loader.mjs \
 *     apps/platform-api/scripts/auth-settings-runtime-proof.ts
 *
 * Config (env, with dev defaults):
 *   KEYCLOAK_URL          default http://localhost:8090/kc
 *   KC_PROOF_REALM        default platform
 *   KEYCLOAK_ADMIN_USER   default admin
 *   KEYCLOAK_ADMIN_PASSWORD default admin
 *
 * The script mutates and then restores realm policy; it never prints secrets.
 */

import { KeycloakRealmAdminAdapter } from "@platform/adapters-keycloak";
import assert from "node:assert/strict";
import type { MfaPolicy, SessionPolicy } from "@platform/authorisation-runtime";

const url = process.env["KEYCLOAK_URL"] ?? "http://localhost:8090/kc";
const realm = process.env["KC_PROOF_REALM"] ?? "platform";
const adminUsername = process.env["KEYCLOAK_ADMIN_USER"] ?? "admin";
const adminPassword = process.env["KEYCLOAK_ADMIN_PASSWORD"] ?? "admin";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}` + (detail ? ` — ${detail}` : ""));
  if (!ok) failures++;
  assert.equal(ok, true, detail ? `${label}: ${detail}` : label);
}

async function main(): Promise<void> {
  console.log(`# Auth Settings runtime proof — realm "${realm}" @ ${url}\n`);

  // Dev/seed path: admin-cli password grant against the master realm.
  const adapter = new KeycloakRealmAdminAdapter({ url, realm, adminUsername, adminPassword });

  // 1. readiness with valid credentials
  const ready = await adapter.probeReadiness();
  check("readiness (valid credentials) === ok", ready === "ok", `got "${ready}"`);

  // 2. readiness with a deliberately invalid client credential
  const badAdapter = new KeycloakRealmAdminAdapter({
    url,
    realm,
    adminClientId: "nonexistent-client",
    adminClientSecret: "wrong-secret",
  });
  const badReady = await badAdapter.probeReadiness();
  check("readiness (bad credential) is classified, not ok", badReady !== "ok", `got "${badReady}"`);

  // 3. MFA round-trip
  const mfaOriginal: MfaPolicy = await adapter.getMfaPolicy();
  console.log(`  MFA original: required=${mfaOriginal.required} type=${mfaOriginal.type}`);
  try {
    await adapter.setMfaPolicy({ required: "required", type: "totp" });
    const afterRequired = await adapter.getMfaPolicy();
    check("MFA write required → read-back required", afterRequired.required === "required");

    await adapter.setMfaPolicy({ required: "optional", type: "totp" });
    const afterOptional = await adapter.getMfaPolicy();
    check("MFA write optional → read-back optional", afterOptional.required === "optional");
  } finally {
    await adapter.setMfaPolicy({ required: mfaOriginal.required, type: mfaOriginal.type });
    const restored = await adapter.getMfaPolicy();
    check("MFA restored to original", restored.required === mfaOriginal.required);
  }

  // 4. Session round-trip
  const sessionOriginal: SessionPolicy = await adapter.getSessionPolicy();
  console.log(
    `  Session original: accessTokenLifespan=${sessionOriginal.accessTokenLifespanSeconds}s`
  );
  const probeValue = sessionOriginal.accessTokenLifespanSeconds === 600 ? 900 : 600;
  try {
    await adapter.setSessionPolicy({ ...sessionOriginal, accessTokenLifespanSeconds: probeValue });
    const afterWrite = await adapter.getSessionPolicy();
    check(
      "Session write → read-back reflects new access-token lifespan",
      afterWrite.accessTokenLifespanSeconds === probeValue,
      `got ${afterWrite.accessTokenLifespanSeconds}s`
    );
  } finally {
    await adapter.setSessionPolicy(sessionOriginal);
    const restored = await adapter.getSessionPolicy();
    check(
      "Session restored to original",
      restored.accessTokenLifespanSeconds === sessionOriginal.accessTokenLifespanSeconds
    );
  }

  console.log(`\n# ` + (failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("runtime proof errored:", err instanceof Error ? err.message : err);
  process.exit(2);
});
