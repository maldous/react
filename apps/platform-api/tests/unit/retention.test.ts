// Unit tests: V1C-12b Retention usecase (ADR-0064 / V1C-12b).
//
// Verifies:
//   - set policy: validation (table, ttl, filter) + audit-before-change
//   - disable policy: audit-before-change + idempotent not_found
//   - run tick: held rows are PRESERVED (LegalHoldGuard consumer seam); unheld rows
//     are recorded as 'deleted'; non-matching filters yield no candidates
//   - filter whitelist rejects free-form predicates
//
// Follows the platform-api test convention: node:test with describe/it.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  disableRetentionPolicy,
  getRetentionWorkflowMetric,
  listRetentionPoliciesAsOperator,
  listRetentionPoliciesForTenant,
  runRetentionTick,
  setRetentionPolicy,
  validateFilter,
  RetentionFilterError,
  type RetentionActor,
  type RetentionDeps,
} from "../../src/usecases/retention.ts";
import {
  AuditAction,
  createInMemoryAuditEventPort,
  type AuditEvent,
  type AuditEventPort,
} from "@platform/audit-events";
import type {
  CandidateRow,
  RetentionCandidateOutcome,
  RetentionCandidateRecord,
  RetentionFilter,
  RetentionPolicyRecord,
  RetentionRepository,
} from "../../src/ports/retention.ts";
import type { LegalHoldRecord, LegalHoldRepository } from "../../src/ports/legal-hold.ts";

class InMemoryRetentionRepository implements RetentionRepository {
  policies: RetentionPolicyRecord[] = [];
  candidates: RetentionCandidateRecord[] = [];
  private policySeq = 1;
  private candidateSeq = 1;
  /** Canned candidates by organisation + resource_table; tests pre-load this. */
  candidateFixtures: Array<{ org: string; table: string; agedRows: CandidateRow[] }> = [];

  async listPoliciesForTenant(org: string): Promise<RetentionPolicyRecord[]> {
    return this.policies.filter((p) => p.organisationId === org && p.enabled);
  }
  async listPoliciesAsOperator(org: string): Promise<RetentionPolicyRecord[]> {
    return this.policies.filter((p) => p.organisationId === org);
  }
  async getEnabledPolicy(org: string, table: string): Promise<RetentionPolicyRecord | null> {
    return (
      this.policies.find(
        (p) => p.organisationId === org && p.resourceTable === table && p.enabled
      ) ?? null
    );
  }
  async upsertPolicy(input: {
    organisationId: string;
    resourceTable: string;
    ttlSeconds: number;
    filter: RetentionFilter;
    setBy: string;
    enabled?: boolean;
    metadata?: Record<string, unknown>;
  }): Promise<RetentionPolicyRecord> {
    // Mirror the SQL behaviour: disable any prior enabled policy for (org, table).
    for (const p of this.policies) {
      if (
        p.organisationId === input.organisationId &&
        p.resourceTable === input.resourceTable &&
        p.enabled
      ) {
        p.enabled = false;
        p.updatedAt = new Date().toISOString();
        p.updatedBy = input.setBy;
      }
    }
    const rec: RetentionPolicyRecord = {
      id: `ret-${this.policySeq++}`,
      organisationId: input.organisationId,
      resourceTable: input.resourceTable,
      ttlSeconds: input.ttlSeconds,
      filter: input.filter,
      enabled: input.enabled ?? true,
      setBy: input.setBy,
      setAt: new Date().toISOString(),
      updatedBy: null,
      updatedAt: null,
      metadata: input.metadata ?? {},
    };
    this.policies.push(rec);
    return rec;
  }
  async disablePolicy(org: string, table: string): Promise<RetentionPolicyRecord | null> {
    const p = await this.getEnabledPolicy(org, table);
    if (!p) return null;
    p.enabled = false;
    p.updatedAt = new Date().toISOString();
    p.updatedBy = "operator";
    return p;
  }
  async selectCandidates(policy: RetentionPolicyRecord, limit: number): Promise<CandidateRow[]> {
    const fx = this.candidateFixtures.find(
      (f) => f.org === policy.organisationId && f.table === policy.resourceTable
    );
    if (!fx) return [];
    let rows = fx.agedRows;
    if (policy.filter.kind === "by_status") {
      // In-memory: emulate the SQL filter by tagging aged rows with status.
      rows = fx.agedRows.filter(
        (r) =>
          policy.filter.kind === "by_status" &&
          policy.filter.statuses.includes((r as unknown as { status: string }).status)
      );
    }
    return rows.slice(0, limit);
  }
  async recordOutcome(input: {
    organisationId: string;
    policyId: string;
    resourceTable: string;
    rowId: string;
    outcome: RetentionCandidateOutcome;
  }): Promise<void> {
    const existing = this.candidates.find(
      (c) =>
        c.policyId === input.policyId &&
        c.resourceTable === input.resourceTable &&
        c.rowId === input.rowId
    );
    if (existing) {
      existing.outcome = input.outcome;
      existing.evaluatedAt = input.outcome === "pending" ? null : new Date().toISOString();
      existing.deletedAt = input.outcome === "deleted" ? new Date().toISOString() : null;
      return;
    }
    this.candidates.push({
      id: `cand-${this.candidateSeq++}`,
      organisationId: input.organisationId,
      resourceTable: input.resourceTable,
      rowId: input.rowId,
      policyId: input.policyId,
      outcome: input.outcome,
      evaluatedAt: input.outcome === "pending" ? null : new Date().toISOString(),
      deletedAt: input.outcome === "deleted" ? new Date().toISOString() : null,
      metadata: {},
    });
  }
  async listCandidatesForPolicy(
    policyId: string,
    outcome?: RetentionCandidateOutcome
  ): Promise<RetentionCandidateRecord[]> {
    const rows = this.candidates.filter((c) => c.policyId === policyId);
    return outcome ? rows.filter((c) => c.outcome === outcome) : rows;
  }
}

