/**
 * OIDC Enterprise Hardening runtime proof (ADR-0046 / ADR-ACT-0215).
 *
 * Exercises discovery import, issuer + JWKS validation, callback-URL display, and
 * the non-interactive connection test against a REAL, reachable OIDC provider:
 * the local Keycloak realm itself (its `.well-known/openid-configuration` +
 * signing keys). No client secret or raw discovery document is printed.
 *
 *   1. discovery import (real realm)            → ok, issuer valid, ≥1 JWKS key
 *   2. issuer mismatch                          → classified issuer_mismatch
 *   3. unreachable endpoint                     → classified unreachable
 *   4. non-discovery JSON                       → classified invalid_document
 *   5. callback URL (pure derivation)           → /broker/<alias>/endpoint
 *   6. test-connection on a temp IdP (issuer=realm) → ok, then cleaned up
 *
 * Login simulation is intentionally NOT proven here — it stays deferred.
 *
 * Usage (Keycloak must be up; `make compose-up-identity`):
 *   KC_PROOF_REALM=platform npm run proof:auth-oidc-enterprise
 */

import type { AuditEventPort } from "@platform/audit-events";
import assert from "node:assert/strict";
import { KeycloakRealmAdminAdapter } from "@platform/adapters-keycloak";
import { buildCreateRepresentation } from "../src/usecases/idp-management.ts";
import {
  buildIdpCallbackUrl,
  importOidcDiscovery,
  testIdpConnection,
} from "../src/usecases/oidc-discovery.ts";
import { createOidcHttpFetcher } from "../src/server/oidc-http-fetcher.ts";

const url = process.env["KEYCLOAK_URL"] ?? "http://localhost:8090/kc";
const realm = process.env["KC_PROOF_REALM"] ?? "platform";
const adminUsername = process.env["KEYCLOAK_ADMIN_USER"] ?? "admin";
const adminPassword = process.env["KEYCLOAK_ADMIN_PASSWORD"] ?? "admin";

const REALM_ISSUER = `${url}/realms/${realm}`;
const WELL_KNOWN = `${REALM_ISSUER}/.well-known/openid-configuration`;
const ALIAS = "proof-oidc-enterprise-temp";

const fetcher = createOidcHttpFetcher();
const silentAudit: AuditEventPort = { emit: async () => {}, query: async () => [] };

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}` + (detail ? ` — ${detail}` : ""));
  if (!ok) failures++;
  assert.equal(ok, true, detail ? `${label}: ${detail}` : label);
}

async function main(): Promise<void> {
  console.log(`# OIDC enterprise runtime proof — realm "${realm}" @ ${url}\n`);

  // 1. Discovery import against the real realm discovery document.
  const ok = await importOidcDiscovery({ issuer: REALM_ISSUER }, { fetcher });
  check("discovery import ok", ok.kind === "ok" && ok.response.validation.result === "ok");
  if (ok.kind === "ok") {
    check("issuer validated", ok.response.validation.issuerValid === true);
    check(
      "JWKS usable (≥1 key)",
      ok.response.validation.jwksKeyCount >= 1,
      `keys=${ok.response.validation.jwksKeyCount}`
    );
    check("metadata returned (no raw document)", ok.response.metadata?.issuer === REALM_ISSUER);
  }

  // 2. Issuer mismatch — same document, a deliberately wrong expected issuer.
  const mismatch = await importOidcDiscovery(
    { issuer: `${REALM_ISSUER}-wrong`, discoveryUrl: WELL_KNOWN },
    { fetcher }
  );
  check(
    "issuer mismatch classified",
    mismatch.kind === "ok" && mismatch.response.validation.result === "issuer_mismatch"
  );

  // 3. Unreachable endpoint.
  const unreachable = await importOidcDiscovery(
    { issuer: "https://oidc-proof.invalid" },
    { fetcher }
  );
  check(
    "unreachable classified",
    unreachable.kind === "ok" && unreachable.response.validation.result === "unreachable"
  );

  // 4. A reachable JSON endpoint that is NOT a discovery document.
  const invalid = await importOidcDiscovery({ discoveryUrl: REALM_ISSUER }, { fetcher });
  check(
    "non-discovery JSON classified invalid_document",
    invalid.kind === "ok" && invalid.response.validation.result === "invalid_document"
  );

  // 5. Callback URL (pure derivation; never a secret).
  const cb = buildIdpCallbackUrl(url, realm, ALIAS);
  check(
    "callback URL derived",
    cb.callbackUrl.includes(`/broker/${ALIAS}/endpoint`),
    cb.callbackUrl
  );

  // 6. Test-connection on a temporary IdP whose issuer is the real realm.
  const adapter = new KeycloakRealmAdminAdapter({ url, realm, adminUsername, adminPassword });
  await adapter.deleteIdentityProvider(ALIAS);
  await adapter.createIdentityProvider(
    buildCreateRepresentation({
      alias: ALIAS,
      displayName: "Proof OIDC Enterprise",
      providerId: "oidc",
      clientId: "proof-client",
      clientSecret: "proof-only-secret-do-not-log",
      authorizationUrl: `${REALM_ISSUER}/protocol/openid-connect/auth`,
      tokenUrl: `${REALM_ISSUER}/protocol/openid-connect/token`,
      issuer: REALM_ISSUER,
      scopes: "openid email",
      trustEmail: false,
      enabled: true,
    })
  );
  try {
    const result = await testIdpConnection(
      {
        alias: ALIAS,
        organisationId: "proof-org",
        realmName: realm,
        actorId: "proof-actor",
        actorRoles: ["tenant-admin"],
      },
      { reader: adapter, fetcher, audit: silentAudit }
    );
    check(
      "test-connection ok against the configured issuer",
      result.kind === "ok" && result.validation.result === "ok",
      result.kind === "ok" ? result.validation.result : result.kind
    );
  } finally {
    await adapter.deleteIdentityProvider(ALIAS);
  }
  check("temporary IdP cleaned up", (await adapter.getIdentityProvider(ALIAS)) === null);

  console.log(`\n# ` + (failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("oidc enterprise runtime proof errored:", err instanceof Error ? err.message : err);
  process.exit(2);
});
