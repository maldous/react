/**
 * Auth Settings credential lifecycle runtime proof (ADR-0044 / ADR-ACT-0212).
 *
 * Proves the per-tenant credential lifecycle against a running Keycloak, end to
 * end, with a REAL tenant-realm service-account credential:
 *   1. mint a throwaway tenant-realm service account (realm-management role)
 *   2. validate it via the adapter's per-tenant client_credentials path
 *      (proves the ADR-0044 token-realm fix: client_credentials → tenant realm)
 *   3. rotate it through applyCredentialLifecycle (validate-before-store): a
 *      VALID candidate is stored with lifecycle metadata; an INVALID candidate is
 *      classified and the existing credential is PRESERVED (no store)
 *   4. use the validated credential for a real MFA write + read-back, then restore
 *   5. delete the throwaway client
 * The secret is never printed.
 *
 * Usage (Keycloak must be up; `make compose-up-identity`):
 *   KC_PROOF_REALM=platform npm run proof:auth-credential-lifecycle
 */

import { KeycloakRealmAdminAdapter } from "@platform/adapters-keycloak";
import type { RealmReadinessProbe } from "@platform/authorisation-runtime";
import { applyCredentialLifecycle } from "../src/usecases/auth-settings-readiness.ts";
import type { AuditEventPort } from "@platform/audit-events";
import type {
  TenantAdminCredential,
  CredentialLifecycle,
} from "../src/ports/tenant-credential-store.ts";

const url = process.env["KEYCLOAK_URL"] ?? "http://localhost:8090/kc";
const realm = process.env["KC_PROOF_REALM"] ?? "platform";
const adminUsername = process.env["KEYCLOAK_ADMIN_USER"] ?? "admin";
const adminPassword = process.env["KEYCLOAK_ADMIN_PASSWORD"] ?? "admin";

const CLIENT_ID = "proof-credential-lifecycle";
const SECRET = "proof-lifecycle-secret-do-not-log";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

// --- minimal Keycloak admin client (admin-cli) for setup/teardown only -------

