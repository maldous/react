/**
 * Unit tests for ADR-0041 / ADR-ACT-0209: per-tenant Auth Settings credential
 * readiness, write-error classification, and operator-seeded attach.
 *
 * Pure — no HTTP, no Keycloak, no DB. The realm adapter is faked via `makeProbe`;
 * the write path is exercised through `mutateAuthSetting` with a throwing mutate.
 *
 * Coverage:
 *   A. getAuthSettingsReadiness — missing credential, and each probe → status map
 *   B. classifyRealmError — status/transport → write-error vocabulary, unknown rethrows
 *   C. mutateAuthSetting — realm failure classified into result kind (audit still recorded)
 *   D. attachAuthSettingsCredential — validates BEFORE storing, never audits the secret,
 *      rejects bad body / bad credential, stores on success
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import type { RealmReadinessProbe } from "@platform/authorisation-runtime";
import { AuditAction, type AuditEventPort, type AuditEvent } from "@platform/audit-events";
import {
  getAuthSettingsReadiness,
  attachAuthSettingsCredential,
  applyCredentialLifecycle,
  type ReadinessProbe,
} from "../../src/usecases/auth-settings-readiness.ts";
import { classifyRealmError } from "../../src/usecases/realm-error.ts";
import { mutateAuthSetting } from "../../src/usecases/auth-settings.ts";
import type { TenantAdminCredential } from "../../src/ports/tenant-credential-store.ts";

const ORG = "00000000-0000-0000-0000-000000000001";
const REALM = `tenant-${ORG}`;
const ACTOR = "user-system-admin";
const ROLES = ["system-admin"];

function auditPort(): AuditEventPort & { events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  return {
    events,
    async emit(event) {
      events.push(event);
    },
    async query() {
      return [];
    },
  };
}

function probeAdapter(result: RealmReadinessProbe): ReadinessProbe {
  return {
    async probeReadiness() {
      return result;
    },
  };
}

/** Records every credential set (with lifecycle) so isolation/no-store/metadata
 * assertions are possible. */
function credentialStore(initial: TenantAdminCredential | null) {
  const sets: Array<{
    orgId: string;
    credential: TenantAdminCredential;
    lifecycle?: { rotatedBy?: string; validated?: boolean };
  }> = [];
  return {
    sets,
    async getAuthSettingsCredential() {
      return initial;
    },
    async setAuthSettingsCredential(
      orgId: string,
      credential: TenantAdminCredential,
      lifecycle?: { rotatedBy?: string; validated?: boolean }
    ) {
      sets.push({ orgId, credential, lifecycle });
    },
    async getAuthSettingsCredentialMetadata() {
      return null;
    },
  };
}

// ---------------------------------------------------------------------------
// A. getAuthSettingsReadiness
// ---------------------------------------------------------------------------

describe("getAuthSettingsReadiness", () => {
  it("returns missing_credential and never probes when no credential is stored", async () => {
    let probed = false;
    const result = await getAuthSettingsReadiness(
      { organisationId: ORG, realmName: REALM },
      {
        credentialStore: credentialStore(null),
        makeProbe: () => ({
          async probeReadiness() {
            probed = true;
            return "ok";
          },
        }),
      }
    );
    assert.equal(result.status, "missing_credential");
    assert.equal(probed, false);
  });

  const cases: Array<[RealmReadinessProbe, string]> = [
    ["ok", "configured"],
    ["invalid_credential", "invalid_credential"],
    ["forbidden", "forbidden_realm_operation"],
    ["unreachable", "realm_unreachable"],
  ];
  for (const [probe, expected] of cases) {
    it(`maps probe ${probe} → ${expected}`, async () => {
      const result = await getAuthSettingsReadiness(
        { organisationId: ORG, realmName: REALM },
        {
          credentialStore: credentialStore({ clientId: "c", clientSecret: "s" }),
          makeProbe: () => probeAdapter(probe),
        }
      );
      assert.equal(result.status, expected);
    });
  }

  it("passes the resolved realm (not a body value) to the probe factory", async () => {
    let seenRealm = "";
    await getAuthSettingsReadiness(
      { organisationId: ORG, realmName: REALM },
      {
        credentialStore: credentialStore({ clientId: "c", clientSecret: "s" }),
        makeProbe: (_cred, realm) => {
          seenRealm = realm;
          return probeAdapter("ok");
        },
      }
    );
    assert.equal(seenRealm, REALM);
  });
});

// ---------------------------------------------------------------------------
// B. classifyRealmError
// ---------------------------------------------------------------------------

