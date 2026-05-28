# Slice Readiness Enforcement Baseline Evidence

**Date:** 2026-05-28
**ADR references:** ADR-ACT-0116, ADR-0024, ADR-0011, ADR-0012

## Summary

New governance tool `validate-slice-readiness` created at
`tools/architecture/validate-slice-readiness/`. Validates `docs/slices/*.json` manifests
against the ADR-0024 readiness tier model. Integrated into the orchestrator `all` command.

## Files created

| File | Purpose |
| ---- | ------- |
| `tools/architecture/validate-slice-readiness/package.json` | Tool metadata with governance schema |
| `tools/architecture/validate-slice-readiness/src/index.mjs` | Validation logic |
| `tools/architecture/validate-slice-readiness/README.md` | Generated README |
| `tools/architecture/validate-slice-readiness/tests/validate-slice-readiness.test.mjs` | 7 unit tests |

## Validation rules

| Rule | Severity |
| ---- | -------- |
| `actionId` present | ERROR |
| `name` present | ERROR |
| `status` present and valid value | ERROR |
| `requiredReadinessTier` present and 0–4 | ERROR |
| `requiredCapabilities` — only known IDs | ERROR |
| `blockedBy` — ADR-ACT-NNNN format | ERROR |
| `forbiddenDependencies` — unrecognised values | WARN |

## Orchestrator integration

Added as `validate-slice-readiness` step in `buildStepCatalog()`. Included in `all` and
`validate-evidence` command plans, after `validate-lifecycle-evidence`.

## Gate updates

- `package.json`: `validate:slices` script added
- `Makefile`: `pre-slice-gate` calls `npm run validate:slices`

## Tests

7 unit tests in `tools/architecture/validate-slice-readiness/tests/validate-slice-readiness.test.mjs`:

1. Valid ADR-ACT-0008 manifest passes
2. Missing `requiredReadinessTier` fails
3. Invalid tier (5) fails
4. Unknown capability fails
5. Invalid blocker format fails
6. Missing status fails
7. Unrecognised forbidden dependency warns (not error)

## Gate compliance

- ADR-0024: Slice readiness tier model enforced by tooling
- ADR-0011: Tool follows orchestrator execution model
- ADR-0012: Tests use node:test; tool runs via spawn in self-evidence test
