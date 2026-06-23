# E2E observability correlation — prod

Generated (ADR-ACT-0285 Phase 3 + closure). DO NOT EDIT — regenerate via the e2e-observability-correlation make target.

- Result: **FULL**
- testRunId: `run-prod-1782190782-a278af13`
- Loki: reachable
- Tempo: reachable (required)
- Total log lines: 473
- Required log scenarios: 9; missing: 0; unexpected observed: 0

## Per-scenario log correlation

| scenarioId | required | observed | lines | result |
| --- | --- | --- | --- | --- |
| `pipeline-health-probe` | true | true | 1 | OK |
| `clickability-crawl` | false | true | 5 | OBSERVED |
| `accessibility-safe-routes` | false | true | 36 | OBSERVED |
| `persona-authz` | true | true | 32 | OK |
| `browser-bff-trace` | true | true | 4 | OK |
| `persona-matrix:unauthenticated-visitor` | true | true | 48 | OK |
| `persona-matrix:scaffold-system-admin` | false | true | 105 | OBSERVED |
| `persona-matrix:scaffold-tenant-admin` | true | true | 64 | OK |
| `persona-matrix:scaffold-tenant-manager` | true | true | 46 | OK |
| `persona-matrix:scaffold-tenant-member` | true | true | 46 | OK |
| `persona-matrix:scaffold-support-breakglass` | false | true | 28 | OBSERVED |
| `persona-matrix:scaffold-disabled-user` | true | true | 36 | OK |
| `persona-matrix:scaffold-expired-session` | false | false | 0 | ABSENT |
| `persona-matrix:scaffold-cross-tenant` | true | true | 22 | OK |
| `persona-matrix:tenant-entitlement-disabled` | false | false | 0 | ABSENT |
| `persona-matrix:tenant-entitlement-enabled` | false | false | 0 | ABSENT |
| `persona-matrix:tenant-quota-limited` | false | false | 0 | ABSENT |
| `persona-matrix:tenant-rate-limited` | false | false | 0 | ABSENT |

## Tempo trace assertions

| scenarioId | traceId | found | services | route | result |
| --- | --- | --- | --- | --- | --- |
| `pipeline-health-probe` | `—` | true | platform-api | true | PASSED |
| `browser-bff-trace` | `—` | true | platform-api, react-enterprise-app | true | PASSED |

## Notes

- Correlated 473 line(s); all 9 required scenario(s) observed.
- Trace 95691925fc5b2ef6789ab023963dda25 for 'pipeline-health-probe' matched in Tempo: services [platform-api].
- Trace 8a8936c2438bea18ee7862dc07fc88fb for 'browser-bff-trace' matched in Tempo: services [platform-api, react-enterprise-app].
