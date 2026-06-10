/**
 * Runtime Keycloak broker seed for the mock identity providers (ADR-ACT-0157).
 *
 * Registers/updates mock-google, mock-azure and mock-apple as OIDC identity
 * providers on the platform realm, pointed at the mock-oidc fixture. This is the
 * primary dev/test wiring — it does NOT require `terraform apply`. It is
 * idempotent (upsert) and safe to re-run.
 *
 * Run via:  npm run seed:idps   (uses the platform-api loader for @platform/*)
 *
 * Auth: uses the Keycloak master `admin` user via the public `admin-cli` client
 * (password grant) so no pre-provisioned service-account client is required.
 */
import process from "node:process";
import { KeycloakRealmAdminAdapter } from "@platform/adapters-keycloak";
import {
  buildMockIdpDefinitions,
  getMockOidcSettings,
  getProviderMode,
  isProdLikeEnv,
  mockAllowedHere,
} from "../src/server/auth-providers.ts";

function log(
  level: "info" | "warn" | "error",
  message: string,
  fields: Record<string, unknown> = {}
) {
  process.stdout.write(
    JSON.stringify({
      ts: new Date().toISOString(),
      level,
      service: "seed-idps",
      message,
      ...fields,
    }) + "\n"
  );
}

const KC_URL = (process.env["KEYCLOAK_URL"] ?? "http://localhost:8090/kc").replace(/\/+$/, "");
const REALM = process.env["KEYCLOAK_REALM"] ?? "platform";
const ADMIN_USER = process.env["KEYCLOAK_ADMIN_USER"] ?? "admin";
const ADMIN_PASSWORD = process.env["KEYCLOAK_ADMIN_PASSWORD"] ?? "admin";
const BFF_CLIENT_ID = process.env["KEYCLOAK_CLIENT_ID"] ?? "platform-api";
// Claim/attribute carrying the UPSTREAM email_verified (see mapKeycloakClaims).
const UPSTREAM_ATTR = "email_verified_upstream";

async function adminToken(): Promise<string> {
  const res = await fetch(`${KC_URL}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: "admin-cli",
      username: ADMIN_USER,
      password: ADMIN_PASSWORD,
    }),
  });
  if (!res.ok) throw new Error(`admin token failed: ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

/**
 * IdP attribute-importer mapper: import the upstream `email_verified` claim into a
 * user attribute (FORCE = refreshed on every login). Keycloak's own email_verified
 * is governed by the IdP trustEmail flag and cannot carry a per-token false; this
 * preserves the upstream value so the BFF can reject unverified brokered logins.
 * Idempotent (keyed by mapper name). ADR-ACT-0157.
 */
async function ensureIdpEmailVerifiedMapper(token: string, alias: string): Promise<void> {
  const base = `${KC_URL}/admin/realms/${REALM}/identity-provider/instances/${alias}/mappers`;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const name = `upstream-${UPSTREAM_ATTR}`;
  const rep = {
    name,
    identityProviderAlias: alias,
    identityProviderMapper: "oidc-user-attribute-idp-mapper",
    config: { syncMode: "FORCE", claim: "email_verified", "user.attribute": UPSTREAM_ATTR },
  };
  const existing = (await (await fetch(base, { headers })).json()) as Array<{
    id: string;
    name: string;
  }>;
  const found = existing.find((m) => m.name === name);
  const res = found
    ? await fetch(`${base}/${found.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ ...rep, id: found.id }),
      })
    : await fetch(base, { method: "POST", headers, body: JSON.stringify(rep) });
  if (!res.ok && res.status !== 409) throw new Error(`idp mapper ${alias} failed: ${res.status}`);
}

/**
 * platform-api client protocol mapper: emit the user attribute as the
 * `email_verified_upstream` claim in id/access/userinfo so the BFF sees it.
 * Idempotent. ADR-ACT-0157.
 */
async function ensureClientEmailVerifiedMapper(token: string): Promise<void> {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const clients = (await (
    await fetch(
      `${KC_URL}/admin/realms/${REALM}/clients?clientId=${encodeURIComponent(BFF_CLIENT_ID)}`,
      { headers }
    )
  ).json()) as Array<{ id: string }>;
  const clientId = clients[0]?.id;
  if (!clientId) throw new Error(`client ${BFF_CLIENT_ID} not found`);
  const base = `${KC_URL}/admin/realms/${REALM}/clients/${clientId}/protocol-mappers/models`;
  const rep = {
    name: UPSTREAM_ATTR,
    protocol: "openid-connect",
    protocolMapper: "oidc-usermodel-attribute-mapper",
    config: {
      "user.attribute": UPSTREAM_ATTR,
      "claim.name": UPSTREAM_ATTR,
      "jsonType.label": "String",
      "id.token.claim": "true",
      "access.token.claim": "true",
      "userinfo.token.claim": "true",
    },
  };
  const existing = (await (await fetch(base, { headers })).json()) as Array<{
    id: string;
    name: string;
  }>;
  const found = existing.find((m) => m.name === UPSTREAM_ATTR);
  const res = found
    ? await fetch(`${base}/${found.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ ...rep, id: found.id }),
      })
    : await fetch(base, { method: "POST", headers, body: JSON.stringify(rep) });
  if (!res.ok && res.status !== 409) throw new Error(`client mapper failed: ${res.status}`);
}

