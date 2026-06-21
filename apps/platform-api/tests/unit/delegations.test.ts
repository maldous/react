// Unit tests: V1C-04 delegated-admin-roles usecase layer (ADR-0063 / V1C-04).
//
// Re-authored for node:test (the platform-api harness) — the prior vitest-based
// file could not run under `node --test`. Covers the documented stop condition:
//   grant/revoke proven + audited; fail-closed when caller lacks authority.
//
// Verifies, per method:
//   - deny-by-default (no audit, no mutation) for unauthorised callers
//   - server-side grantedBy stamping (client value ignored)
//   - audit-BEFORE-mutation ordering for grant (ADR-ACT-0154); a failing audit
//     port means the grant never lands
//   - duplicate-active short-circuit (no audit, no mutation)
//   - revoke audit-AFTER-mutation; not_found path emits no audit
//   - tenant-list authority + Delegation.Listed audit
//   - self-only grantee lookup for non-admins

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  makeDelegationsUseCases,
  type AuthContext,
  type DelegationsDeps,
} from "../../src/usecases/delegations.ts";
import type {
  DelegatedRole,
  DelegatedAdminRolesPort,
  GrantDelegationInput,
} from "../../src/ports/delegated-admin-roles.ts";

// Ordered event log shared by the fake port + audit so ordering is assertable.
type Trace = string[];

function record(input: GrantDelegationInput, id = "del-1"): DelegatedRole {
  return {
    id,
    organisationId: input.organisationId,
    granterUserId: input.granterUserId,
    granteeUserId: input.granteeUserId,
    scope: input.scope,
    grantedAt: "2026-01-01T00:00:00.000Z",
    grantedBy: input.grantedBy,
    expiresAt: input.expiresAt,
    revokedAt: null,
    revokedBy: null,
  };
}

interface Fakes {
  deps: DelegationsDeps;
  trace: Trace;
  grants: GrantDelegationInput[];
  audits: Array<{ action: string; actorId: string; organisationId: string | null }>;
}

function build(
  opts: {
    existingActive?: DelegatedRole | null;
    revokeReturns?: boolean;
    tenantRows?: DelegatedRole[];
    granteeRows?: DelegatedRole[];
    auditThrows?: boolean;
  } = {}
): Fakes {
  const trace: Trace = [];
  const grants: GrantDelegationInput[] = [];
  const audits: Fakes["audits"] = [];

  const port: DelegatedAdminRolesPort = {
    async grantDelegation(input) {
      trace.push("port.grant");
      grants.push(input);
      return record(input);
    },
    async revokeDelegation() {
      trace.push("port.revoke");
      return opts.revokeReturns ?? true;
    },
    async listForTenant() {
      trace.push("port.listForTenant");
      return opts.tenantRows ?? [];
    },
    async listActiveForGrantee() {
      trace.push("port.listActiveForGrantee");
      return opts.granteeRows ?? [];
    },
    async findActiveForGranteeAndScope() {
      trace.push("port.findActive");
      return opts.existingActive ?? null;
    },
  };

  const deps: DelegationsDeps = {
    port,
    audit: {
      async emit(e) {
        if (opts.auditThrows) throw new Error("audit storage unavailable");
        trace.push(`audit.${e.action}`);
        audits.push({ action: e.action, actorId: e.actorId, organisationId: e.organisationId });
      },
    },
    logger: {
      async warn(w) {
        trace.push(`log.${w.event}`);
      },
    },
  };
  return { deps, trace, grants, audits };
}

const sysAdmin: AuthContext = { systemAdmin: true, tenantAdmin: false, userId: "op-1" };
const tenantAdmin: AuthContext = { systemAdmin: false, tenantAdmin: true, userId: "ta-1" };
const member: AuthContext = { systemAdmin: false, tenantAdmin: false, userId: "user-1" };

const grantInput = (over: Partial<GrantDelegationInput> = {}): GrantDelegationInput => ({
  organisationId: "11111111-1111-4111-8111-111111111111",
  granterUserId: "op-1",
  granteeUserId: "grantee-1",
  grantedBy: "CLIENT-SUPPLIED-IGNORE-ME",
  scope: "tenant.members.manage",
  expiresAt: null,
  ...over,
});

