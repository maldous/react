# Final Pre-Slice Hardening Evidence

**ADR-ACT-0117** ? 2026-05-28

## Summary

This evidence bundle records the final pre-slice hardening changes required before ADR-ACT-0008 can begin: actor/RuntimeContext propagation through the pipeline, migration checksum enforcement, ACTION-REGISTER-aware slice readiness validation, and manifest cleanup for ADR-ACT-0008.

## Changes

### 1. Pipeline actor/RuntimeContext propagation

**File:** `apps/platform-api/src/server/pipeline.ts`

- `PipelineRequest` extended with `actor: SessionActor | null` and `context: RuntimeContext`
- `createRequestContext()` called after auth resolution; populates `actorId`, `tenantId`, `organisationId`, `operationName` from the resolved actor
- `enrichedLogger` enriched with `actorId`/`tenantId` child fields for authenticated routes
- 405 response now uses `jsonResponse()` ? `X-Request-Id` header present on all error responses including 405
- `route matched` and `request complete` log lines added

### 2. Migration checksum enforcement

**File:** `apps/platform-api/src/db/migrate.ts`

- Changed "already applied" check from silent skip to checksum comparison
- If `stored != computed` ? throws `Error` with `checksum mismatch` in message
- Prevents accidental modification of committed migration files from going undetected

### 3. ACTION-REGISTER-aware slice readiness validation

**File:** `tools/architecture/validate-slice-readiness/src/index.mjs`

- `readActionRegisterStatuses()` parses the ACTION-REGISTER.md pipe table and returns a Map of `ADR-ACT-XXXX ? status`
- `validateBlockerGovernance()` checks each blocker:
  - If blocker not found in register ? ERROR (unknown reference)
  - If blocker is `done` in register ? ERROR (stale reference ? must be removed)
  - If blocker is `open` ? valid (no error)
- `validateManifest()` accepts `actionStatuses` as third parameter (default `new Map()`)
- `main()` reads ACTION-REGISTER before the validation loop

### 4. ADR-ACT-0008 manifest updated

**File:** `docs/slices/ADR-ACT-0008.json`

- `blockedBy: ["ADR-ACT-0112", "ADR-ACT-0113"]` ? `blockedBy: []` (both are Done per ACTION-REGISTER)
- `requiredCapabilities` extended with `migration-runner`

## Test counts

| Suite | Previous | Added | Total |
| --- | --- | --- | --- |
| Pipeline (api-pipeline.test.ts) | 8 | 5 | 13 |
| Slice readiness (validate-slice-readiness.test.mjs) | 7 | 5 | 12 |
| Compose smoke (compose-smoke.test.mjs) | 22 | 1 | 23 |
| **Full suite (test:coverage)** | 371 | +10 | **381** |

## Gate results

| Gate | Result |
| --- | --- |
| `tsc:check` | PASS |
| `lint` | PASS ? 0 ESLint problems |
| `format:check` | PASS |
| `orchestrator all --no-reports --strict` | PASS ? 7/7 steps |
| `test:coverage` | PASS ? 381/381 tests |
| `validate:slices` | PASS |
| `test:e2e` | PASS ? 8/8 tests |