async function masterToken(): Promise<string> {
  const res = await fetch(`${url}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: "admin-cli",
      username: adminUsername,
      password: adminPassword,
    }),
  });
  if (!res.ok) throw new Error(`master token failed: ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function findClientUuid(token: string, clientId: string): Promise<string | null> {
  const res = await fetch(
    `${url}/admin/realms/${realm}/clients?clientId=${encodeURIComponent(clientId)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const arr = (await res.json()) as Array<{ id: string }>;
  return arr[0]?.id ?? null;
}

async function deleteProofClient(token: string): Promise<void> {
  const uuid = await findClientUuid(token, CLIENT_ID);
  if (uuid) {
    await fetch(`${url}/admin/realms/${realm}/clients/${uuid}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
  }
}

async function createProofServiceAccount(token: string): Promise<void> {
  await deleteProofClient(token);
  await fetch(`${url}/admin/realms/${realm}/clients`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: CLIENT_ID,
      secret: SECRET,
      enabled: true,
      publicClient: false,
      standardFlowEnabled: false,
      serviceAccountsEnabled: true,
    }),
  });
  const uuid = await findClientUuid(token, CLIENT_ID);
  const saRes = await fetch(`${url}/admin/realms/${realm}/clients/${uuid}/service-account-user`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const saUserId = ((await saRes.json()) as { id: string }).id;
  const rmUuid = await findClientUuid(token, "realm-management");
  // manage-realm is composite (covers realm read + authentication management).
  const roleRes = await fetch(`${url}/admin/realms/${realm}/clients/${rmUuid}/roles/manage-realm`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const role = await roleRes.json();
  await fetch(`${url}/admin/realms/${realm}/users/${saUserId}/role-mappings/clients/${rmUuid}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify([role]),
  });
}

// --- in-memory store so the lifecycle usecase runs without Postgres ----------

function memoryStore(initial: TenantAdminCredential | null) {
  let current = initial;
  const sets: Array<{ credential: TenantAdminCredential; lifecycle?: CredentialLifecycle }> = [];
  return {
    sets,
    current: () => current,
    async getAuthSettingsCredential() {
      return current;
    },
    async setAuthSettingsCredential(
      _org: string,
      credential: TenantAdminCredential,
      lifecycle?: CredentialLifecycle
    ) {
      current = credential;
      sets.push({ credential, lifecycle });
    },
    async getAuthSettingsCredentialMetadata() {
      return null;
    },
  };
}

const silentAudit: AuditEventPort = {
  async emit() {},
  async query() {
    return [];
  },
};

function makeAdapter(cred: TenantAdminCredential): KeycloakRealmAdminAdapter {
  return new KeycloakRealmAdminAdapter({
    url,
    realm,
    adminClientId: cred.clientId,
    adminClientSecret: cred.clientSecret,
  });
}

async function main(): Promise<void> {
  console.log(`# Credential lifecycle runtime proof — realm "${realm}" @ ${url}\n`);
  const token = await masterToken();
  await createProofServiceAccount(token);
  console.log("  minted a throwaway tenant-realm service account\n");

  try {
    const good: TenantAdminCredential = { clientId: CLIENT_ID, clientSecret: SECRET };

    // 1. The per-tenant client_credentials path validates against the TENANT realm.
    const probe: RealmReadinessProbe = await makeAdapter(good).probeReadiness();
    check("per-tenant client_credentials readiness === ok", probe === "ok", `got "${probe}"`);

    const badProbe = await makeAdapter({
      clientId: CLIENT_ID,
      clientSecret: "wrong",
    }).probeReadiness();
    check("invalid secret is classified (not ok)", badProbe !== "ok", `got "${badProbe}"`);

    // 2. rotate with a VALID candidate → validate-before-store stores it.
    const store = memoryStore({ clientId: "old", clientSecret: "old-secret" });
    const rotated = await applyCredentialLifecycle(
      "rotate",
      {
        organisationId: realm,
        realmName: realm,
        clientId: good.clientId,
        clientSecret: good.clientSecret,
        actorId: "proof-system-admin",
        actorRoles: ["system-admin"],
      },
      { audit: silentAudit, credentialStore: store, makeProbe: (c) => makeAdapter(c) }
    );
    check("rotate (valid) → configured", rotated.kind === "configured", `got "${rotated.kind}"`);
    check(
      "rotated credential stored with validated metadata",
      store.sets.at(-1)?.lifecycle?.validated === true
    );

    // 3. rotate with an INVALID candidate → classified, existing credential PRESERVED.
    const beforeBad = store.current();
    const bad = await applyCredentialLifecycle(
      "rotate",
      {
        organisationId: realm,
        realmName: realm,
        clientId: CLIENT_ID,
        clientSecret: "definitely-wrong",
        actorId: "proof-system-admin",
        actorRoles: ["system-admin"],
      },
      { audit: silentAudit, credentialStore: store, makeProbe: (c) => makeAdapter(c) }
    );
    check("rotate (invalid) → not configured", bad.kind !== "configured", `got "${bad.kind}"`);
    check("existing credential PRESERVED after failed rotate", store.current() === beforeBad);

    // 4. use the rotated credential for a real MFA write + read-back, then restore.
    const adapter = makeAdapter(good);
    const original = await adapter.getMfaPolicy();
    try {
      await adapter.setMfaPolicy({ required: "required", type: "totp" });
      const after = await adapter.getMfaPolicy();
      check("rotated credential performs a real MFA write", after.required === "required");
    } finally {
      await adapter.setMfaPolicy({ required: original.required, type: original.type });
    }
  } finally {
    await deleteProofClient(token);
    console.log("\n  deleted the throwaway service account");
  }

  console.log(`\n# ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("credential lifecycle proof errored:", err instanceof Error ? err.message : err);
  process.exit(2);
});
