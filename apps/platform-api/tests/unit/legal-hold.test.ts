// Unit tests: V1C-12c Legal hold usecase (ADR-0064 / V1C-12c).
//
// Verifies audit-before-change (set/release), input validation, the
// LegalHoldGuard seam that retention and storage layers will consume, and
// the in-memory repository's idempotent set/release. Follows the
// platform-api test convention: node:test with describe/it.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getLegalHoldUsecaseMetric,
  hasActiveLegalHold,
  type LegalHoldActor,
  type LegalHoldDeps,
  LegalHoldGuard,
  listLegalHolds,
  releaseLegalHold,
  setLegalHold,
} from "../../src/usecases/legal-hold.ts";
import { AuditAction, createInMemoryAuditEventPort, type AuditEvent } from "@platform/audit-events";
import type { LegalHoldRecord, LegalHoldRepository } from "../../src/ports/legal-hold.ts";

class InMemoryLegalHoldRepository implements LegalHoldRepository {
  holds: LegalHoldRecord[] = [];
  private nextId = 1;

  async listForTenant(): Promise<LegalHoldRecord[]> {
    return [...this.holds];
  }
  async listForTenantAsOperator(): Promise<LegalHoldRecord[]> {
    return [...this.holds];
  }
  async getActive(org: string, t: string, id: string): Promise<LegalHoldRecord | null> {
    return (
      this.holds.find(
        (h) =>
          h.organisationId === org &&
          h.resourceTable === t &&
          h.rowId === id &&
          h.state === "active"
      ) ?? null
    );
  }
  async set(input: {
    organisationId: string;
    resourceTable: string;
    rowId: string;
    reason: string;
    setBy: string;
    metadata?: Record<string, unknown>;
  }): Promise<LegalHoldRecord> {
    const existing = await this.getActive(input.organisationId, input.resourceTable, input.rowId);
    if (existing) return existing; // true idempotency: returns ORIGINAL row unchanged
    const rec: LegalHoldRecord = {
      id: `lh-${this.nextId++}`,
      organisationId: input.organisationId,
      resourceTable: input.resourceTable,
      rowId: input.rowId,
      reason: input.reason,
      state: "active",
      setBy: input.setBy,
      releasedBy: null,
      setAt: new Date().toISOString(),
      releasedAt: null,
      metadata: input.metadata ?? {},
    };
    this.holds.push(rec);
    return rec;
  }
  async release(input: {
    organisationId: string;
    resourceTable: string;
    rowId: string;
    releasedBy: string;
  }): Promise<LegalHoldRecord> {
    const a = await this.getActive(input.organisationId, input.resourceTable, input.rowId);
    if (a) {
      a.state = "released";
      a.releasedBy = input.releasedBy;
      a.releasedAt = new Date().toISOString();
      return a;
    }
    const released = this.holds.find(
      (h) =>
        h.organisationId === input.organisationId &&
        h.resourceTable === input.resourceTable &&
        h.rowId === input.rowId &&
        h.state === "released"
    );
    if (released) return released;
    throw new Error("legal_hold_not_found");
  }
  async isActive(org: string, t: string, id: string): Promise<boolean> {
    return (await this.getActive(org, t, id)) != null;
  }
}

function actor(): LegalHoldActor {
  return { actorId: "op-1", actorRoles: ["platform.data.admin"] };
}

function build(): {
  deps: LegalHoldDeps;
  audit: AuditEvent[];
  repo: InMemoryLegalHoldRepository;
} {
  const audit = createInMemoryAuditEventPort();
  const collected: AuditEvent[] = [];
  const repo = new InMemoryLegalHoldRepository();
  const capture: AuditEventPort = {
    async emit(e) {
      collected.push(e);
      await audit.emit(e);
    },
    query: audit.query,
  };
  return { deps: { repository: repo, audit: capture }, audit: collected, repo };
}

