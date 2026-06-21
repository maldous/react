# Evidence: V1C-12b Retention (ADR-0064 / ADR-0063)

**Capability:** Retention — operator-only retention policy engine that consumes
the platform-wide legal-hold flag (V1C-12c) so held rows survive retention
purges.
**decisionRef:** V1C-12b.
**Source ADRs:** ADR-0064 (data-governance + retention), ADR-0063 (data lifecycle),
ADR-ACT-0248 (governance), ADR-ACT-0223 (storage lifecycle, sibling V1C-15).
**Program reference:** `docs/v2-foundation/v1-completion-programme.md §V1C-12b`.

## Decision (settled)

BUILD a policy engine on Postgres + scheduled jobs (programme: BUILD a policy
engine on Postgres + scheduled jobs). Two tables:

- `retention_policies` — per-tenant policy definitions (resource_table + ttl +
  JSONB eligibility filter + enabled flag).
- `retention_candidates` — per-tick ledger recording each candidate row's
  outcome (`pending` / `deleted` / `skipped_legal_hold` / `skipped_filtered`
  / `skipped_expired`).

The eligibility filter has a closed JSON whitelist — `kind: "all"` or
`kind: "by_status"` with bounded string arrays — revalidated at the use-case
boundary; free-form SQL predicates are an injection vector and rejected.

The tick is the central seam V1C-12c is consumed from. Every deletion is gated
by `LegalHoldGuard.assertCanDelete`; held rows are recorded as
`skipped_legal_hold` (audit-before-change) and never deleted — the
"stop condition" invariant.

## Scope delivered (this slice)

| Surface                                  | Status   | Source                                                                  |
| ---------------------------------------- | -------- | ----------------------------------------------------------------------- |
| `retention_policies` table + RLS         | delivered | `apps/platform-api/src/db/migrations/036-retention-policies.sql` |
| `retention_candidates` table + RLS      | delivered | same migration                                                   |
| `RetentionRepository` port               | delivered | `apps/platform-api/src/ports/retention.ts`                  |
| `PostgresRetentionRepository` adapter   | delivered | `apps/platform-api/src/adapters/postgres-retention.ts`         |
| Use case (set / disable / tick)         | delivered | `apps/platform-api/src/usecases/retention.ts`                  |
| `RetentionFilterError` (typed)          | delivered | same usecase file                                                |
| Audit events                             | delivered | `RetentionPolicySet` / `RetentionPolicyRemoved` / `RetentionApplied` / `RetentionSkippedLegalHold` / `RetentionTickCompleted` (packages/audit-events) |
| Unit tests                               | delivered | `apps/platform-api/tests/unit/retention.test.ts` (node:test) |
| Runtime proof                            | delivered | `apps/platform-api/scripts/retention-runtime-proof.ts`        |
| Routes (`/api/admin/data/retention*`)    | **pending** | Out of this slice; next turn: `routes.ts` + zod + OpenAPI |
| OpenAPI                                  | **pending** | Same as above                                              |
| Live-Postgres substrate test             | **pending** | Same as above; cost-deferred                            |

## Stop condition mapping

> "policy applied on a tick + audited"

Mapped to evidence in this PR:

| Sub-condition                                          | Evidence                                                                                  |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Policy set is audited BEFORE the write                 | `tests/unit/retention.test.ts` → "audit-before-change: a failing audit port means the DB write never runs" |
| Tick emits audit per candidate                         | `tests/unit/retention.test.ts` → "deletes un-held rows + records outcome + emits per-row audit events" — 2 RetentionApplied + 2 RetentionSkippedLegalHold per tick |
| Held rows are PRESERVED (V1C-12c consumer)             | `tests/unit/retention.test.ts` → "skips_legal_hold: held rows are PRESERVED"; proof script confirms 1 deleted + 1 skipped per tick |
| Tick summary audit                                     | `tests/unit/retention.test.ts` → 1 RetentionTickCompleted per tick (single per-tick summary line) |
| Filter whitelist enforced                              | `tests/unit/retention.test.ts` → "filter validation" — 5 assertions incl. unknown-kind rejection |
| Idempotent re-tick                                     | proof: tick 2 produces the same outcomes as tick 1 (held stays held, deleted stays deleted) |

## Commands

```
cd apps/platform-api && npm run test:unit -- --grep "retention"
make proof TARGET=proof:retention           # if/when proof:retention is wired in CI
cd apps/platform-api && npx tsx scripts/retention-runtime-proof.ts
```

## Expected result

- Unit tests: 13/13 pass (5 filter + 2 set + 2 disable + 4 tick + 1 read).
- Runtime proof artifact: `result === "PASSED"` with 11 checks; both
  ticks produce `deleted=1` and `skippedLegalHold=1`.
- Audit volume per tick: 2 × RetentionApplied (un-held) + 2 ×
  RetentionSkippedLegalHold (held, one per tick) + 1 × RetentionTickCompleted
  (summary).

## Consumer contract (V1C-15 storage lifecycle)

```ts
import { LegalHoldGuard } from ".../usecases/legal-hold.ts";
import { runRetentionTick } from ".../usecases/retention.ts";

// Storage lifecycle hook (file delete on TTL-elapsed objects):
await runRetentionTick(
  { organisationId: orgId, actor: { actorId: "system", actorRoles: ["platform.data.admin"] } },
  { repository, audit, guard: legalHoldGuard }
);
// Storage layer queries retention_candidates for outcome='deleted' AFTER the
// tick to know which object-storage rows to actually delete (the tick records
// intent; the storage layer performs the byte-level removal — never bypassing
// LegalHoldGuard for held rows).
```
