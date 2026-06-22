# E2E observability correlation — staging

Generated (ADR-ACT-0285 Phase 3 + closure). DO NOT EDIT — regenerate via the e2e-observability-correlation make target.

- Result: **FULL**
- testRunId: `run-staging-1782125143-5d14b1a7`
- Loki: reachable
- Tempo: reachable (required)
- Total log lines: 389
- Required log scenarios: 8; missing: 0; unexpected observed: 0

## Per-scenario log correlation

| scenarioId | required | observed | lines | result |
| --- | --- | --- | --- | --- |
| `pipeline-health-probe` | true | true | 1 | OK |
| `clickability-crawl` | false | true | 3 | OBSERVED |
| `accessibility-safe-routes` | false | true | 22 | OBSERVED |
| `persona-authz` | true | true | 22 | OK |
| `browser-bff-trace` | true | true | 3 | OK |
| `persona-matrix:unauthenticated-visitor` | true | true | 38 | OK |
| `persona-matrix:scaffold-system-admin` | false | true | 120 | OBSERVED |
| `persona-matrix:scaffold-tenant-admin` | true | true | 50 | OK |
| `persona-matrix:scaffold-tenant-manager` | true | true | 34 | OK |
| `persona-matrix:scaffold-tenant-member` | true | true | 34 | OK |
| `persona-matrix:scaffold-support-breakglass` | false | true | 20 | OBSERVED |
| `persona-matrix:scaffold-disabled-user` | true | true | 26 | OK |
| `persona-matrix:scaffold-expired-session` | false | false | 0 | ABSENT |
| `persona-matrix:scaffold-cross-tenant` | false | true | 16 | OBSERVED |
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

- Correlated 389 line(s); all 8 required scenario(s) observed.
- Trace 58cbe23c5956defa47ca288c7fdb80c2 for 'pipeline-health-probe' matched in Tempo: services [platform-api].
- Trace b86e6c662d63159a22bd680ec0289531 for 'browser-bff-trace' matched in Tempo: services [react-enterprise-app, platform-api].
