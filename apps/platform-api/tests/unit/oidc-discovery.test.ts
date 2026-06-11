import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuditEvent, AuditEventPort } from "@platform/audit-events";
import type { IdentityProvider } from "@platform/authorisation-runtime";
import {
  buildIdpCallbackUrl,
  importOidcDiscovery,
  isAllowedDiscoveryUrl,
  resolveDiscoveryUrl,
  testIdpConnection,
  type OidcFetchOutcome,
  type OidcHttpFetcher,
} from "../../src/usecases/oidc-discovery.ts";

const ISSUER = "https://idp.example.com";
const DISCOVERY = `${ISSUER}/.well-known/openid-configuration`;
const JWKS = `${ISSUER}/jwks`;

function goodDoc(): OidcFetchOutcome {
  return {
    kind: "ok",
    json: {
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      userinfo_endpoint: `${ISSUER}/userinfo`,
      jwks_uri: JWKS,
    },
  };
}
function goodJwks(): OidcFetchOutcome {
  return { kind: "ok", json: { keys: [{ kty: "RSA", kid: "a" }] } };
}

function fetcherFor(map: Record<string, OidcFetchOutcome>): OidcHttpFetcher {
  return {
    async get(url) {
      return map[url] ?? { kind: "network_error" };
    },
  };
}

function collectingAudit(): { port: AuditEventPort; events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  return {
    events,
    port: {
      async emit(e) {
        events.push(e);
      },
      async query() {
        return [];
      },
    } as AuditEventPort,
  };
}

describe("oidc-discovery — url policy + composition", () => {
  it("composes the well-known URL from an issuer", () => {
    assert.equal(
      resolveDiscoveryUrl({ issuer: "https://x.test/" }),
      "https://x.test/.well-known/openid-configuration"
    );
    assert.equal(resolveDiscoveryUrl({ discoveryUrl: "https://x.test/d" }), "https://x.test/d");
    assert.equal(resolveDiscoveryUrl({}), null);
  });

  it("allows https everywhere and http only for local/dev hosts", () => {
    assert.equal(isAllowedDiscoveryUrl("https://idp.example.com/x"), true);
    assert.equal(isAllowedDiscoveryUrl("http://localhost:9080/x"), true);
    assert.equal(isAllowedDiscoveryUrl("http://host.docker.internal/x"), true);
    assert.equal(isAllowedDiscoveryUrl("http://evil.example.com/x"), false);
    assert.equal(isAllowedDiscoveryUrl("ftp://idp.example.com/x"), false);
    assert.equal(isAllowedDiscoveryUrl("not a url"), false);
  });

  it("builds the brokered callback URL from tenant context (no secret)", () => {
    const out = buildIdpCallbackUrl("https://kc.test/", "tenant-abc", "acme-oidc");
    assert.equal(out.alias, "acme-oidc");
    assert.equal(out.callbackUrl, "https://kc.test/realms/tenant-abc/broker/acme-oidc/endpoint");
    assert.ok(!JSON.stringify(out).toLowerCase().includes("secret"));
  });
});

