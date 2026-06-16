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
exists) fails the architecture suite. It also adds **local `$ref` integrity**
enforcement (every in-document JSON-pointer must resolve), and fixes the one
live dangling reference this surfaced.

This is a partial step toward ADR-ACT-0250. Per ADR-0065, **complete** OpenAPI
drift enforcement over request/response **schemas** (bodies, parameters, status
codes) remains a Proposed sub-decision and is explicitly **not** delivered here.

### Live spec bug fixed

`POST /api/admin/support-session` referenced `#/components/schemas/SupportSessionRequest`,
which did not exist — any codegen/validator resolving the spec would fail. Added
the schema, authored to match the route's Zod contract
(`apps/platform-api/src/server/routes.ts`: `targetOrganisationId` uuid required,
`supportAccessReason` string 1–500 required).

## Implementation

- `tools/architecture/validate-openapi-drift/src/index.mjs`
  - Added a `--strict` flag. In strict mode the tool exits `1` on any
    path+method drift **or** unresolvable `$ref`; default stays report-only
    (exit `0`) to preserve `npm run openapi:drift` behaviour.
  - Added `collectRefs` / `refResolves` / `findUnresolvedRefs` — local
    JSON-pointer resolution over the whole document (handles `~0`/`~1` escapes;
    external non-`#` refs are reported as unresolved by this local check).
  - Extracted pure helpers (`extractRoutes`, `findMissing`, `findExtra`,
    `checkDrift`, `decideExit`) as named exports and guarded CLI execution, so
    drift detection and the strict-exit decision are unit-testable.
- `docs/api/openapi.json`
  - Added the missing `components.schemas.SupportSessionRequest`.
- `tools/architecture/validate-openapi-drift/tests/validate-openapi-drift.test.mjs`
  - Unit coverage for `findMissing` / `findExtra` drift detection, `decideExit`
    (strict → `1` on drift/dangling-ref, `0` otherwise; report-only never
    fails), `collectRefs` / `refResolves` / `findUnresolvedRefs`, a strict-mode
    CLI run that exits `0` on the clean repo, and a guard asserting the live
    `docs/api/openapi.json` has zero unresolvable `$ref`s.
- `make/quality.mk` — the `architecture` target now runs
  `node tools/architecture/validate-openapi-drift/src/index.mjs --strict`. The
  `architecture` target is part of `make check`, so drift is enforced on every
  normal gate.

## Result

- `node --test tools/architecture/validate-openapi-drift/tests/validate-openapi-drift.test.mjs`
  → 11 pass / 0 fail (node:test-proven).
- `node tools/architecture/validate-openapi-drift/src/index.mjs --strict`
  → `OK - 155 route(s) match docs/api/openapi.json`, exit `0` (current repo has
  no path+method drift and no unresolvable `$ref`).
- Report-only invocation (`npm run openapi:drift`) still exits `0`.

## Not delivered (still Proposed under ADR-ACT-0250)

- Request/response schema-level drift (bodies, parameters, headers, status codes).
- SDK generation, external developer portal/gateway, sandbox mode.
