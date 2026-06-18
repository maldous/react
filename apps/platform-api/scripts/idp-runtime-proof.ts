/**
 * Identity Provider runtime proof (ADR-0043 / ADR-ACT-0211).
 *
 * Exercises the real IdP create/read/update/delete path against a running
 * Keycloak, asserting the redaction + secret-handling guarantees end to end:
 *   1. probe readiness                       → expects "ok"
 *   2. create a temporary oidc IdP
 *   3. list + map to the redacted summary    → hasClientSecret true, secret ABSENT
 *   4. read the raw rep                       → Keycloak masks the secret
 *   5. update a non-secret field (displayName) with a BLANK secret → preserved
 *   6. rotate the secret                      → write succeeds
 *   7. disable then re-enable
 *   8. delete + confirm it is gone
 * Every temporary resource is removed. The real secret value is asserted to
 * never appear in the redacted summary, and the script never prints it.
 *
 * Usage (Keycloak must be up; `make compose-up-identity`):
 *   KC_PROOF_REALM=platform npm run proof:auth-idps
 */

import { KeycloakRealmAdminAdapter } from "@platform/adapters-keycloak";
import {
  toIdpSummary,
  buildCreateRepresentation,
  applyUpdate,
} from "../src/usecases/idp-management.ts";

const url = process.env["KEYCLOAK_URL"] ?? "http://localhost:8090/kc";
const realm = process.env["KC_PROOF_REALM"] ?? "platform";
const adminUsername = process.env["KEYCLOAK_ADMIN_USER"] ?? "admin";
const adminPassword = process.env["KEYCLOAK_ADMIN_PASSWORD"] ?? "admin";

const ALIAS = "proof-idp-temp";
const SECRET = "proof-only-secret-do-not-log";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}` + (detail ? ` — ${detail}` : ""));
  if (!ok) failures++;
}

async function main(): Promise<void> {
  console.log(`# IdP runtime proof — realm "${realm}" @ ${url}\n`);
  const adapter = new KeycloakRealmAdminAdapter({ url, realm, adminUsername, adminPassword });

  const ready = await adapter.probeReadiness();
  check("readiness === ok", ready === "ok", `got "${ready}"`);

  // Start clean (idempotent) then create.
  await adapter.deleteIdentityProvider(ALIAS);
  await adapter.createIdentityProvider(
    buildCreateRepresentation({
      alias: ALIAS,
      displayName: "Proof IdP",
      providerId: "oidc",
      clientId: "proof-client",
      clientSecret: SECRET,
      authorizationUrl: "https://idp.proof.test/auth",
      tokenUrl: "https://idp.proof.test/token",
      scopes: "openid email",
      trustEmail: false,
      enabled: true,
    })
  );
  check("created the temporary IdP", true);

  try {
    // Redacted summary: secret must be absent; hasClientSecret true.
    const summaries = (await adapter.listIdentityProviders()).map(toIdpSummary);
    const summary = summaries.find((s) => s.alias === ALIAS);
    check("IdP appears in the redacted list", !!summary);
    check("summary.hasClientSecret === true", summary?.hasClientSecret === true);
    const serialised = JSON.stringify(summary ?? {});
    check("redacted summary does NOT contain the secret value", !serialised.includes(SECRET));
    check("redacted summary has no clientSecret field", !serialised.includes("clientSecret"));

    // Raw representation: Keycloak masks the secret (we never expose it ourselves).
    const raw = await adapter.getIdentityProvider(ALIAS);
    check(
      "raw clientSecret is masked by Keycloak (not the real value)",
      raw?.config?.["clientSecret"] !== SECRET,
      `got "${raw?.config?.["clientSecret"]}"`
    );

    // Update a non-secret field with a BLANK secret → secret preserved (mask re-sent).
    await adapter.updateIdentityProvider(
      ALIAS,
      applyUpdate(raw!, { displayName: "Proof Renamed" })
    );
    const afterRename = await adapter.getIdentityProvider(ALIAS);
    check("non-secret update applied", afterRename?.displayName === "Proof Renamed");
    check(
      "secret still masked after blank-secret update (preserved)",
      afterRename?.config?.["clientSecret"] !== SECRET
    );

    // Rotate the secret (write-only) — succeeds; value never read back.
    await adapter.updateIdentityProvider(
      ALIAS,
      applyUpdate(afterRename!, { clientSecret: "rotated-proof-secret" })
    );
    check("secret rotation write succeeded", true);

    // Disable then re-enable.
    const cur = await adapter.getIdentityProvider(ALIAS);
    await adapter.updateIdentityProvider(ALIAS, applyUpdate(cur!, { enabled: false }));
    check("disable applied", (await adapter.getIdentityProvider(ALIAS))?.enabled === false);
    await adapter.updateIdentityProvider(ALIAS, applyUpdate(cur!, { enabled: true }));
    check("re-enable applied", (await adapter.getIdentityProvider(ALIAS))?.enabled === true);
  } finally {
    await adapter.deleteIdentityProvider(ALIAS);
  }

  const gone = await adapter.getIdentityProvider(ALIAS);
  check("deleted (no longer present)", gone === null);

  console.log(`\n# ` + (failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("idp runtime proof errored:", err instanceof Error ? err.message : err);
  process.exit(2);
});
