import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { type AuditEvent, type AuditEventPort } from "@platform/audit-events";
import {
  authenticateApiKey,
  createApiKey,
  listApiKeys,
  revokeApiKey,
} from "../../src/usecases/api-keys.ts";
import {
  generateApiKey,
  prefixForSecret,
  verifyApiKey,
} from "../../src/usecases/api-key-crypto.ts";
import type {
  ApiKeyRecord,
  ApiKeyRepository,
  ApiKeyVerificationRow,
  CreateApiKeyRecordInput,
} from "../../src/ports/api-key-repository.ts";
import type {
  EntitlementGrantRecord,
  EntitlementRepository,
} from "../../src/ports/entitlement-repository.ts";

const ORG = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
const ACTOR = { actorId: "user-1", actorRoles: ["tenant-admin"] };

function fakeEntitlements(grantedOrgs: Set<string>): EntitlementRepository {
  const rec = (org: string): EntitlementGrantRecord => ({
    organisationId: org,
    entitlementKey: "api_access",
    state: "granted",
    source: "system",
    metadata: {},
    updatedAt: null,
    updatedBy: null,
  });
  return {
    listForTenant: async () => [],
    listForTenantAsOperator: async () => [],
    getGrant: async (org) => (grantedOrgs.has(org) ? rec(org) : null),
    upsert: async () => rec(ORG),
  };
}

// In-memory api-key store that mirrors the Postgres adapter's contract, including
// storing ONLY the hash + salt (never the plaintext) and tenant-scoped reads.
function fakeApiKeys(): ApiKeyRepository & { _rows: (ApiKeyVerificationRow & ApiKeyRecord)[] } {
  const rows: (ApiKeyVerificationRow & ApiKeyRecord)[] = [];
  let n = 0;
  return {
    _rows: rows,
    create: async (i: CreateApiKeyRecordInput) => {
      const id = `key-${++n}-0000-0000-0000-000000000000`;
      const row = {
        id,
        organisationId: i.organisationId,
        name: i.name,
        keyPrefix: i.keyPrefix,
        keyHash: i.keyHash,
        keySalt: i.keySalt,
        scopes: i.scopes,
        createdAt: new Date(0).toISOString(),
        createdBy: i.createdBy,
        lastUsedAt: null,
        expiresAt: i.expiresAt ?? null,
        revokedAt: null,
      };
      rows.push(row);
      const { keyHash: _h, keySalt: _s, ...rec } = row;
      return rec as ApiKeyRecord;
    },
    listForTenant: async (org) =>
      rows
        .filter((r) => r.organisationId === org)
        .map(({ keyHash: _h, keySalt: _s, ...rec }) => rec),
    listForTenantAsOperator: async (org) =>
      rows
        .filter((r) => r.organisationId === org)
        .map(({ keyHash: _h, keySalt: _s, ...rec }) => rec),
    revokeForTenant: async (org, keyId) => {
      const row = rows.find((r) => r.organisationId === org && r.id === keyId && !r.revokedAt);
      if (!row) return false;
      row.revokedAt = new Date(0).toISOString();
      return true;
    },
    findVerificationByPrefix: async (prefix) => {
      const row = rows.find((r) => r.keyPrefix === prefix);
      return row
        ? {
            id: row.id,
            organisationId: row.organisationId,
            keyHash: row.keyHash,
            keySalt: row.keySalt,
            scopes: row.scopes,
            revokedAt: row.revokedAt,
            expiresAt: row.expiresAt,
          }
        : null;
    },
    touchLastUsed: async () => {},
  };
}

function capturingAudit(): { port: AuditEventPort; events: AuditEvent[]; fail: () => void } {
  const events: AuditEvent[] = [];
  let f = false;
  return {
    events,
    fail: () => (f = true),
    port: {
      emit: async (e) => {
        if (f) throw new Error("audit down");
        events.push(e);
      },
      query: async () => events,
    },
  };
}

