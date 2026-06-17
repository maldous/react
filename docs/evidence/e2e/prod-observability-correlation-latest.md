# E2E observability correlation — prod

Generated (ADR-ACT-0285 Phase 3 + closure). DO NOT EDIT — regenerate via the e2e-observability-correlation make target.

- Result: **FULL**
- testRunId: `run-prod-1781704936-86331802`
- Loki: reachable
- Tempo: reachable (required)
- Total log lines: 387
- Required log scenarios: 8; missing: 0; unexpected observed: 0

## Per-scenario log correlation

| scenarioId | required | observed | lines | result |
| --- | --- | --- | --- | --- |
| `pipeline-health-probe` | true | true | 1 | OK |
| `clickability-crawl` | false | true | 3 | OBSERVED |
| `accessibility-safe-routes` | false | true | 22 | OBSERVED |
| `persona-authz` | true | true | 22 | OK |
| `persona-matrix:unauthenticated-visitor` | true | true | 38 | OK |
| `persona-matrix:scaffold-system-admin` | false | true | 129 | OBSERVED |
| `persona-matrix:scaffold-tenant-admin` | true | true | 42 | OK |
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
| `pipeline-health-probe` | `28038460f8b8cbf87e31f35d586e75bd` | true | platform-api | true | PASSED |

## Notes

- Correlated 387 line(s); all 8 required scenario(s) observed.
- Trace 28038460f8b8cbf87e31f35d586e75bd for 'pipeline-health-probe' matched in Tempo: services [platform-api], route true.
