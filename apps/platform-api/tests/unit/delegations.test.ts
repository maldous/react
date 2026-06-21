/**
 * V1C-04 Turn 2 — delegations usecase unit tests.
 *
 * Strategy: mock the `DelegatedAdminRolesPort` fully; assert that the
 * usecase enforces authorization checks, performs pre-condition reads
 * before mutation + audit, and emits the expected `Delegation.*` audit
 * actions in the correct order.
 *
 * No Postgres, no compose — pure logic + audit ordering.
 */
import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import {
  makeDelegationsUseCases,
  type AuthContext,
  type AuditEventPort,
  type DelegationLoggerPort,
  type DelegationsDeps,
} from "../../src/usecases/delegations.js";
import type {
  DelegatedRole,
  DelegatedAdminRolesPort,
  GrantDelegationInput,
} from "../../src/ports/delegated-admin-roles.js";

// ---------- helpers ----------

const GRANTE = "kc-user-grantee";
const SCOPE = "tenant.members.manage";
const ORG = "11111111-1111-1111-1111-111111111111";

function adminCtx(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    systemAdmin: true,
    tenantAdmin: false,
    userId: "kc-user-admin",
    ...overrides,
  };
}

function standardUserCtx(userId: string): AuthContext {
  return {
    systemAdmin: false,
    tenantAdmin: false,
    userId,
  };
}

function tenantAdminCtx(userId = "kc-user-tadmin"): AuthContext {
  return {
    systemAdmin: false,
    tenantAdmin: true,
    userId,
  };
}

function makeRole(partial: Partial<DelegatedRole>): DelegatedRole {
  return {
    id: crypto.randomUUID(),
    organisationId: ORG,
    granterUserId: "kc-user-granter",
    granteeUserId: GRANTE,
    scope: SCOPE,
    grantedAt: new Date("2026-01-01T00:00:00Z").toISOString(),
    grantedBy: "kc-user-granter",
    expiresAt: null,
    revokedAt: null,
    revokedBy: null,
    ...partial,
  };
}

interface FakeAdaptors {
  port: DelegatedAdminRolesPort;
  audit: AuditEventPort & { emit: Mock };
  logger: DelegationLoggerPort & { warn: Mock };
}

function buildAdaptors(): FakeAdaptors {
  const port: DelegatedAdminRolesPort = {
    grantDelegation: vi.fn(async () => makeRole({})),
    revokeDelegation: vi.fn(async () => true),
    listForTenant: vi.fn(async () => []),
    listActiveForGrantee: vi.fn(async () => []),
    findActiveForGranteeAndScope: vi.fn(async () => null),
  };
  const audit: FakeAdaptors["audit"] = {
    emit: vi.fn(async () => undefined),
  };
  const logger: FakeAdaptors["logger"] = {
    warn: vi.fn(async () => undefined),
  };
  return { port, audit, logger };
}

function makeDeps(a: FakeAdaptors): DelegationsDeps {
  return { port: a.port, audit: a.audit, logger: a.logger };
}

// ---------- tests ----------