describe("classifyRealmError", () => {
  it("classifies token/admin failure statuses", () => {
    assert.equal(
      classifyRealmError(new Error("Keycloak admin token fetch failed: 401")),
      "invalid_credential"
    );
    assert.equal(
      classifyRealmError(new Error("Keycloak admin token fetch failed: 400")),
      "invalid_credential"
    );
    assert.equal(
      classifyRealmError(new Error("setSessionPolicy: Keycloak admin request failed: 403 {}")),
      "forbidden_realm_operation"
    );
    assert.equal(
      classifyRealmError(new Error("setMfaPolicy: Keycloak admin request failed: 503 {}")),
      "realm_unreachable"
    );
  });

  it("classifies transport errors as unreachable", () => {
    assert.equal(classifyRealmError(new TypeError("fetch failed")), "realm_unreachable");
    assert.equal(
      classifyRealmError(new Error("connect ECONNREFUSED 127.0.0.1:8080")),
      "realm_unreachable"
    );
  });

  it("returns unknown for unrecognised errors (so the route still 500s)", () => {
    assert.equal(classifyRealmError(new Error("something weird")), "unknown");
  });
});

// ---------------------------------------------------------------------------
// C. mutateAuthSetting — realm failure classification
// ---------------------------------------------------------------------------

describe("mutateAuthSetting — realm failure classification", () => {
  const schema = z.object({ value: z.string() });
  const base = {
    rawBody: { value: "x" },
    tenantCtx: { organisationId: ORG, realmName: REALM },
    actorId: ACTOR,
    actorRoles: ROLES,
    auditAction: "test.action",
    buildAuditMetadata: (b: { value: string }) => ({ value: b.value }),
    schema,
  };
  const creds = {
    async getAuthSettingsCredential() {
      return { clientId: "c", clientSecret: "s" };
    },
    async setAuthSettingsCredential() {},
  };

  it("returns invalid_credential when the realm rejects the credential (audit still emitted)", async () => {
    const audit = auditPort();
    const result = await mutateAuthSetting(
      {
        ...base,
        mutate: async () => {
          throw new Error("Keycloak admin token fetch failed: 401");
        },
      },
      { audit, credentialStore: creds }
    );
    assert.equal(result.kind, "invalid_credential");
    assert.equal(audit.events.length, 1); // attempt is audited before the failing write
  });

  it("classifies forbidden and unreachable, and rethrows unknown", async () => {
    const audit = auditPort();
    const forbidden = await mutateAuthSetting(
      {
        ...base,
        mutate: async () => {
          throw new Error("op: Keycloak admin request failed: 403 {}");
        },
      },
      { audit, credentialStore: creds }
    );
    assert.equal(forbidden.kind, "forbidden_realm_operation");

    const unreachable = await mutateAuthSetting(
      {
        ...base,
        mutate: async () => {
          throw new TypeError("fetch failed");
        },
      },
      { audit, credentialStore: creds }
    );
    assert.equal(unreachable.kind, "realm_unreachable");

    await assert.rejects(
      () =>
        mutateAuthSetting(
          {
            ...base,
            mutate: async () => {
              throw new Error("totally unexpected");
            },
          },
          { audit, credentialStore: creds }
        ),
      /totally unexpected/
    );
  });
});

// ---------------------------------------------------------------------------
// D. attachAuthSettingsCredential
// ---------------------------------------------------------------------------

describe("attachAuthSettingsCredential", () => {
  const valid = {
    organisationId: ORG,
    realmName: REALM,
    clientId: "svc-account",
    clientSecret: "super-secret-value",
    actorId: ACTOR,
    actorRoles: ROLES,
  };

  it("validates against the realm and stores on success, auditing the clientId only", async () => {
    const audit = auditPort();
    const store = credentialStore(null);
    const result = await attachAuthSettingsCredential(valid, {
      audit,
      credentialStore: store,
      makeProbe: () => probeAdapter("ok"),
    });
    assert.equal(result.kind, "configured");
    // stored
    assert.equal(store.sets.length, 1);
    assert.equal(store.sets[0].credential.clientSecret, "super-secret-value");
    // audited clientId, NEVER the secret
    assert.equal(audit.events.length, 1);
    const serialised = JSON.stringify(audit.events[0]);
    assert.ok(serialised.includes("svc-account"));
    assert.ok(!serialised.includes("super-secret-value"));
  });

  it("does NOT store and does NOT audit when the credential fails validation", async () => {
    const audit = auditPort();
    const store = credentialStore(null);
    const result = await attachAuthSettingsCredential(valid, {
      audit,
      credentialStore: store,
      makeProbe: () => probeAdapter("invalid_credential"),
    });
    assert.equal(result.kind, "invalid_credential");
    assert.equal(store.sets.length, 0);
    assert.equal(audit.events.length, 0);
  });

  it("maps forbidden/unreachable probes and never stores", async () => {
    const store = credentialStore(null);
    const forbidden = await attachAuthSettingsCredential(valid, {
      audit: auditPort(),
      credentialStore: store,
      makeProbe: () => probeAdapter("forbidden"),
    });
    assert.equal(forbidden.kind, "forbidden_realm_operation");
    const unreachable = await attachAuthSettingsCredential(valid, {
      audit: auditPort(),
      credentialStore: store,
      makeProbe: () => probeAdapter("unreachable"),
    });
    assert.equal(unreachable.kind, "realm_unreachable");
    assert.equal(store.sets.length, 0);
  });

  it("rejects an empty clientId/clientSecret without probing or storing", async () => {
    let probed = false;
    const store = credentialStore(null);
    const result = await attachAuthSettingsCredential(
      { ...valid, clientSecret: "   " },
      {
        audit: auditPort(),
        credentialStore: store,
        makeProbe: () => ({
          async probeReadiness() {
            probed = true;
            return "ok";
          },
        }),
      }
    );
    assert.equal(result.kind, "invalid_body");
    assert.equal(probed, false);
    assert.equal(store.sets.length, 0);
  });
});

