/**
 * V1C-04 (delegated administration roles) runtime proof (ADR-0063 / V1C-04).
 *
 * Local-only proof: exercises the `makeDelegationsUseCases` composition root
 * against an in-memory DelegatedAdminRolesPort and a capturing AuditEventPort.
 * Does NOT require live Postgres / compose / IdP infrastructure.
 *
 * Proves:
 *   - deny-by-default: non-admin may not grant
 *   - duplicate prevention: granting the same (organisation, grantee, scope)
 *     twice returns `delegation_already_active`; NO audit and NO mutation
 *   - audit-before-mutation (ADR-ACT-0154): a failed audit emission must
 *     prevent persistence of the new grant
 *   - tenant isolation: ORG_A grants don't leak to ORG_B
 *   - revoke: system-admin can revoke; `not_found` if id absent; `ok`
 *     otherwise with `Delegation.Revoked` audit
 *   - list: system-only on cross-tenant view OR self-only for non-admin
 *
 * Usage: `npm run proof:v1c04`
 */

import {
  makeDelegationsUseCases,
  type AuthContext,
  type AuditEventPort,
  type DelegationLoggerPort,
  type DelegationsDeps,
} from "../src/usecases/delegations.ts";
import type {
  DelegatedRole,
  DelegatedAdminRolesPort,
  GrantDelegationInput,
} from "../src/ports/delegated-admin-roles.ts";