class InMemoryLegalHoldRepository implements LegalHoldRepository {
  activeHolds: Array<{ org: string; table: string; rowId: string }> = [];
  async listForTenant(): Promise<LegalHoldRecord[]> {
    return [];
  }
  async listForTenantAsOperator(): Promise<LegalHoldRecord[]> {
    return [];
  }
  async getActive(_org: string, _t: string, _id: string): Promise<LegalHoldRecord | null> {
    return null;
  }
  async set(): Promise<LegalHoldRecord> {
    throw new Error("not used in retention tests");
  }
  async release(): Promise<LegalHoldRecord> {
    throw new Error("not used in retention tests");
  }
  async isActive(org: string, table: string, rowId: string): Promise<boolean> {
    return this.activeHolds.some((h) => h.org === org && h.table === table && h.rowId === rowId);
  }
}

function actor(): RetentionActor {
  return { actorId: "op-1", actorRoles: ["platform.data.admin"] };
}

function build(): {
  deps: RetentionDeps;
  audit: AuditEvent[];
  retentionRepo: InMemoryRetentionRepository;
  holdingRepo: InMemoryLegalHoldRepository;
  guard: { repository: Pick<LegalHoldRepository, "isActive"> };
} {
  const innerAudit = createInMemoryAuditEventPort();
  const collected: AuditEvent[] = [];
  const capture: AuditEventPort = {
    async emit(e) {
      collected.push(e);
      await innerAudit.emit(e);
    },
    query: innerAudit.query,
  };
  const retentionRepo = new InMemoryRetentionRepository();
  const holdingRepo = new InMemoryLegalHoldRepository();
  const guard = { repository: holdingRepo as Pick<LegalHoldRepository, "isActive"> };
  const deps: RetentionDeps = {
    repository: retentionRepo,
    audit: capture,
    guard,
  };
  return { deps, audit: collected, retentionRepo, holdingRepo, guard };
}

// ─── Filter validation ────────────────────────────────────────────────────
describe("retention use case (V1C-12b) — filter validation", () => {
  it("accepts 'all'", () => {
    assert.doesNotThrow(() => validateFilter({ kind: "all" }));
  });
  it("accepts 'by_status' with non-empty array", () => {
    assert.doesNotThrow(() =>
      validateFilter({ kind: "by_status", statuses: ["invited", "disabled"] })
    );
  });
  it("rejects free-form or unknown kind", () => {
    assert.throws(
      () => validateFilter({ kind: "raw_sql", value: "WHERE 1=1" } as unknown as RetentionFilter),
      RetentionFilterError
    );
  });
  it("rejects empty by_status array", () => {
    assert.throws(() => validateFilter({ kind: "by_status", statuses: [] }), RetentionFilterError);
  });
  it("rejects status string longer than 64 chars", () => {
    assert.throws(
      () => validateFilter({ kind: "by_status", statuses: ["x".repeat(65)] }),
      RetentionFilterError
    );
  });
});

