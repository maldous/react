# Evidence: ADR-ACT-0286 — OpenAPI path+method drift promoted to a hard gate

**Date:** 2026-06-17
**Status:** Done
**Action:** ADR-ACT-0286
**ADR Ref:** ADR-0065, ADR-0013

## Summary

The OpenAPI drift validator (ADR-ACT-0139) previously ran in report-only mode —
it always exited `0`, even when `apps/platform-api/src/server/routes.ts` and
`docs/api/openapi.json` disagreed, and it was not wired into any gate. It was
therefore advisory only.

This slice promotes the existing **path+method presence** drift check to a hard
gate so that an undocumented BFF route (or a documented route that no longer
exists) fails the architecture suite.

This is a partial step toward ADR-ACT-0250. Per ADR-0065, **complete** OpenAPI
drift enforcement over request/response **schemas** (bodies, parameters, status
codes) remains a Proposed sub-decision and is explicitly **not** delivered here.

## Implementation

- `tools/architecture/validate-openapi-drift/src/index.mjs`
  - Added a `--strict` flag. In strict mode the tool exits `1` when any route is
    missing from / extra to `docs/api/openapi.json`; default stays report-only
    (exit `0`) to preserve `npm run openapi:drift` behaviour.
  - Extracted pure helpers (`extractRoutes`, `findMissing`, `findExtra`,
    `checkDrift`, `decideExit`) as named exports and guarded CLI execution, so
    drift detection and the strict-exit decision are unit-testable.
- `tools/architecture/validate-openapi-drift/tests/validate-openapi-drift.test.mjs`
  - Added unit coverage for `findMissing` / `findExtra` drift detection and for
    `decideExit` (strict → `1` on drift, `0` otherwise; report-only never fails),
    plus a strict-mode CLI run that exits `0` on the clean repo.
- `make/quality.mk` — the `architecture` target now runs
  `node tools/architecture/validate-openapi-drift/src/index.mjs --strict`. The
  `architecture` target is part of `make check`, so drift is enforced on every
  normal gate.

## Result

- `node --test tools/architecture/validate-openapi-drift/tests/validate-openapi-drift.test.mjs`
  → 6 pass / 0 fail (node:test-proven).
- `node tools/architecture/validate-openapi-drift/src/index.mjs --strict`
  → `OK - 155 route(s) match docs/api/openapi.json`, exit `0` (current repo has
  no path+method drift).
- Report-only invocation (`npm run openapi:drift`) still exits `0`.

## Not delivered (still Proposed under ADR-ACT-0250)

- Request/response schema-level drift (bodies, parameters, headers, status codes).
- SDK generation, external developer portal/gateway, sandbox mode.
