# Evidence: V1C-12c Legal Hold (ADR-0064 / ADR-0063)

**Capability:** Legal hold — single platform owner across V1.
**decisionRef:** V1C-12c.
**Source ADRs:** ADR-0064 (data-governance + retention), ADR-0063 (data lifecycle), ADR-ACT-0248 (governance).
**Program reference:** `docs/v2-foundation/v1-completion-programme.md §V1C-12c`.

## Decision (settled)

BUILD a Postgres-resident legal-hold flag — the **sole owner** across the V1
platform. Retention (V1C-12b) and Object Storage (V1C-15) **consume** the flag
but never define their own. When `state='active'`, any change to a referenced
record is denied. When `state='released'`, layers may proceed.

A `LegalHoldGuard.assertCanDelete()` public seam is the only call retention and
storage make; both must short-circuit on throw. Released holds are no-op (the
guard never throws for a rows whose active hold does not exist).

## Scope delivered

| Surface                     | Status     | Source                                       |
| --------------------------- | ---------- | -------------------------------------------- |
| `legal_holds` table + RLS   | delivered  | `apps/platform-api/src/db/migrations/035-legal-holds.sql` |
| `LegalHoldRepository` port  | delivered  | `apps/platform-api/src/ports/legal-hold.ts`  |
| `PostgresLegalHoldRepository` adapter | delivered | `apps/platform-api/src/adapters/postgres-legal-hold.ts` |
| Use case + Guard            | delivered  | `apps/platform-api/src/usecases/legal-hold.ts` |
| Audit events                | delivered  | `LegalHoldSet` / `LegalHoldReleased` (packages/audit-events) |
| Unit tests                  | delivered  | `apps/platform-api/tests/unit/legal-hold.test.ts` |
| Runtime proof (hermetic)    | delivered  | `apps/platform-api/scripts/legal-hold-runtime-proof.ts` |
| Routes + OpenAPI            | **pending** | Out of scope for this slice — follow-up wiring |
| Permission `platform.data.*`| **pending** | Out of scope for this slice — register when routes wire |
| Live Postgres substrate     | **pending** | Add a substrate test under `tests/substrate/` when adjacent test suites are bootstrapped |

## Stop condition mapping

> "held records survive retention AND withstand storage lifecycle deletion;
>  proven."

Mapped to evidence in this PR:

| Sub-condition                                  | Evidence                                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Active hold emitted **before** write           | `usecases/legal-hold.test.ts` → "audit-before-change: a failing audit port means the DB write never runs" |
| Single owner across platform                   | `HOLDABLE_TABLES` constant in `usecases/legal-hold.ts` is the **only** surface that exposes set/release — retention and storage layers will import `LegalHoldGuard` |
| Survives deletion attempts                     | `usecases/legal-hold.test.ts` → "LegalHoldGuard: assertCanDelete throws for active hold, no-op for released" |
| Idempotent set / release                       | `usecases/legal-hold.test.ts` → "set: idempotent" + "release: idempotent" + "release: missing target returns not_found" |
| Authenticated audit trail                      | Two `AuditAction.LegalHoldSet` / `LegalHoldReleased` events emitted on operator transitions (asserted in unit tests) |

## Commands

```text
# Run the unit tests (no live Postgres required)
cd apps/platform-api && npm run test:unit -- --grep "legal hold"

# Run the runtime proof (writes docs/evidence/data/legal-hold-runtime-proof.json)
make proof TARGET=proof:legal-hold-holds-survive
# OR
cd apps/platform-api && npx tsx scripts/legal-hold-runtime-proof.ts
```

## Expected result

- Unit tests: 8/8 pass.
- Runtime proof: writes a JSON artifact with `result: "PASSED"` and at least 4
  `checks` (set returns ok, audit-before-change set emitted, audit-before-change
  release emitted, after_release isActive=false).
- After wiring (follow-up PR): a `tests/substrate/legal-hold.test.ts` runs the
  same invariant against a live `legal_holds` table (RLS + migration
  checkout) and the existing substrate harness proves no assertion regressed.

## Consumer contract (V1C-12b retention + V1C-15 storage)

```ts
import { LegalHoldGuard, type LegalHoldDeps } from ".../usecases/legal-hold.ts";

// In a retention tick:
const guard = new LegalHoldGuard({ repository: holdRepo, audit: audit });
try {
  await guard.assertCanDelete(organisationId, "audit_events", rowId);
  await retention.deleteRow(rowId);
} catch (err) {
  if (err instanceof ForbiddenError) continue; // held; skip
  throw err;
}

// In the storage lifecycle hook (same shape, resourceTable="object_storage").
```