// ─── Set policy ───────────────────────────────────────────────────────────
describe("retention use case (V1C-12b) — set", () => {
  it("validates resource_table, ttl_seconds, and emits audit BEFORE write", async () => {
    const { deps, audit, retentionRepo } = build();
    // bad table
    const bad1 = await setRetentionPolicy(
      {
        organisationId: "org-1",
        resourceTable: "bogus_table",
        ttlSeconds: 60,
        filter: { kind: "all" },
        actor: actor(),
      },
      deps
    );
    assert.equal(bad1.kind, "invalid");
    assert.equal(audit.length, 0);
    assert.equal(retentionRepo.policies.length, 0);

    // ttl < 0
    const bad2 = await setRetentionPolicy(
      {
        organisationId: "org-1",
        resourceTable: "audit_events",
        ttlSeconds: -1,
        filter: { kind: "all" },
        actor: actor(),
      },
      deps
    );
    assert.equal(bad2.kind, "invalid");
    assert.equal(audit.length, 0);

    // ttl > cap
    const bad3 = await setRetentionPolicy(
      {
        organisationId: "org-1",
        resourceTable: "audit_events",
        ttlSeconds: 365 * 24 * 60 * 60 + 1,
        filter: { kind: "all" },
        actor: actor(),
      },
      deps
    );
    assert.equal(bad3.kind, "invalid");
    assert.equal(audit.length, 0);

    // happy path: audit emitted, then write
    const ok = await setRetentionPolicy(
      {
        organisationId: "org-1",
        resourceTable: "audit_events",
        ttlSeconds: 90 * 24 * 60 * 60,
        filter: { kind: "by_status", statuses: ["invited", "disabled"] },
        actor: actor(),
      },
      deps
    );
    assert.equal(ok.kind, "ok");
    assert.equal(audit.length, 1);
    assert.equal(audit[0]!.action, AuditAction.RetentionPolicySet);
    assert.equal(retentionRepo.policies.length, 1);
    assert.equal(retentionRepo.policies[0]!.enabled, true);
  });

  it("audit-before-change: a failing audit port means the DB write never runs", async () => {
    const failingAudit: AuditEventPort = {
      async emit(): Promise<void> {
        throw new Error("audit storage unavailable");
      },
      async query(): Promise<AuditEvent[]> {
        return [];
      },
    };
    const retentionRepo = new InMemoryRetentionRepository();
    const holdingRepo = new InMemoryLegalHoldRepository();
    const deps: RetentionDeps = {
      repository: retentionRepo,
      audit: failingAudit,
      guard: { repository: holdingRepo as Pick<LegalHoldRepository, "isActive"> },
    };
    await assert.rejects(
      () =>
        setRetentionPolicy(
          {
            organisationId: "org-1",
            resourceTable: "audit_events",
            ttlSeconds: 60,
            filter: { kind: "all" },
            actor: actor(),
          },
          deps
        ),
      /audit storage unavailable/
    );
    assert.equal(retentionRepo.policies.length, 0, "DB write must NOT happen on audit failure");
  });
});

// ─── Disable ──────────────────────────────────────────────────────────────
describe("retention use case (V1C-12b) — disable", () => {
  it("emits audit BEFORE the disable update + transitions state", async () => {
    const { deps, audit, retentionRepo } = build();
    await setRetentionPolicy(
      {
        organisationId: "org-1",
        resourceTable: "audit_events",
        ttlSeconds: 60,
        filter: { kind: "all" },
        actor: actor(),
      },
      deps
    );
    audit.length = 0;
    const r = await disableRetentionPolicy(
      { organisationId: "org-1", resourceTable: "audit_events", actor: actor() },
      deps
    );
    assert.equal(r.kind, "ok");
    assert.equal(retentionRepo.policies[0]!.enabled, false);
    assert.equal(audit.length, 1);
    assert.equal(audit[0]!.action, AuditAction.RetentionPolicyRemoved);
  });
  it("returns not_found when no enabled policy exists for the (org, table)", async () => {
    const { deps } = build();
    const r = await disableRetentionPolicy(
      { organisationId: "org-1", resourceTable: "audit_events", actor: actor() },
      deps
    );
    assert.equal(r.kind, "not_found");
  });
});

