/**
 * Unit tests for ADR-ACT-0188: vanity domain DNS proof-of-ownership, and
 * ADR-ACT-0236: explicit cross-tenant domain-claim conflicts.
 * Pure — no real DNS or DB. Injected DnsResolverPort + TenantDomainRegistryPort.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AuditAction, type AuditEventPort, type AuditEvent } from "@platform/audit-events";
import {
  createDomainChallenge,
  verifyDomainChallenge,
} from "../../src/usecases/vanity-domain-challenge.ts";
import type {
  EnsurePendingResult,
  TenantDomainRecord,
  TenantDomainRegistryPort,
} from "../../src/ports/tenant-domain-registry.ts";

const ORG_ID = "a1b2c3d4-e5f6-4000-8000-000000000001";
const ACTOR_ID = "a1b2c3d4-e5f6-4000-8000-000000000002";

function makeAudit(fail = false): AuditEventPort & { events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  return {
    events,
    async emit(e) {
      if (fail) throw new Error("audit fail");
      events.push(e);
    },
    async query() {
      return [];
    },
  };
}

type ChallengeRow = {
  id: string;
  token: string;
  expires_at: Date;
  verified_at: Date | null;
} | null;

function makePool(challengeRow: ChallengeRow = null) {
  const calls: { text: string; values?: unknown[] }[] = [];
  return {
    calls,
    pool: {
      async query(text: string, values?: unknown[]) {
        calls.push({ text, values });
        if (text.toLowerCase().includes("select id, token, expires_at, verified_at")) {
          if (!challengeRow) return { rows: [], rowCount: 0 };
          return { rows: [challengeRow], rowCount: 1 };
        }
        // tenant_domains lifecycle insert (default Postgres registry): the
        // happy path is "created" — conflict tests inject a fake registry.
        if (text.toLowerCase().includes("insert into public.tenant_domains")) {
          return { rows: [{ organisation_id: values?.[0] }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    } as never,
  };
}

describe("createDomainChallenge", () => {
  it("IP literal → invalid_domain, no audit", async () => {
    const audit = makeAudit();
    const { pool } = makePool();
    const result = await createDomainChallenge(
      {
        domain: "1.2.3.4",
        organisationId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ["tenant-admin"],
      },
      { audit, pool }
    );
    assert.equal(result.kind, "invalid_domain");
    assert.equal(audit.events.length, 0);
  });

  it("missing TLD → invalid_domain", async () => {
    const audit = makeAudit();
    const { pool } = makePool();
    const result = await createDomainChallenge(
      {
        domain: "localhost",
        organisationId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ["tenant-admin"],
      },
      { audit, pool }
    );
    assert.equal(result.kind, "invalid_domain");
  });

  it("valid domain → ok, token generated, audit emitted", async () => {
    const audit = makeAudit();
    const { pool } = makePool();
    const result = await createDomainChallenge(
      {
        domain: "example.com",
        organisationId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ["tenant-admin"],
      },
      { audit, pool }
    );
    assert.equal(result.kind, "ok");
    assert.ok("token" in result && result.token.length > 0, "token must be generated");
    assert.ok(
      "txtRecord" in result && result.txtRecord === "_aldous-verify.example.com",
      "txtRecord must include domain"
    );
    assert.equal(audit.events[0]!.action, AuditAction.VanityDomainChallengeCreated);
  });

  it("domain is normalized to lowercase", async () => {
    const audit = makeAudit();
    const { pool, calls } = makePool();
    const result = await createDomainChallenge(
      {
        domain: "EXAMPLE.COM",
        organisationId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ["tenant-admin"],
      },
      { audit, pool }
    );
    assert.equal(result.kind, "ok");
    const insertCall = calls.find((c) =>
      c.text.toLowerCase().includes("insert into public.vanity_domain_challenges")
    );
    assert.ok(insertCall, "insert must be called");
    assert.ok(
      (insertCall?.values ?? []).some((v) => v === "example.com"),
      "domain must be lowercased in insert"
    );
  });
});

describe("verifyDomainChallenge", () => {
  it("no challenge → not_found", async () => {
    const audit = makeAudit();
    const { pool } = makePool(null);
    const result = await verifyDomainChallenge(
      {
        domain: "example.com",
        organisationId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ["tenant-admin"],
      },
      {
        audit,
        pool,
        dns: {
          async resolveTxt() {
            return [];
          },
        },
      }
    );
    assert.equal(result.kind, "not_found");
  });

  it("expired challenge → expired", async () => {
    const audit = makeAudit();
    const { pool } = makePool({
      id: "ch-1",
      token: "tok",
      expires_at: new Date(0),
      verified_at: null,
    });
    const result = await verifyDomainChallenge(
      {
        domain: "example.com",
        organisationId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ["tenant-admin"],
      },
      {
        audit,
        pool,
        dns: {
          async resolveTxt() {
            return [];
          },
        },
      }
    );
    assert.equal(result.kind, "expired");
  });

  it("DNS returns no records → dns_not_found", async () => {
    const audit = makeAudit();
    const { pool } = makePool({
      id: "ch-1",
      token: "abc123",
      expires_at: new Date(Date.now() + 86400000),
      verified_at: null,
    });
    const result = await verifyDomainChallenge(
      {
        domain: "example.com",
        organisationId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ["tenant-admin"],
      },
      {
        audit,
        pool,
        dns: {
          async resolveTxt() {
            return [];
          },
        },
      }
    );
    assert.equal(result.kind, "dns_not_found");
  });

  it("DNS has wrong token → dns_mismatch", async () => {
    const audit = makeAudit();
    const { pool } = makePool({
      id: "ch-1",
      token: "correct-token",
      expires_at: new Date(Date.now() + 86400000),
      verified_at: null,
    });
    const result = await verifyDomainChallenge(
      {
        domain: "example.com",
        organisationId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ["tenant-admin"],
      },
      {
        audit,
        pool,
        dns: {
          async resolveTxt() {
            return [["wrong-token"]];
          },
        },
      }
    );
    assert.equal(result.kind, "dns_mismatch");
  });

  it("correct DNS token → ok, VanityDomainVerified audit emitted", async () => {
    const audit = makeAudit();
    const { pool } = makePool({
      id: "ch-1",
      token: "abc123",
      expires_at: new Date(Date.now() + 86400000),
      verified_at: null,
    });
    const result = await verifyDomainChallenge(
      {
        domain: "example.com",
        organisationId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ["tenant-admin"],
      },
      {
        audit,
        pool,
        dns: {
          async resolveTxt() {
            return [["abc123"]];
          },
        },
      }
    );
    assert.equal(result.kind, "ok");
    assert.equal(audit.events[0]!.action, AuditAction.VanityDomainVerified);
  });

  it("cross-tenant: pool filters by org_id so another org's challenge returns not_found", async () => {
    const audit = makeAudit();
    // pool returns empty (different org would not match the WHERE clause)
    const { pool } = makePool(null);
    const result = await verifyDomainChallenge(
      {
        domain: "example.com",
        organisationId: "different-org-uuid",
        actorId: ACTOR_ID,
        actorRoles: ["tenant-admin"],
      },
      {
        audit,
        pool,
        dns: {
          async resolveTxt() {
            return [["abc123"]];
          },
        },
      }
    );
    assert.equal(result.kind, "not_found");
  });
});

// ---------------------------------------------------------------------------
// ADR-ACT-0236 — explicit cross-tenant claim conflicts. A fake registry drives
// the ensurePending classification; the usecase must refuse BEFORE issuing a
// token (create) and BEFORE any DNS lookup (verify).
// ---------------------------------------------------------------------------

function makeRegistry(ensure: EnsurePendingResult["kind"]) {
  const calls: string[] = [];
  const ownershipMarks: { org: string; domain: string; status: string }[] = [];
  const registry: TenantDomainRegistryPort & {
    calls: string[];
    ownershipMarks: typeof ownershipMarks;
  } = {
    calls,
    ownershipMarks,
    async listDomains() {
      return [];
    },
    async getDomain() {
      return null as TenantDomainRecord | null;
    },
    async ensurePending() {
      calls.push("ensurePending");
      return { kind: ensure };
    },
    async markOwnership(org, domain, status) {
      ownershipMarks.push({ org, domain, status });
    },
    async markAuthClientActive() {},
    async markAuthClientInactive() {},
    async markRoutingLocalActive() {},
    async setCanonical() {},
    async unsetCanonical() {},
    async disable() {},
  };
  return registry;
}

describe("cross-tenant domain-claim conflicts (ADR-ACT-0236)", () => {
  const input = {
    domain: "claimed.example.com",
    organisationId: ORG_ID,
    actorId: ACTOR_ID,
    actorRoles: ["tenant-admin"],
  };

  it("create: a domain enabled for ANOTHER tenant is rejected with NO token issued", async () => {
    const audit = makeAudit();
    const { pool, calls } = makePool();
    const registry = makeRegistry("conflict_other_tenant");
    const result = await createDomainChallenge(input, { audit, pool, registry });

    assert.equal(result.kind, "domain_already_claimed");
    assert.ok(!("token" in result), "no token may be issued on conflict");
    // No challenge row is written — the rejection happens before any insert.
    assert.ok(
      !calls.some((c) =>
        c.text.toLowerCase().includes("insert into public.vanity_domain_challenges")
      ),
      "no challenge insert on conflict"
    );
    // The rejection is audited with SAFE metadata (domain + reason; no token,
    // no owning-tenant identity).
    assert.equal(audit.events[0]!.action, "tenant_domains.challenge.rejected_conflict");
    const meta = JSON.stringify(audit.events[0]!.metadata);
    assert.ok(!/token/i.test(meta), "no token in audit metadata");
  });

  it("create: a SAME-tenant re-challenge is allowed (existing row, never downgraded)", async () => {
    const audit = makeAudit();
    const { pool } = makePool();
    const registry = makeRegistry("existing_same_tenant");
    const result = await createDomainChallenge(input, { audit, pool, registry });
    assert.equal(result.kind, "ok");
    assert.ok("token" in result && result.token.length > 0);
    assert.equal(audit.events[0]!.action, AuditAction.VanityDomainChallengeCreated);
  });

  it("verify: a domain enabled for ANOTHER tenant is refused BEFORE any DNS lookup", async () => {
    const audit = makeAudit();
    const { pool } = makePool({
      id: "ch-1",
      token: "abc123",
      expires_at: new Date(Date.now() + 86400000),
      verified_at: null,
    });
    const registry = makeRegistry("conflict_other_tenant");
    let dnsCalled = false;
    const result = await verifyDomainChallenge(input, {
      audit,
      pool,
      registry,
      dns: {
        async resolveTxt() {
          dnsCalled = true;
          return [["abc123"]];
        },
      },
    });
    assert.equal(result.kind, "domain_already_claimed");
    assert.equal(dnsCalled, false, "DNS must not be resolved for a conflicted domain");
    // Never marked verified for this tenant.
    assert.equal(registry.ownershipMarks.length, 0);
    assert.equal(audit.events[0]!.action, "tenant_domains.challenge.rejected_conflict");
  });

  it("verify: ok requires this tenant's lifecycle row — markOwnership only fires on success", async () => {
    const audit = makeAudit();
    const { pool } = makePool({
      id: "ch-1",
      token: "abc123",
      expires_at: new Date(Date.now() + 86400000),
      verified_at: null,
    });
    const registry = makeRegistry("existing_same_tenant");
    const result = await verifyDomainChallenge(input, {
      audit,
      pool,
      registry,
      dns: {
        async resolveTxt() {
          return [["abc123"]];
        },
      },
    });
    assert.equal(result.kind, "ok");
    assert.deepEqual(registry.ownershipMarks, [
      { org: ORG_ID, domain: "claimed.example.com", status: "verified" },
    ]);
  });
});