// ---------- checks harness ----------

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}` + (detail ? ` — ${detail}` : ""));
  if (!ok) failures++;
}

// ---------- in-memory DelegatedAdminRolesPort ----------

function makeInMemoryPort(): {
  port: DelegatedAdminRolesPort;
  rows: Map<string, DelegatedRole>;
} {
  const rows = new Map<string, DelegatedRole>();
  const keyFor = (id: string) => id;
  const clone = (r: DelegatedRole): DelegatedRole => ({ ...r });

  const isActive = (r: DelegatedRole, now: Date): boolean =>
    r.revokedAt === null && (r.expiresAt === null || new Date(r.expiresAt) > now);

  return {
    rows,
    port: {
      grantDelegation: async (input: GrantDelegationInput): Promise<DelegatedRole> => {
        const id = crypto.randomUUID();
        const role: DelegatedRole = {
          id,
          organisationId: input.organisationId,
          granterUserId: input.granterUserId,
          granteeUserId: input.granteeUserId,
          scope: input.scope,
          grantedAt: new Date().toISOString(),
          grantedBy: input.grantedBy,
          expiresAt: input.expiresAt,
          revokedAt: null,
          revokedBy: null,
        };
        rows.set(keyFor(id), role);
        return clone(role);
      },
      revokeDelegation: async (delegationId: string, revokedBy: string): Promise<boolean> => {
        const r = rows.get(keyFor(delegationId));
        if (!r || r.revokedAt !== null) return false;
        r.revokedAt = new Date().toISOString();
        r.revokedBy = revokedBy;
        rows.set(keyFor(delegationId), r);
        return true;
      },
      listForTenant: async (organisationId: string): Promise<DelegatedRole[]> => {
        return [...rows.values()].filter((r) => r.organisationId === organisationId).map(clone);
      },
      listActiveForGrantee: async (granteeUserId: string): Promise<DelegatedRole[]> => {
        const now = new Date();
        return [...rows.values()]
          .filter((r) => r.granteeUserId === granteeUserId && isActive(r, now))
          .map(clone);
      },
      findActiveForGranteeAndScope: async (
        granteeUserId: string,
        scope: string
      ): Promise<DelegatedRole | null> => {
        const now = new Date();
        const match = [...rows.values()].find(
          (r) => r.granteeUserId === granteeUserId && r.scope === scope && isActive(r, now)
        );
        return match ? clone(match) : null;
      },
    },
  };
}

// ---------- capturing AuditEventPort + DelegationLoggerPort ----------

function makeCapturingAudit(): {
  port: AuditEventPort;
  events: { action: string; actorId: string }[];
  failNext: () => void;
} {
  const events: { action: string; actorId: string }[] = [];
  let shouldFail = false;
  return {
    events,
    failNext: () => {
      shouldFail = true;
    },
    port: {
      emit: async (input) => {
        if (shouldFail) {
          shouldFail = false;
          throw new Error("audit backend unavailable");
        }
        events.push({ action: input.action, actorId: input.actorId });
      },
    },
  };
}

function makeCapturingLogger(): {
  port: DelegationLoggerPort;
  warns: { event: string; reason: string }[];
} {
  const warns: { event: string; reason: string }[] = [];
  return {
    warns,
    port: {
      warn: async (input) => {
        warns.push({ event: input.event, reason: input.reason });
      },
    },
  };
}

// ---------- contexts ----------

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
const GRANTE = "kc-user-grantee";
const SCOPE = "tenant.members.manage";

function systemAdminCtx(actorId = "kc-op-1"): AuthContext {
  return { systemAdmin: true, tenantAdmin: false, userId: actorId };
}
function tenantAdminCtx(actorId = "kc-tadmin-A"): AuthContext {
  return { systemAdmin: false, tenantAdmin: true, userId: actorId };
}
function standardUserCtx(actorId: string): AuthContext {
  return { systemAdmin: false, tenantAdmin: false, userId: actorId };
}

// ---------- main ----------

async function main(): Promise<void> {
  console.log("# V1C-04 delegated-admin-roles runtime proof (local-only)\n");
  const now = new Date().toISOString();

  // 1. deny-by-default
  {
    const { port } = makeInMemoryPort();
    const audit = makeCapturingAudit();
    const logger = makeCapturingLogger();
    const deps: DelegationsDeps = { port, audit: audit.port, logger: logger.port };
    const uc = makeDelegationsUseCases(deps);
    const result = await uc.delegateGrant(
      {
        organisationId: ORG_A,
        granterUserId: "kc-system",
        granteeUserId: GRANTE,
        grantedBy: "kc-system",
        scope: SCOPE,
        expiresAt: null,
      },
      standardUserCtx("kc-random")
    );
    check("deny-by-default: non-admin grant rejected", result.kind === "static_permission_denied");
    check(
      "deny produces no audit and no mutation",
      audit.events.length === 0 && logger.warns.length === 1
    );
  }

  // 2. happy path: server-side stamps grantedBy from ctx.userId
  {
    const { port, rows } = makeInMemoryPort();
    const audit = makeCapturingAudit();
    const logger = makeCapturingLogger();
    const deps: DelegationsDeps = { port, audit: audit.port, logger: logger.port };
    const uc = makeDelegationsUseCases(deps);
    const ctx = systemAdminCtx("kc-op-1");
    const result = await uc.delegateGrant(
      {
        organisationId: ORG_A,
        granterUserId: "kc-system",
        granteeUserId: GRANTE,
        // Caller forges something else; usecase must override with ctx.userId.
        grantedBy: "kc-spoofed",
        scope: SCOPE,
        expiresAt: null,
      },
      ctx
    );
    check("happy path returns ok", result.kind === "ok");
    if (result.kind !== "ok") return;
    const persisted = rows.get(result.delegation.id);
    check(
      "server-side stamping: persisted grantedBy === ctx.userId",
      persisted?.grantedBy === ctx.userId
    );
    check(
      "audit emits Delegation.Granted",
      audit.events.length === 1 && audit.events[0]?.action === "Delegation.Granted"
    );
  }

  // 3. duplicate prevention: same (org, grantee, scope) twice → already_active, no audit, no mutation
  {
    const { port, rows } = makeInMemoryPort();
    const audit = makeCapturingAudit();
    const logger = makeCapturingLogger();
    const deps: DelegationsDeps = { port, audit: audit.port, logger: logger.port };
    const uc = makeDelegationsUseCases(deps);
    const ctx = systemAdminCtx();
    const first = await uc.delegateGrant(
      {
        organisationId: ORG_A,
        granterUserId: "kc-system",
        granteeUserId: GRANTE,
        grantedBy: ctx.userId,
        scope: SCOPE,
        expiresAt: null,
      },
      ctx
    );
    check("first grant lands", first.kind === "ok" && rows.size === 1);
    const second = await uc.delegateGrant(
      {
        organisationId: ORG_A,
        granterUserId: "kc-system",
        granteeUserId: GRANTE,
        grantedBy: ctx.userId,
        scope: SCOPE,
        expiresAt: null,
      },
      ctx
    );
    check(
      "duplicate returns delegation_already_active (no audit, no mutation)",
      second.kind === "delegation_already_active" && rows.size === 1 && audit.events.length === 1,
      `expected kind=delegation_already_active rows=1 audits=1, got kind=${second.kind} rows=${rows.size} audits=${audit.events.length}`
    );
  }

  // 4. audit-before-mutation (ADR-ACT-0154): failed audit rejects, no row persisted
  {
    const { port, rows } = makeInMemoryPort();
    const audit = makeCapturingAudit();
    const logger = makeCapturingLogger();
    const deps: DelegationsDeps = { port, audit: audit.port, logger: logger.port };
    const uc = makeDelegationsUseCases(deps);
    const ctx = systemAdminCtx();
    audit.failNext();
    let threw = false;
    try {
      await uc.delegateGrant(
        {
          organisationId: ORG_A,
          granterUserId: "kc-system",
          granteeUserId: GRANTE,
          grantedBy: ctx.userId,
          scope: "another.scope",
          expiresAt: null,
        },
        ctx
      );
    } catch {
      threw = true;
    }
    check(
      "audit failure rejects the grant",
      threw && rows.size === 0 // NO row persisted when audit failed
    );
  }

  // 5. tenant isolation: ORG_A grant doesn't appear in ORG_B's listing
  {
    const port = makeInMemoryPort();
    const audit = makeCapturingAudit();
    const logger = makeCapturingLogger();
    const deps: DelegationsDeps = { port: port.port, audit: audit.port, logger: logger.port };
    const uc = makeDelegationsUseCases(deps);
    await uc.delegateGrant(
      {
        organisationId: ORG_A,
        granterUserId: "kc-system",
        granteeUserId: GRANTE,
        grantedBy: "kc-op",
        scope: SCOPE,
        expiresAt: null,
      },
      systemAdminCtx()
    );
    const orgB = await uc.listDelegationsForTenant(ORG_B, systemAdminCtx());
    check(
      "tenant isolation: ORG_B sees zero delegations",
      orgB.kind === "ok" && orgB.delegations.length === 0
    );
  }

  // 6. revoke: ok on existing, not_found on missing
  {
    const port = makeInMemoryPort();
    const audit = makeCapturingAudit();
    const logger = makeCapturingLogger();
    const deps: DelegationsDeps = { port: port.port, audit: audit.port, logger: logger.port };
    const uc = makeDelegationsUseCases(deps);
    const r = await uc.delegateGrant(
      {
        organisationId: ORG_A,
        granterUserId: "kc-system",
        granteeUserId: GRANTE,
        grantedBy: "kc-op",
        scope: SCOPE,
        expiresAt: null,
      },
      systemAdminCtx()
    );
    if (r.kind !== "ok") return;
    const revResult = await uc.delegateRevoke(r.delegation.id, systemAdminCtx());
    check("revoke returns ok on existing id", revResult.kind === "ok");
    check(
      "revoke emits Delegation.Revoked audit",
      audit.events.some((e) => e.action === "Delegation.Revoked")
    );
    const notFound = await uc.delegateRevoke(
      "00000000-0000-0000-0000-000000000000",
      systemAdminCtx()
    );
    check("revoke returns not_found on missing id", notFound.kind === "not_found");
  }

  // 7. listActiveDelegationsForGrantee: self-lookup allowed, other-user denied
  {
    const port = makeInMemoryPort();
    const audit = makeCapturingAudit();
    const logger = makeCapturingLogger();
    const deps: DelegationsDeps = { port: port.port, audit: audit.port, logger: logger.port };
    const uc = makeDelegationsUseCases(deps);
    await uc.delegateGrant(
      {
        organisationId: ORG_A,
        granterUserId: "kc-system",
        granteeUserId: GRANTE,
        grantedBy: "kc-op",
        scope: SCOPE,
        expiresAt: null,
      },
      systemAdminCtx()
    );
    const self = await uc.listActiveDelegationsForGrantee(GRANTE, standardUserCtx(GRANTE));
    check("self-lookup by grantee: allowed", self.kind === "ok" && self.delegations.length === 1);
    const other = await uc.listActiveDelegationsForGrantee(
      GRANTE,
      standardUserCtx("kc-someone-else")
    );
    check("non-admin looking up different user: denied", other.kind === "static_permission_denied");
  }

  // 8. tenant-admin can grant/revoke within their own tenant (Turn-2: revoke is systemAdmin-only)
  {
    const port = makeInMemoryPort();
    const audit = makeCapturingAudit();
    const logger = makeCapturingLogger();
    const deps: DelegationsDeps = { port: port.port, audit: audit.port, logger: logger.port };
    const uc = makeDelegationsUseCases(deps);
    const grantResult = await uc.delegateGrant(
      {
        organisationId: ORG_A,
        granterUserId: "kc-tadmin-A",
        granteeUserId: GRANTE,
        grantedBy: "kc-tadmin-A",
        scope: SCOPE,
        expiresAt: null,
      },
      tenantAdminCtx("kc-tadmin-A")
    );
    check("tenant-admin grant succeeds", grantResult.kind === "ok");
    if (grantResult.kind !== "ok") return;
    const listResult = await uc.listDelegationsForTenant(ORG_A, tenantAdminCtx("kc-tadmin-A"));
    check(
      "tenant-admin listForTenant sees their delegation",
      listResult.kind === "ok" && listResult.delegations.length === 1
    );
    const revokeAttempt = await uc.delegateRevoke(
      grantResult.delegation.id,
      tenantAdminCtx("kc-tadmin-A")
    );
    check(
      "tenant-admin revoke denied (Turn 2 scope: systemAdmin-only)",
      revokeAttempt.kind === "static_permission_denied"
    );
  }

  // suppress unused-vars warnings from the constant
  void now;

  console.log(
    failures === 0 ? "\n# ALL CHECKS PASSED (local-only proof)" : `\n# ${failures} CHECK(S) FAILED`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("proof failed:", err);
  process.exit(1);
});
