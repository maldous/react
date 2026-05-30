# Evidence: ADR-ACT-0123 ? i18n validation gate baseline

**Date:** 2026-05-29
**Status:** In Progress
**Action:** ADR-ACT-0123
**ADR Ref:** ADR-0026, ADR-0011

## Summary

`tools/architecture/validate-i18n` created with staged sub-checks per ADR-0026 ?Tooling.

## Sub-checks implemented

| Check | Status |
| ----- | ------ |
| Parse and flatten en-GB.json (nested ? dot-separated keys) | ? Done |
| Scan source for `t()` and `serverT()` key usage | ? Done |
| Report keys used in source missing from en-GB.json | ? Done |
| `--strict` flag: exits non-zero for missing keys (ADR-0011) | ? Done |
| Interpolation variable mismatch detection (inline calls) | ? Done |
| Non-default locale structure validation | ? Not yet |
| Hard-coded public copy detection (heuristic) | ? Not yet (always report-only per ADR-0026) |

## Orchestrator integration

Added as report-only step in orchestrator `all` command (`required=false`).
`--strict` is intentionally NOT passed to orchestrator ? strict promotion
is explicit per ADR-ACT-0123 once ADR-ACT-0121 and ADR-ACT-0122 complete.

## Tilt integration

`i18n-validation` local_resource added to Tiltfile (auto-trigger, report-only).

## Current scan result

The i18n-runtime test fixtures use keys like `this.key.does.not.exist` and
`test.msg` that do not appear in en-GB.json. These are intentional test
strings, not production code. The validation tool reports them as missing
and exits 0 (report-only mode).

## Promotion path

1. ADR-ACT-0121 (React text migration) ? add real production keys to en-GB.json
2. ADR-ACT-0122 (API message migration) ? add API/auth message keys
3. After both complete: promote orchestrator step to `required=true` and
   pass `--strict` to validate-i18n from orchestrator

## Deferrals

- Non-default locale structure matching (no non-default locales exist yet)
- Hard-coded copy detection always report-only (ADR-0026 ?Tooling)
- ADR-ACT-0124 (locale fallback/interpolation safety tests): Open