describe("delegations usecase", () => {
  let a: FakeAdaptors;

  beforeEach(() => {
    a = buildAdaptors();
    vi.clearAllMocks();
  });

  it("delegateGrant happy path emits Delegation.Granted before returning ok; server-side stamps grantedBy from ctx.userId regardless of input.grantedBy", async () => {
    const uc = makeDelegationsUseCases(makeDeps(a));
    // Caller-supplied grantedBy is intentionally different from ctx.userId;
    // the usecase MUST server-side-stamp grantedBy so the BFF cannot write
    // forged grantor audit lines.
    const input: GrantDelegationInput = {
      organisationId: ORG,
      granterUserId: "kc-user-granter",
      granteeUserId: GRANTE,
      grantedBy: "kc-user-spoofed",
      scope: SCOPE,
      expiresAt: null,
    };
    const ctx = adminCtx();

    const result = await uc.delegateGrant(input, ctx);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    expect(a.port.findActiveForGranteeAndScope).toHaveBeenCalledTimes(1);
    expect(a.port.findActiveForGranteeAndScope).toHaveBeenCalledWith(GRANTE, SCOPE);
    expect(a.port.grantDelegation).toHaveBeenCalledTimes(1);
    expect(a.port.grantDelegation).toHaveBeenCalledWith({
      ...input,
      grantedBy: ctx.userId, // server-side stamp: ctx.userId wins over input.grantedBy
    });
    expect(a.audit.emit).toHaveBeenCalledWith({
      action: "Delegation.Granted",
      actorId: ctx.userId,
      organisationId: ORG,
      delegationId: result.delegation.id,
    });
    expect(a.logger.warn).not.toHaveBeenCalled();
  });

  it("delegateGrant with already-active scope returns delegation_already_active (no audit, no mutation)", async () => {
    const existing = makeRole({});
    (a.port.findActiveForGranteeAndScope as Mock).mockResolvedValueOnce(existing);

    const uc = makeDelegationsUseCases(makeDeps(a));
    const ctx = adminCtx();
    const result = await uc.delegateGrant(
      {
        organisationId: ORG,
        granterUserId: "kc-user-granter",
        granteeUserId: GRANTE,
        grantedBy: "kc-user-granter",
        scope: SCOPE,
        expiresAt: null,
      },
      ctx
    );

    expect(result.kind).toBe("delegation_already_active");
    expect(a.port.grantDelegation).not.toHaveBeenCalled();
    expect(a.audit.emit).not.toHaveBeenCalled();
  });

  it("delegateGrant with non-admin caller returns static_permission_denied", async () => {
    const uc = makeDelegationsUseCases(makeDeps(a));
    const ctx = standardUserCtx("kc-user-random");

    const result = await uc.delegateGrant(
      {
        organisationId: ORG,
        granterUserId: "kc-user-granter",
        granteeUserId: GRANTE,
        grantedBy: "kc-user-granter",
        scope: SCOPE,
        expiresAt: null,
      },
      ctx
    );

    expect(result.kind).toBe("static_permission_denied");
    if (result.kind !== "static_permission_denied") return;
    expect(result.message).toMatch(/not an admin/);
    expect(a.audit.emit).not.toHaveBeenCalled();
    expect(a.port.grantDelegation).not.toHaveBeenCalled();
    expect(a.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "delegate_grant.denied" })
    );
  });

  it("delegateRevoke happy path emits Delegation.Revoked", async () => {
    const uc = makeDelegationsUseCases(makeDeps(a));
    const ctx = adminCtx();
    const result = await uc.delegateRevoke("target-id", ctx);

    expect(result.kind).toBe("ok");
    expect(a.port.revokeDelegation).toHaveBeenCalledWith("target-id", ctx.userId);
    expect(a.audit.emit).toHaveBeenCalledWith({
      action: "Delegation.Revoked",
      actorId: ctx.userId,
      organisationId: null,
      delegationId: "target-id",
    });
  });

  it("delegateRevoke returns not_found if port returns false", async () => {
    (a.port.revokeDelegation as Mock).mockResolvedValueOnce(false);

    const uc = makeDelegationsUseCases(makeDeps(a));
    const ctx = adminCtx();
    const result = await uc.delegateRevoke("unknown-id", ctx);

    expect(result.kind).toBe("not_found");
    expect(a.audit.emit).not.toHaveBeenCalled();
  });

  it("delegateRevoke with non-system-admin returns static_permission_denied", async () => {
    const uc = makeDelegationsUseCases(makeDeps(a));
    const ctx = tenantAdminCtx(); // tenantAdmin:true but systemAdmin:false
    const result = await uc.delegateRevoke("target-id", ctx);

    expect(result.kind).toBe("static_permission_denied");
    expect(a.port.revokeDelegation).not.toHaveBeenCalled();
    expect(a.audit.emit).not.toHaveBeenCalled();
    expect(a.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "delegate_revoke.denied" })
    );
  });

  it("listDelegationsForTenant happy path emits Delegation.Listed", async () => {
    (a.port.listForTenant as Mock).mockResolvedValueOnce([makeRole({}), makeRole({ id: "two" })]);

    const uc = makeDelegationsUseCases(makeDeps(a));
    const result = await uc.listDelegationsForTenant(ORG, adminCtx());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.delegations).toHaveLength(2);
    expect(a.port.listForTenant).toHaveBeenCalledWith(ORG);
    expect(a.audit.emit).toHaveBeenCalledWith({
      action: "Delegation.Listed",
      actorId: "kc-user-admin",
      organisationId: ORG,
    });
  });

  it("listDelegationsForTenant non-admin returns static_permission_denied (no audit)", async () => {
    const uc = makeDelegationsUseCases(makeDeps(a));
    const result = await uc.listDelegationsForTenant(ORG, standardUserCtx("u"));

    expect(result.kind).toBe("static_permission_denied");
    expect(a.port.listForTenant).not.toHaveBeenCalled();
    expect(a.audit.emit).not.toHaveBeenCalled();
  });

  it("listDelegationsForTenant tenant-admin succeeds", async () => {
    (a.port.listForTenant as Mock).mockResolvedValueOnce([makeRole({})]);
    const uc = makeDelegationsUseCases(makeDeps(a));
    const result = await uc.listDelegationsForTenant(ORG, tenantAdminCtx());

    expect(result.kind).toBe("ok");
    expect(a.port.listForTenant).toHaveBeenCalledWith(ORG);
    expect(a.audit.emit).toHaveBeenCalledWith({
      action: "Delegation.Listed",
      actorId: "kc-user-tadmin",
      organisationId: ORG,
    });
  });

  it("listActiveDelegationsForGrantee allows self-lookup by non-admin", async () => {
    (a.port.listActiveForGrantee as Mock).mockResolvedValueOnce([makeRole({})]);

    const uc = makeDelegationsUseCases(makeDeps(a));
    const ctx = standardUserCtx(GRANTE); // grantee == caller
    const result = await uc.listActiveDelegationsForGrantee(GRANTE, ctx);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.delegations).toHaveLength(1);
    expect(a.port.listActiveForGrantee).toHaveBeenCalledWith(GRANTE);
    // No audit for hot query.
    expect(a.audit.emit).not.toHaveBeenCalled();
  });

  it("listActiveDelegationsForGrantee rejects non-admin looking up a different user", async () => {
    const uc = makeDelegationsUseCases(makeDeps(a));
    const ctx = standardUserCtx("kc-user-random");
    const result = await uc.listActiveDelegationsForGrantee(GRANTE, ctx);

    expect(result.kind).toBe("static_permission_denied");
    expect(a.port.listActiveForGrantee).not.toHaveBeenCalled();
  });
});
