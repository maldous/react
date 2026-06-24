# E2E observability correlation — staging

Generated (ADR-ACT-0285 Phase 3 + closure). DO NOT EDIT — regenerate via the e2e-observability-correlation make target.

- Result: **FULL**
- testRunId: `run-staging-1782312050-d75d7cd5`
- Loki: reachable
- Tempo: reachable (required)
- Total log lines: 497
- Required log scenarios: 8; missing: 0; unexpected observed: 0

## Per-scenario log correlation

| scenarioId | required | observed | lines | result |
| --- | --- | --- | --- | --- |
| `pipeline-health-probe` | true | true | 1 | OK |
| `clickability-crawl` | false | true | 5 | OBSERVED |
| `accessibility-safe-routes` | false | true | 36 | OBSERVED |
| `persona-authz` | true | true | 32 | OK |
| `browser-bff-trace` | true | true | 4 | OK |
| `persona-matrix:unauthenticated-visitor` | true | true | 48 | OK |
| `persona-matrix:scaffold-system-admin` | false | true | 129 | OBSERVED |
| `persona-matrix:scaffold-tenant-admin` | true | true | 64 | OK |
| `persona-matrix:scaffold-tenant-manager` | true | true | 46 | OK |
| `persona-matrix:scaffold-tenant-member` | true | true | 46 | OK |
| `persona-matrix:scaffold-support-breakglass` | false | true | 28 | OBSERVED |
| `persona-matrix:scaffold-disabled-user` | true | true | 36 | OK |
| `persona-matrix:scaffold-expired-session` | false | false | 0 | ABSENT |
| `persona-matrix:scaffold-cross-tenant` | false | true | 22 | OBSERVED |
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

- Correlated 497 line(s); all 8 required scenario(s) observed.
- Trace 4436149eaa4c00a1561d47ccf4152210 for 'pipeline-health-probe' matched in Tempo: services [platform-api].
- Trace a497790a700a339d9ad48fd55822569d for 'browser-bff-trace' matched in Tempo: services [platform-api, react-enterprise-app].