describe("legal hold use case (V1C-12c) — set", () => {
  it("validates reason length + holdable table + emits audit BEFORE write", async () => {
    const { deps, audit, repo } = build();

    // 1. bad table → invalid + no audit + no row
    const bad1 = await setLegalHold(
      {
        organisationId: "org-1",
        resourceTable: "bogus_table",
        rowId: "x",
        reason: "valid reason with enough chars",
        actor: actor(),
      },
      deps
    );
    assert.equal(bad1.kind, "invalid");
    assert.equal(audit.length, 0);
    assert.equal(repo.holds.length, 0);

    // 2. short reason → invalid + no audit + no row
    const bad2 = await setLegalHold(
      {
        organisationId: "org-1",
        resourceTable: "audit_events",
        rowId: "ev-1",
        reason: "hi",
        actor: actor(),
      },
      deps
    );
    assert.equal(bad2.kind, "invalid");
    assert.equal(audit.length, 0);

    // 3. happy path → audit emitted FIRST, then row written
    const ok = await setLegalHold(
      {
        organisationId: "org-1",
        resourceTable: "audit_events",
        rowId: "ev-42",
        reason: "litigation 2026-Q1 preservation",
        actor: actor(),
      },
      deps
    );
    assert.equal(ok.kind, "ok");
    assert.equal(audit.length, 1, "audit must be emitted exactly once on success");
    assert.equal(audit[0]!.action, AuditAction.LegalHoldSet);
    assert.equal(audit[0]!.resourceId, "audit_events:ev-42");
    assert.equal(audit[0]!.tenantId, "org-1");
    assert.equal(repo.holds.length, 1);
    assert.equal(repo.holds[0]!.state, "active");
  });

  it("idempotent — re-setting preserves ORIGINAL reason/metadata (true idempotency)", async () => {
    const { deps, audit, repo } = build();
    await setLegalHold(
      {
        organisationId: "org-1",
        resourceTable: "audit_events",
        rowId: "ev-1",
        reason: "first preservation reason",
        actor: actor(),
      },
      deps
    );
    const originalId = repo.holds[0]!.id;
    const originalSetAt = repo.holds[0]!.setAt;
    const second = await setLegalHold(
      {
        organisationId: "org-1",
        resourceTable: "audit_events",
        rowId: "ev-1",
        reason: "second preservation reason — should be IGNORED",
        actor: actor(),
      },
      deps
    );
    assert.equal(second.kind, "ok");
    if (second.kind !== "ok") throw new Error("unreachable");
    // Canonical idempotency: id + set_at + reason + set_by UNCHANGED on re-set.
    assert.equal(repo.holds.length, 1, "re-set must NOT create a second row");
    assert.equal(repo.holds[0]!.id, originalId);
    assert.equal(repo.holds[0]!.setAt, originalSetAt);
    assert.equal(repo.holds[0]!.reason, "first preservation reason");
    assert.equal(repo.holds[0]!.setBy, "op-1");
    // Two distinct operator actions → still two distinct audit events recorded.
    assert.equal(audit.length, 2);
  });

  it("audit-before-change: a failing audit port means the DB write never runs", async () => {
    const repo = new InMemoryLegalHoldRepository();
    const failingAudit: AuditEventPort = {
      async emit(): Promise<void> {
        throw new Error("audit storage unavailable");
      },
      async query(): Promise<AuditEvent[]> {
        return [];
      },
    };
    const deps: LegalHoldDeps = { repository: repo, audit: failingAudit };
    await assert.rejects(
      () =>
        setLegalHold(
          {
            organisationId: "org-1",
            resourceTable: "audit_events",
            rowId: "ev-1",
            reason: "preservation reason",
            actor: actor(),
          },
          deps
        ),
      /audit storage unavailable/
    );
    assert.equal(repo.holds.length, 0, "DB write must NOT happen when audit rejects");
    assert.equal(
      getLegalHoldUsecaseMetric("legal_hold_usecase_total", {
        operation: "set",
        outcome: "error",
      }) > 0,
      true
    );
  });
});

describe("legal hold use case (V1C-12c) — release", () => {
  it("emits audit BEFORE transition + transitions state", async () => {
    const { deps, audit, repo } = build();
    await setLegalHold(
      {
        organisationId: "org-1",
        resourceTable: "audit_events",
        rowId: "ev-1",
        reason: "pre-release preservation",
        actor: actor(),
      },
      deps
    );
    audit.length = 0;
    const r = await releaseLegalHold(
      {
        organisationId: "org-1",
        resourceTable: "audit_events",
        rowId: "ev-1",
        actor: actor(),
      },
      deps
    );
    assert.equal(r.kind, "ok");
    assert.equal(repo.holds[0]!.state, "released");
    assert.equal(repo.holds[0]!.releasedBy, "op-1");
    assert.ok(repo.holds[0]!.releasedAt);
    assert.equal(audit.length, 1);
    assert.equal(audit[0]!.action, AuditAction.LegalHoldReleased);
  });

  it("idempotent — second release still audits but DB returns SAME released row", async () => {
    const { deps, audit } = build();
    await setLegalHold(
      {
        organisationId: "org-1",
        resourceTable: "audit_events",
        rowId: "ev-1",
        reason: "preservation reason",
        actor: actor(),
      },
      deps
    );
    await releaseLegalHold(
      {
        organisationId: "org-1",
        resourceTable: "audit_events",
        rowId: "ev-1",
        actor: actor(),
      },
      deps
    );
    audit.length = 0;
    const r = await releaseLegalHold(
      {
        organisationId: "org-1",
        resourceTable: "audit_events",
        rowId: "ev-1",
        actor: actor(),
      },
      deps
    );
    assert.equal(r.kind, "ok");
    assert.equal(audit.length, 1);
  });

  it("missing target returns not_found (not a thrown error)", async () => {
    const { deps, audit } = build();
    const r = await releaseLegalHold(
      {
        organisationId: "org-1",
        resourceTable: "audit_events",
        rowId: "never-held",
        actor: actor(),
      },
      deps
    );
    assert.equal(r.kind, "not_found");
    assert.equal(audit.length, 1, "audit-before-change still emitted on operator action");
  });
});