// ─── Tick ────────────────────────────────────────────────────────────────
describe("retention use case (V1C-12b) — runRetentionTick", () => {
  async function scenarioWithTwoCandidates(buildingDeps: ReturnType<typeof build>): Promise<void> {
    const { retentionRepo, deps } = buildingDeps;
    await setRetentionPolicy(
      {
        organisationId: "org-1",
        resourceTable: "audit_events",
        ttlSeconds: 30,
        filter: { kind: "all" },
        actor: actor(),
      },
      deps
    );
    retentionRepo.candidateFixtures.push({
      org: "org-1",
      table: "audit_events",
      agedRows: [
        { resourceTable: "audit_events", rowId: "row-A", ageSeconds: 100 },
        { resourceTable: "audit_events", rowId: "row-B", ageSeconds: 200 },
      ],
    });
  }

  it("deletes un-held rows + records outcome + emits per-row audit events", async () => {
    const b = build();
    await scenarioWithTwoCandidates(b);
    const r = await runRetentionTick({ organisationId: "org-1", actor: actor() }, b.deps);
    assert.equal(r.policiesEvaluated, 1);
    assert.equal(r.candidatesFound, 2);
    assert.equal(r.deleted, 2);
    assert.equal(r.skippedLegalHold, 0);
    const ledger = await b.retentionRepo.listCandidatesForPolicy(b.retentionRepo.policies[0]!.id);
    assert.equal(ledger.length, 2);
    for (const c of ledger) assert.equal(c.outcome, "deleted");
    // one audit per deletion + one tick-summary audit
    const retentionApplied = b.audit.filter((e) => e.action === AuditAction.RetentionApplied);
    assert.equal(retentionApplied.length, 2);
    const tickSummary = b.audit.filter((e) => e.action === AuditAction.RetentionTickCompleted);
    assert.equal(tickSummary.length, 1);
    assert.equal(getRetentionWorkflowMetric("tick", "success") > 0, true);
  });

  it("skips_legal_hold: held rows are PRESERVED (consumes V1C-12c LegalHoldGuard)", async () => {
    const b = build();
    await scenarioWithTwoCandidates(b);
    b.holdingRepo.activeHolds.push({ org: "org-1", table: "audit_events", rowId: "row-A" });
    const r = await runRetentionTick({ organisationId: "org-1", actor: actor() }, b.deps);
    assert.equal(r.deleted, 1);
    assert.equal(r.skippedLegalHold, 1);
    const ledger = await b.retentionRepo.listCandidatesForPolicy(b.retentionRepo.policies[0]!.id);
    const a = ledger.find((c) => c.rowId === "row-A");
    const bb = ledger.find((c) => c.rowId === "row-B");
    assert.equal(a?.outcome, "skipped_legal_hold");
    assert.equal(bb?.outcome, "deleted");
    const skips = b.audit.filter((e) => e.action === AuditAction.RetentionSkippedLegalHold);
    assert.equal(skips.length, 1);
    assert.equal(skips[0]!.resourceId, "audit_events:row-A");
  });

  it("skips: the (org, table) has no candidates", async () => {
    const b = build();
    await setRetentionPolicy(
      {
        organisationId: "org-1",
        resourceTable: "audit_events",
        ttlSeconds: 30,
        filter: { kind: "all" },
        actor: actor(),
      },
      b.deps
    );
    const r = await runRetentionTick({ organisationId: "org-1", actor: actor() }, b.deps);
    assert.equal(r.candidatesFound, 0);
    assert.equal(r.deleted, 0);
    assert.equal(r.skippedLegalHold, 0);
  });

  it("skips: filter yields zero candidates (in-memory: by_status with zero matching)", async () => {
    const b = build();
    await setRetentionPolicy(
      {
        organisationId: "org-1",
        resourceTable: "audit_events",
        ttlSeconds: 30,
        filter: { kind: "by_status", statuses: ["unknown_status"] },
        actor: actor(),
      },
      b.deps
    );
    b.retentionRepo.candidateFixtures.push({
      org: "org-1",
      table: "audit_events",
      agedRows: [
        { resourceTable: "audit_events", rowId: "row-A", ageSeconds: 100 } as CandidateRow & {
          status: string;
        },
      ],
    });
    const r = await runRetentionTick({ organisationId: "org-1", actor: actor() }, b.deps);
    assert.equal(r.candidatesFound, 0);
  });
});

// ─── Read ────────────────────────────────────────────────────────────────
describe("retention use case (V1C-12b) — read", () => {
  it("listForTenant only returns enabled policies; listAsOperator returns all", async () => {
    const { deps, retentionRepo } = build();
    await setRetentionPolicy(
      {
        organisationId: "org-1",
        resourceTable: "audit_events",
        ttlSeconds: 60,
        filter: { kind: "all" },
        actor: actor(),
      },
      deps
    );
    await setRetentionPolicy(
      {
        organisationId: "org-1",
        resourceTable: "tenant_invitations",
        ttlSeconds: 120,
        filter: { kind: "all" },
        actor: actor(),
      },
      deps
    );
    await disableRetentionPolicy(
      { organisationId: "org-1", resourceTable: "tenant_invitations", actor: actor() },
      deps
    );
    const forTenant = await listRetentionPoliciesForTenant("org-1", deps);
    assert.equal(forTenant.length, 1);
    assert.equal(forTenant[0]!.resourceTable, "audit_events");
    const asOperator = await listRetentionPoliciesAsOperator("org-1", deps);
    assert.equal(asOperator.length, 2);
    assert.equal(retentionRepo.policies.filter((p) => !p.enabled).length, 1);
  });
});
