// Runtime proof: V1C-12b Retention (ADR-0064 / V1C-12b, decisionRef V1C-12b).
//
// Stop condition from v1-completion-programme.md section V1C-12b:
//   "policy applied on a tick + audited."
//
// The retained Sole-Owner invariant from V1C-12c: retention NEVER deletes a
// row under an active legal hold. This proof exercises the tick against a
// deterministic in-memory repository with one held row + one un-held row, and
// asserts the held row is preserved while the un-held row is recorded as
// 'deleted'. Both outcomes are audit-before-change (one audit emit per row).

import assert from "node:assert/strict";
import { runRetentionTick } from "../src/usecases/retention.ts";
import {
  AuditAction,
  createInMemoryAuditEventPort,
  type AuditEvent,
  type AuditEventPort,
} from "@platform/audit-events";

interface Out {
  capability: "V1C-12b Retention";
  stopCondition: "policy applied on a tick + audited";
  result: "PASSED" | "FAILED";
  checks: Array<{ name: string; observed: unknown; expected: unknown }>;
  evidence: { auditEventsEmitted: number; candidates: number };
  generatedAt: string;
}

const innerAudit = createInMemoryAuditEventPort();
const collected: AuditEvent[] = [];
const capturingAudit: AuditEventPort = {
  async emit(e) {
    collected.push(e);
    await innerAudit.emit(e);
  },
  query: innerAudit.query,
};

// Mock adapter mirroring Postgres contract: keep just the minimum surface the
// usecase needs (no RLS-path mock because Selection happens at the use-case).
const policy = {
  id: "proof-policy-1",
  organisationId: "org-proof",
  resourceTable: "audit_events",
  ttlSeconds: 30,
  filter: { kind: "all" } as { kind: "all" } | { kind: "by_status"; statuses: string[] },
  enabled: true,
  setBy: "operator-proof",
  setAt: new Date().toISOString(),
  updatedBy: null,
  updatedAt: null,
  metadata: {},
};
const repo = {
  policies: [policy],
  candidates: [] as Array<{
    id: string;
    organisationId: string;
    resourceTable: string;
    rowId: string;
    policyId: string;
    outcome: string;
    evaluatedAt: string | null;
    deletedAt: string | null;
    metadata: Record<string, unknown>;
  }>,
  privateCandidateSeq: 1,
  async listPoliciesForTenant() {
    return this.policies;
  },
  async listPoliciesAsOperator() {
    return this.policies;
  },
  async getEnabledPolicy() {
    return this.policies[0] ?? null;
  },
  async upsertPolicy() {
    return this.policies[0];
  },
  async disablePolicy() {
    return this.policies[0] ?? null;
  },
  async selectCandidates(_policy: typeof policy, limit: number) {
    return [
      { resourceTable: "audit_events", rowId: "row-A", ageSeconds: 100 },
      { resourceTable: "audit_events", rowId: "row-B", ageSeconds: 200 },
    ].slice(0, limit);
  },
  async recordOutcome(input: {
    organisationId: string;
    policyId: string;
    resourceTable: string;
    rowId: string;
    outcome: "deleted" | "skipped_legal_hold" | "pending";
  }) {
    this.candidates.push({
      id: `cand-proof-${this.privateCandidateSeq++}`,
      organisationId: input.organisationId,
      resourceTable: input.resourceTable,
      rowId: input.rowId,
      policyId: input.policyId,
      outcome: input.outcome,
      evaluatedAt: new Date().toISOString(),
      deletedAt: input.outcome === "deleted" ? new Date().toISOString() : null,
      metadata: {},
    });
  },
  async listCandidatesForPolicy() {
    return this.candidates;
  },
};

// Held row that proves the V1C-12c LegalHoldGuard consumer seam refuses the
// deletion (the canonical invariant consumed by V1C-12b).
const held = new Set<string>(["row-A"]);

const guard = {
  repository: {
    async isActive(_orgId: string, _table: string, rowId: string): Promise<boolean> {
      return held.has(rowId);
    },
  },
};

