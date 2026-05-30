# Evidence: ADR-ACT-0124 ? i18n runtime correctness

**Date:** 2026-05-29
**Status:** Done
**Action:** ADR-ACT-0124
**ADR Ref:** ADR-0026, ADR-ACT-0120

## Summary

Added runtime-level coverage for the key behaviour that ADR-0026 depends on:

- locale fallback from a non-default locale to `en-GB`
- interpolation safety for rendered values
- preservation of provided values without introducing markup
- strict validation failure when a used `en-GB` key is missing

## Coverage

- `packages/i18n-runtime/tests/i18n-runtime.test.ts`
- `tools/architecture/validate-i18n/tests/validate-i18n.test.mjs`

## Notes

The validation tool remains report-only by default. The strict-mode failure is
covered through a dedicated fixture repo in the test suite.