// ---------------------------------------------------------------------------
// E. applyCredentialLifecycle (rotate / repair) — ADR-0044
// ---------------------------------------------------------------------------

describe("applyCredentialLifecycle", () => {
  const base = {
    organisationId: ORG,
    realmName: REALM,
    clientId: "svc-account",
    clientSecret: "rotate-secret-value",
    actorId: ACTOR,
    actorRoles: ROLES,
  };

  it("rotate validates then stores with lifecycle metadata; audits the rotate action (no secret)", async () => {
    const audit = auditPort();
    const store = credentialStore({ clientId: "old", clientSecret: "old-secret" });
    const result = await applyCredentialLifecycle("rotate", base, {
      audit,
      credentialStore: store,
      makeProbe: () => probeAdapter("ok"),
    });
    assert.equal(result.kind, "configured");
    // stored with validation + actor metadata
    assert.equal(store.sets.length, 1);
    assert.equal(store.sets[0].lifecycle?.validated, true);
    assert.equal(store.sets[0].lifecycle?.rotatedBy, ACTOR);
    // audited as a rotate, clientId only, never the secret
    assert.equal(audit.events.length, 1);
    assert.equal(audit.events[0].action, AuditAction.AuthSettingsCredentialRotated);
    const serialised = JSON.stringify(audit.events[0]);
    assert.ok(serialised.includes("svc-account"));
    assert.ok(!serialised.includes("rotate-secret-value"));
  });

  it("PRESERVES the existing credential when validation fails (no store, no audit)", async () => {
    const audit = auditPort();
    const store = credentialStore({ clientId: "old", clientSecret: "old-secret" });
    const result = await applyCredentialLifecycle("rotate", base, {
      audit,
      credentialStore: store,
      makeProbe: () => probeAdapter("invalid_credential"),
    });
    assert.equal(result.kind, "invalid_credential");
    assert.equal(store.sets.length, 0); // old credential untouched
    assert.equal(audit.events.length, 0);
  });

  it("repair uses the repaired audit action", async () => {
    const audit = auditPort();
    const store = credentialStore(null);
    await applyCredentialLifecycle("repair", base, {
      audit,
      credentialStore: store,
      makeProbe: () => probeAdapter("ok"),
    });
    assert.equal(audit.events[0]?.action, AuditAction.AuthSettingsCredentialRepaired);
  });

  it("maps forbidden / unreachable probes without storing", async () => {
    const store = credentialStore({ clientId: "old", clientSecret: "old-secret" });
    const forbidden = await applyCredentialLifecycle("rotate", base, {
      audit: auditPort(),
      credentialStore: store,
      makeProbe: () => probeAdapter("forbidden"),
    });
    assert.equal(forbidden.kind, "forbidden_realm_operation");
    const unreachable = await applyCredentialLifecycle("rotate", base, {
      audit: auditPort(),
      credentialStore: store,
      makeProbe: () => probeAdapter("unreachable"),
    });
    assert.equal(unreachable.kind, "realm_unreachable");
    assert.equal(store.sets.length, 0);
  });

  it("rejects an empty secret without probing or storing", async () => {
    let probed = false;
    const store = credentialStore(null);
    const result = await applyCredentialLifecycle(
      "rotate",
      { ...base, clientSecret: "   " },
      {
        audit: auditPort(),
        credentialStore: store,
        makeProbe: () => ({
          async probeReadiness() {
            probed = true;
            return "ok";
          },
        }),
      }
    );
    assert.equal(result.kind, "invalid_body");
    assert.equal(probed, false);
    assert.equal(store.sets.length, 0);
  });
});