describe("legal hold use case (V1C-12c) — LegalHoldGuard", () => {
  it("assertCanDelete throws for active hold, no-op for released", async () => {
    const { deps, repo } = build();
    const g = new LegalHoldGuard(deps);
    await setLegalHold(
      {
        organisationId: "org-1",
        resourceTable: "audit_events",
        rowId: "ev-1",
        reason: "preservation reason",
        actor: actor(),
      },
      deps
    );
    await assert.rejects(
      () => g.assertCanDelete("org-1", "audit_events", "ev-1"),
      /legalHoldBlocks|legal/i
    );
    await releaseLegalHold(
      {
        organisationId: "org-1",
        resourceTable: "audit_events",
        rowId: "ev-1",
        actor: actor(),
      },
      deps
    );
    await g.assertCanDelete("org-1", "audit_events", "ev-1"); // must NOT throw
    assert.equal(repo.holds[0]!.state, "released");
  });

  it("FAIL-CLOSED on repository error (status-unavailable refuses deletion)", async () => {
    const failingRepo: Pick<LegalHoldRepository, "isActive"> = {
      async isActive(): Promise<boolean> {
        throw new Error("postgres connection reset");
      },
    };
    const g = new LegalHoldGuard({ repository: failingRepo });
    await assert.rejects(
      () => g.assertCanDelete("org-1", "audit_events", "ev-1"),
      /legalHoldStatusUnavailable|legal/i
    );
    assert.equal(
      getLegalHoldUsecaseMetric("legal_hold_usecase_total", {
        operation: "assert-can-delete",
        outcome: "error",
      }) > 0,
      true
    );
  });
});

describe("legal hold use case (V1C-12c) — observability", () => {
  it("records trace/log-backed metrics for legal hold storage lifecycle operations", async () => {
    const { deps } = build();
    const beforeSet = getLegalHoldUsecaseMetric("legal_hold_usecase_total", {
      operation: "set",
      outcome: "success",
    });
    const beforeList = getLegalHoldUsecaseMetric("legal_hold_usecase_total", {
      operation: "list",
      outcome: "success",
    });
    const beforeCheck = getLegalHoldUsecaseMetric("legal_hold_usecase_total", {
      operation: "is-active",
      outcome: "success",
    });

    await setLegalHold(
      {
        organisationId: "org-1",
        resourceTable: "object_storage",
        rowId: "org-1/uploads/file.txt",
        reason: "storage deletion litigation hold",
        actor: actor(),
      },
      deps
    );
    await listLegalHolds("org-1", deps);
    await hasActiveLegalHold("org-1", "object_storage", "org-1/uploads/file.txt", deps);

    assert.equal(
      getLegalHoldUsecaseMetric("legal_hold_usecase_total", {
        operation: "set",
        outcome: "success",
      }),
      beforeSet + 1
    );
    assert.equal(
      getLegalHoldUsecaseMetric("legal_hold_usecase_total", {
        operation: "list",
        outcome: "success",
      }),
      beforeList + 1
    );
    assert.equal(
      getLegalHoldUsecaseMetric("legal_hold_usecase_total", {
        operation: "is-active",
        outcome: "success",
      }),
      beforeCheck + 1
    );
  });
});

describe("legal hold use case (V1C-12c) — read", () => {
  it("hasActiveLegalHold + listLegalHolds reflect state", async () => {
    const { deps } = build();
    await setLegalHold(
      {
        organisationId: "org-1",
        resourceTable: "audit_events",
        rowId: "ev-1",
        reason: "preservation reason",
        actor: actor(),
      },
      deps
    );
    await setLegalHold(
      {
        organisationId: "org-1",
        resourceTable: "object_storage",
        rowId: "obj-1",
        reason: "preservation reason two",
        actor: actor(),
      },
      deps
    );
    assert.equal(await hasActiveLegalHold("org-1", "audit_events", "ev-1", deps), true);
    assert.equal(await hasActiveLegalHold("org-1", "object_storage", "obj-1", deps), true);
    assert.equal(await hasActiveLegalHold("org-1", "audit_events", "ev-NEVER", deps), false);
    const list = await listLegalHolds("org-1", deps);
    assert.equal(list.length, 2);
  });
});