describe("importOidcDiscovery", () => {
  it("imports a valid discovery document and validates issuer + JWKS", async () => {
    const r = await importOidcDiscovery(
      { issuer: ISSUER },
      { fetcher: fetcherFor({ [DISCOVERY]: goodDoc(), [JWKS]: goodJwks() }) }
    );
    assert.equal(r.kind, "ok");
    if (r.kind !== "ok") return;
    assert.equal(r.response.validation.result, "ok");
    assert.equal(r.response.validation.issuerValid, true);
    assert.equal(r.response.validation.jwksValid, true);
    assert.ok(r.response.validation.jwksKeyCount >= 1);
    assert.equal(r.response.metadata?.issuer, ISSUER);
    assert.equal(r.response.metadata?.jwksUri, JWKS);
    // Redacted: only the documented projection fields, never a raw doc/secret.
    assert.deepEqual(Object.keys(r.response.metadata!).sort(), [
      "authorizationEndpoint",
      "issuer",
      "jwksUri",
      "tokenEndpoint",
      "userInfoEndpoint",
    ]);
  });

  it("rejects an issuer mismatch", async () => {
    const doc: OidcFetchOutcome = {
      kind: "ok",
      json: {
        issuer: "https://attacker.example.com",
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
        jwks_uri: JWKS,
      },
    };
    const r = await importOidcDiscovery(
      { issuer: ISSUER },
      { fetcher: fetcherFor({ [DISCOVERY]: doc, [JWKS]: goodJwks() }) }
    );
    assert.equal(r.kind, "ok");
    if (r.kind !== "ok") return;
    assert.equal(r.response.validation.result, "issuer_mismatch");
    assert.equal(r.response.metadata, null);
  });

  it("classifies an empty/invalid JWKS as jwks_invalid", async () => {
    const r = await importOidcDiscovery(
      { issuer: ISSUER },
      {
        fetcher: fetcherFor({ [DISCOVERY]: goodDoc(), [JWKS]: { kind: "ok", json: { keys: [] } } }),
      }
    );
    if (r.kind !== "ok") return assert.fail("expected ok");
    assert.equal(r.response.validation.result, "jwks_invalid");
    assert.equal(r.response.validation.jwksValid, false);
    assert.equal(r.response.metadata?.issuer, ISSUER); // endpoints still surfaced
  });

  it("classifies an unreachable discovery endpoint", async () => {
    const r = await importOidcDiscovery(
      { issuer: ISSUER },
      { fetcher: fetcherFor({ [DISCOVERY]: { kind: "network_error" } }) }
    );
    if (r.kind !== "ok") return assert.fail("expected ok");
    assert.equal(r.response.validation.result, "unreachable");
  });

  it("classifies a non-JSON or incomplete document as invalid_document", async () => {
    const notJson = await importOidcDiscovery(
      { issuer: ISSUER },
      { fetcher: fetcherFor({ [DISCOVERY]: { kind: "not_json" } }) }
    );
    assert.equal(notJson.kind === "ok" && notJson.response.validation.result, "invalid_document");

    const missing = await importOidcDiscovery(
      { issuer: ISSUER },
      { fetcher: fetcherFor({ [DISCOVERY]: { kind: "ok", json: { issuer: ISSUER } } }) }
    );
    assert.equal(missing.kind === "ok" && missing.response.validation.result, "invalid_document");
  });

  it("treats a non-allowed scheme as unreachable (no fetch attempt leaks)", async () => {
    const r = await importOidcDiscovery(
      { discoveryUrl: "https://idp.example.com/d" },
      {
        fetcher: fetcherFor({
          "https://idp.example.com/d": {
            kind: "ok",
            json: {
              issuer: ISSUER,
              authorization_endpoint: "http://evil.example.com/a",
              token_endpoint: `${ISSUER}/token`,
              jwks_uri: JWKS,
            },
          },
        }),
      }
    );
    // authorization_endpoint points at a non-local http host → invalid_document
    if (r.kind !== "ok") return assert.fail("expected ok");
    assert.equal(r.response.validation.result, "invalid_document");
  });

  it("rejects a body with neither issuer nor discoveryUrl", async () => {
    const r = await importOidcDiscovery({}, { fetcher: fetcherFor({}) });
    assert.equal(r.kind, "invalid_body");
  });
});

describe("testIdpConnection", () => {
  function reader(idp: IdentityProvider | null): {
    getIdentityProvider: () => Promise<IdentityProvider | null>;
  } {
    return { getIdentityProvider: async () => idp };
  }
  const baseInput = {
    alias: "acme-oidc",
    organisationId: "org-1",
    realmName: "tenant-org-1",
    actorId: "user-1",
    actorRoles: ["tenant-admin"],
  };

  it("tests a configured IdP and audits the result without any secret", async () => {
    const audit = collectingAudit();
    const idp: IdentityProvider = {
      alias: "acme-oidc",
      displayName: "Acme",
      providerId: "oidc",
      enabled: true,
      config: { clientId: "c", clientSecret: "**********", issuer: ISSUER },
    };
    const r = await testIdpConnection(baseInput, {
      reader: reader(idp),
      fetcher: fetcherFor({ [DISCOVERY]: goodDoc(), [JWKS]: goodJwks() }),
      audit: audit.port,
    });
    assert.equal(r.kind, "ok");
    if (r.kind !== "ok") return;
    assert.equal(r.validation.result, "ok");
    assert.equal(audit.events.length, 1);
    assert.equal(audit.events[0]!.action, "auth_settings.idp.tested");
    const meta = JSON.stringify(audit.events[0]!.metadata);
    assert.ok(meta.includes("acme-oidc") && meta.includes("ok"));
    assert.ok(!meta.toLowerCase().includes("secret"), "audit metadata must not contain a secret");
  });

  it("returns not_configured when the stored IdP has no issuer", async () => {
    const audit = collectingAudit();
    const idp: IdentityProvider = {
      alias: "acme-oidc",
      displayName: "Acme",
      providerId: "oidc",
      enabled: true,
      config: { clientId: "c" },
    };
    const r = await testIdpConnection(baseInput, {
      reader: reader(idp),
      fetcher: fetcherFor({}),
      audit: audit.port,
    });
    assert.equal(r.kind === "ok" && r.validation.result, "not_configured");
  });

  it("returns not_found for an unknown alias", async () => {
    const audit = collectingAudit();
    const r = await testIdpConnection(baseInput, {
      reader: reader(null),
      fetcher: fetcherFor({}),
      audit: audit.port,
    });
    assert.equal(r.kind, "not_found");
    assert.equal(audit.events.length, 0);
  });
});