async function waitForKeycloak(timeoutMs = 120_000): Promise<void> {
  const discovery = `${KC_URL}/realms/master/.well-known/openid-configuration`;
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      const res = await fetch(discovery);
      if (res.ok) {
        log("info", "keycloak ready", { discovery, attempt });
        return;
      }
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) {
      throw new Error(`Keycloak not ready after ${timeoutMs}ms at ${discovery}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function main(): Promise<void> {
  const mode = getProviderMode();

  // Safety: never seed mock IdPs into a prod-like realm unless explicitly allowed.
  if (isProdLikeEnv() && !mockAllowedHere()) {
    log("warn", "refusing to seed mock IdPs in a prod-like environment without the override", {
      mode,
      hint: "set ALLOW_MOCK_IDP_IN_PROD_UNTIL_REAL_PROVIDERS=true to allow a temporary bootstrap",
    });
    return;
  }
  if (mode === "real") {
    log(
      "warn",
      "AUTH_PROVIDER_MODE=real — skipping mock IdP seed (configure real providers instead)"
    );
    return;
  }
  if (mode === "disabled") {
    log("warn", "AUTH_PROVIDER_MODE=disabled — skipping mock IdP seed");
    return;
  }

  const settings = getMockOidcSettings();
  log("info", "seeding mock identity providers", {
    realm: REALM,
    publicUrl: settings.publicUrl,
    internalUrl: settings.internalUrl,
  });

  await waitForKeycloak();

  const adapter = new KeycloakRealmAdminAdapter({
    url: KC_URL,
    realm: REALM,
    adminClientId: "admin-cli",
    adminClientSecret: "",
    adminUsername: ADMIN_USER,
    adminPassword: ADMIN_PASSWORD,
  });

  const existing = new Set((await adapter.listIdentityProviders()).map((p) => p.alias));
  const defs = buildMockIdpDefinitions(settings);

  for (const def of defs) {
    await adapter.upsertIdentityProvider(def);
    log(
      "info",
      existing.has(def.alias) ? "updated identity provider" : "created identity provider",
      {
        alias: def.alias,
        authorizationUrl: def.config["authorizationUrl"],
        tokenUrl: def.config["tokenUrl"],
      }
    );
  }

  // Surface the upstream email_verified so the BFF rejects unverified brokered
  // logins (Keycloak trustEmail=true would otherwise mask them). ADR-ACT-0157.
  const token = await adminToken();
  for (const def of defs) {
    await ensureIdpEmailVerifiedMapper(token, def.alias);
  }
  await ensureClientEmailVerifiedMapper(token);
  log("info", "upstream email_verified mappers ensured", {
    attribute: UPSTREAM_ATTR,
    client: BFF_CLIENT_ID,
    aliases: defs.map((d) => d.alias),
  });

  log("info", "mock identity provider seed complete", { aliases: defs.map((d) => d.alias) });
}

main().catch((err: unknown) => {
  const error = err instanceof Error ? err : new Error(String(err));
  log("error", "mock IdP seed failed", { error: error.message });
  process.exit(1);
});