describe("delegations usecase (V1C-04) — grant", () => {
  it("denies a non-admin: no audit, no mutation (fail-closed)", async () => {
    const f = build();
    const r = await makeDelegationsUseCases(f.deps).delegateGrant(grantInput(), member);
    assert.equal(r.kind, "static_permission_denied");
    assert.equal(f.grants.length, 0);
    assert.equal(f.audits.length, 0);
    assert.deepEqual(f.trace, ["log.delegate_grant.denied"]);
  });

  it("happy path: audit BEFORE the port write, and grantedBy is server-stamped", async () => {
    const f = build();
    const r = await makeDelegationsUseCases(f.deps).delegateGrant(grantInput(), sysAdmin);
    assert.equal(r.kind, "ok");
    // ordering: findActive (precondition) → audit → port.grant
    assert.deepEqual(f.trace, ["port.findActive", "audit.Delegation.Granted", "port.grant"]);
    assert.equal(
      f.grants[0]!.grantedBy,
      "op-1",
      "client grantedBy must be overwritten with ctx.userId"
    );
  });

  it("duplicate active grant short-circuits: no audit, no mutation", async () => {
    const f = build({ existingActive: record(grantInput()) });
    const r = await makeDelegationsUseCases(f.deps).delegateGrant(grantInput(), sysAdmin);
    assert.equal(r.kind, "delegation_already_active");
    assert.equal(f.audits.length, 0);
    assert.equal(f.grants.length, 0);
    assert.deepEqual(f.trace, ["port.findActive"]);
  });

  it("audit-before-mutation: a failing audit port means the grant never lands", async () => {
    const f = build({ auditThrows: true });
    await assert.rejects(
      () => makeDelegationsUseCases(f.deps).delegateGrant(grantInput(), sysAdmin),
      /audit storage unavailable/
    );
    assert.equal(f.grants.length, 0, "port.grant must not run after audit failure");
  });

  it("tenant-admin may grant", async () => {
    const f = build();
    const r = await makeDelegationsUseCases(f.deps).delegateGrant(grantInput(), tenantAdmin);
    assert.equal(r.kind, "ok");
  });
});

describe("delegations usecase (V1C-04) — revoke", () => {
  it("denies a non-system-admin (Turn 2 scope): no audit", async () => {
    const f = build();
    const r = await makeDelegationsUseCases(f.deps).delegateRevoke("del-1", tenantAdmin);
    assert.equal(r.kind, "static_permission_denied");
    assert.equal(f.audits.length, 0);
  });

  it("ok path: audit AFTER the revoke mutation", async () => {
    const f = build({ revokeReturns: true });
    const r = await makeDelegationsUseCases(f.deps).delegateRevoke("del-1", sysAdmin);
    assert.equal(r.kind, "ok");
    assert.deepEqual(f.trace, ["port.revoke", "audit.Delegation.Revoked"]);
  });

  it("not_found (already revoked / unknown id): no audit line", async () => {
    const f = build({ revokeReturns: false });
    const r = await makeDelegationsUseCases(f.deps).delegateRevoke("nope", sysAdmin);
    assert.equal(r.kind, "not_found");
    assert.deepEqual(f.trace, ["port.revoke"]);
  });
});

describe("delegations usecase (V1C-04) — list", () => {
  it("listForTenant denies non-admin and audits on the authorised path", async () => {
    const denied = build();
    const r1 = await makeDelegationsUseCases(denied.deps).listDelegationsForTenant("org", member);
    assert.equal(r1.kind, "static_permission_denied");
    assert.equal(denied.audits.length, 0);

    const ok = build({ tenantRows: [record(grantInput())] });
    const r2 = await makeDelegationsUseCases(ok.deps).listDelegationsForTenant("org", sysAdmin);
    assert.equal(r2.kind, "ok");
    assert.equal(ok.audits[0]!.action, "Delegation.Listed");
  });

  it("listActiveForGrantee: a member may see only their own scopes", async () => {
    const own = build({ granteeRows: [record(grantInput())] });
    const r1 = await makeDelegationsUseCases(own.deps).listActiveDelegationsForGrantee(
      "user-1",
      member
    );
    assert.equal(r1.kind, "ok");

    const other = build();
    const r2 = await makeDelegationsUseCases(other.deps).listActiveDelegationsForGrantee(
      "someone-else",
      member
    );
    assert.equal(r2.kind, "static_permission_denied");
    // hot-path lookup never audits
    assert.equal(own.audits.length, 0);
  });
});