describe("api-key crypto", () => {
  it("generates a sk_-prefixed secret, derivable pk_ handle, and verifies", () => {
    const k = generateApiKey();
    assert.ok(k.secret.startsWith("sk_"));
    assert.ok(k.keyPrefix.startsWith("pk_"));
    assert.equal(prefixForSecret(k.secret), k.keyPrefix);
    assert.ok(verifyApiKey(k.secret, k.keySalt, k.keyHash));
  });

  it("the stored hash cannot authenticate as the plaintext secret", () => {
    const k = generateApiKey();
    // Presenting the hash (or anything but the secret) must not verify.
    assert.equal(verifyApiKey(k.keyHash, k.keySalt, k.keyHash), false);
    assert.equal(verifyApiKey("sk_wrong", k.keySalt, k.keyHash), false);
  });
});

describe("api-keys usecase", () => {
  it("denies key creation when the tenant lacks api_access entitlement", async () => {
    const deps = {
      apiKeys: fakeApiKeys(),
      entitlements: fakeEntitlements(new Set()),
      audit: capturingAudit().port,
    };
    const r = await createApiKey({ organisationId: ORG, name: "k", actor: ACTOR }, deps);
    assert.equal(r.kind, "not_entitled");
  });

  it("returns the plaintext secret exactly once and stores only a hash", async () => {
    const apiKeys = fakeApiKeys();
    const deps = {
      apiKeys,
      entitlements: fakeEntitlements(new Set([ORG])),
      audit: capturingAudit().port,
    };
    const r = await createApiKey({ organisationId: ORG, name: "ci", actor: ACTOR }, deps);
    assert.equal(r.kind, "ok");
    if (r.kind !== "ok") return;
    assert.ok(r.response.secret.startsWith("sk_"));
    assert.equal(r.response.secretShownOnce, true);
    // The list response never carries the secret or the hash.
    const list = await listApiKeys(ORG, deps);
    assert.equal(list.apiKeys.length, 1);
    assert.equal(JSON.stringify(list.apiKeys).includes(r.response.secret), false);
    assert.equal("secret" in (list.apiKeys[0] as object), false);
  });

  it("audit-before-change: a failing audit aborts key creation", async () => {
    const apiKeys = fakeApiKeys();
    const audit = capturingAudit();
    audit.fail();
    const deps = { apiKeys, entitlements: fakeEntitlements(new Set([ORG])), audit: audit.port };
    await assert.rejects(createApiKey({ organisationId: ORG, name: "x", actor: ACTOR }, deps));
    assert.equal(apiKeys._rows.length, 0);
  });

  it("authenticates a valid secret, denies a revoked key, and is tenant-scoped", async () => {
    const apiKeys = fakeApiKeys();
    const deps = {
      apiKeys,
      entitlements: fakeEntitlements(new Set([ORG, ORG_B])),
      audit: capturingAudit().port,
    };
    const created = await createApiKey({ organisationId: ORG, name: "k", actor: ACTOR }, deps);
    assert.equal(created.kind, "ok");
    if (created.kind !== "ok") return;
    const secret = created.response.secret;

    const auth = await authenticateApiKey(secret, deps);
    assert.equal(auth?.organisationId, ORG);

    // tenant scoping: ORG_B cannot see ORG's key in its own list
    assert.equal((await listApiKeys(ORG_B, deps)).apiKeys.length, 0);

    // revoke → authentication denied
    const rev = await revokeApiKey(
      { organisationId: ORG, keyId: created.response.apiKey.id, actor: ACTOR },
      deps
    );
    assert.equal(rev.kind, "ok");
    assert.equal(await authenticateApiKey(secret, deps), null);
  });

  it("a wrong/garbage secret never authenticates", async () => {
    const deps = {
      apiKeys: fakeApiKeys(),
      entitlements: fakeEntitlements(new Set([ORG])),
      audit: capturingAudit().port,
    };
    assert.equal(await authenticateApiKey("not-a-key", deps), null);
    assert.equal(await authenticateApiKey("sk_deadbeefdeadbeef", deps), null);
  });
});
