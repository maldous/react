# Evidence: ADR-ACT-0139 ? OpenAPI drift validation

**Date:** 2026-05-29
**Status:** Done
**Action:** ADR-ACT-0139
**ADR Ref:** ADR-0013, ADR-0011

## Summary

Added a lightweight report-only drift check that compares route declarations in
`apps/platform-api/src/server/routes.ts` against the documented REST surface in
`docs/api/openapi.json`.

## Implementation

- Tool: `tools/architecture/validate-openapi-drift/src/index.mjs`
- Tests: `tools/architecture/validate-openapi-drift/tests/validate-openapi-drift.test.mjs`
- Package entry added under `tools/architecture/validate-openapi-drift/package.json`

## Result

The current repository state matches the documented OpenAPI paths and methods.
