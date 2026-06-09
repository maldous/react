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

  log("info", "mock identity provider seed complete", { aliases: defs.map((d) => d.alias) });
}

main().catch((err: unknown) => {
  const error = err instanceof Error ? err : new Error(String(err));
  log("error", "mock IdP seed failed", { error: error.message });
  process.exit(1);
});
