# E2E observability correlation — prod

Generated (ADR-ACT-0285 Phase 3 + closure). DO NOT EDIT — regenerate via the e2e-observability-correlation make target.

- Result: **FULL**
- testRunId: `run-prod-1782086061-a6496468`
- Loki: reachable
- Tempo: reachable (required)
- Total log lines: 357
- Required log scenarios: 9; missing: 0; unexpected observed: 0

## Per-scenario log correlation

| scenarioId | required | observed | lines | result |
| --- | --- | --- | --- | --- |
| `pipeline-health-probe` | true | true | 1 | OK |
| `clickability-crawl` | false | true | 3 | OBSERVED |
| `accessibility-safe-routes` | false | true | 19 | OBSERVED |
| `persona-authz` | true | true | 22 | OK |
| `browser-bff-trace` | true | true | 3 | OK |
| `persona-matrix:unauthenticated-visitor` | true | true | 38 | OK |
| `persona-matrix:scaffold-system-admin` | false | true | 91 | OBSERVED |
| `persona-matrix:scaffold-tenant-admin` | true | true | 50 | OK |
| `persona-matrix:scaffold-tenant-manager` | true | true | 34 | OK |
| `persona-matrix:scaffold-tenant-member` | true | true | 34 | OK |
| `persona-matrix:scaffold-support-breakglass` | false | true | 20 | OBSERVED |
| `persona-matrix:scaffold-disabled-user` | true | true | 26 | OK |
| `persona-matrix:scaffold-expired-session` | false | false | 0 | ABSENT |
| `persona-matrix:scaffold-cross-tenant` | true | true | 16 | OK |
| `persona-matrix:tenant-entitlement-disabled` | false | false | 0 | ABSENT |
| `persona-matrix:tenant-entitlement-enabled` | false | false | 0 | ABSENT |
| `persona-matrix:tenant-quota-limited` | false | false | 0 | ABSENT |
| `persona-matrix:tenant-rate-limited` | false | false | 0 | ABSENT |

## Tempo trace assertions

| scenarioId | traceId | found | services | route | result |
| --- | --- | --- | --- | --- | --- |
| `pipeline-health-probe` | `—` | true | platform-api | true | PASSED |
| `browser-bff-trace` | `—` | true | react-enterprise-app, platform-api | true | PASSED |

## Notes

- Correlated 357 line(s); all 9 required scenario(s) observed.
- Trace 0d6fb2cf97ecf85600428b352cc1df76 for 'pipeline-health-probe' matched in Tempo: services [platform-api].
- Trace ef698be4e1951bfe9706c39effb2be4f for 'browser-bff-trace' matched in Tempo: services [react-enterprise-app, platform-api].