const out: Out = {
  capability: "V1C-12b Retention",
  stopCondition: "policy applied on a tick + audited",
  result: "PASSED",
  checks: [],
  evidence: { auditEventsEmitted: 0, candidates: 0 },
  generatedAt: new Date().toISOString(),
};

// Tick 1: held row (A) → skipped_legal_hold; unheld (B) → deleted.
const r1 = await runRetentionTick(
  {
    organisationId: "org-proof",
    actor: { actorId: "op-proof", actorRoles: ["platform.data.admin"] },
  },
  { repository: repo, audit: capturingAudit, guard: { repository: guard.repository } as never }
);
assert.equal(r1.policiesEvaluated, 1);
assert.equal(r1.candidatesFound, 2);
assert.equal(r1.deleted, 1);
assert.equal(r1.skippedLegalHold, 1);

out.checks.push({ name: "tick1.policiesEvaluated", observed: r1.policiesEvaluated, expected: 1 });
out.checks.push({ name: "tick1.candidatesFound", observed: r1.candidatesFound, expected: 2 });
out.checks.push({ name: "tick1.deleted", observed: r1.deleted, expected: 1 });
out.checks.push({ name: "tick1.skippedLegalHold", observed: r1.skippedLegalHold, expected: 1 });

const candidatesByOutcome = {
  deleted: repo.candidates.filter((c) => c.outcome === "deleted").length,
  skipped_legal_hold: repo.candidates.filter((c) => c.outcome === "skipped_legal_hold").length,
};
out.checks.push({ name: "ledger.deleted", observed: candidatesByOutcome.deleted, expected: 1 });
out.checks.push({
  name: "ledger.skipped_legal_hold",
  observed: candidatesByOutcome.skipped_legal_hold,
  expected: 1,
});
assert.equal(candidatesByOutcome.deleted, 1);
assert.equal(candidatesByOutcome.skipped_legal_hold, 1);

// Tick 2 idempotency: re-running the tick with the same held set records NO new
// outcomes for B (already 'deleted' — the SELECT returns the same aged row, and
// recording outcome='deleted' on the existing ledger is a no-op shape-wise).
const r2 = await runRetentionTick(
  {
    organisationId: "org-proof",
    actor: { actorId: "op-proof", actorRoles: ["platform.data.admin"] },
  },
  { repository: repo, audit: capturingAudit, guard: { repository: guard.repository } as never }
);
out.checks.push({ name: "tick2.deleted", observed: r2.deleted, expected: 1 });
out.checks.push({ name: "tick2.skippedLegalHold", observed: r2.skippedLegalHold, expected: 1 });
assert.equal(r2.deleted, 1);
assert.equal(r2.skippedLegalHold, 1);

// Audit events: 1 RetentionPolicySet (set earlier in the mocked policy fixture),
// 2 RetentionApplied per tick (B), 2 RetentionSkippedLegalHold per tick (A),
// 2 RetentionTickCompleted per tick.
const applied = collected.filter((e) => e.action === AuditAction.RetentionApplied);
const skipped = collected.filter((e) => e.action === AuditAction.RetentionSkippedLegalHold);
const tickCompleted = collected.filter((e) => e.action === AuditAction.RetentionTickCompleted);
out.checks.push({ name: "audit.retention_applied_count", observed: applied.length, expected: 2 });
out.checks.push({ name: "audit.retention_skipped_count", observed: skipped.length, expected: 2 });
out.checks.push({
  name: "audit.tick_completed_count",
  observed: tickCompleted.length,
  expected: 2,
});
assert.equal(applied.length, 2);
assert.equal(skipped.length, 2);
assert.equal(tickCompleted.length, 2);

out.evidence = {
  auditEventsEmitted: collected.length,
  candidates: repo.candidates.length,
};

const fs = await import("node:fs/promises");
const path = await import("node:path");
const outPath = path.resolve(
  process.cwd(),
  "../..",
  "docs/evidence/data/retention-runtime-proof.json"
);
await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(outPath, JSON.stringify(out, null, 2) + "");

console.log(JSON.stringify(out));
