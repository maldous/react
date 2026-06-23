# E2E observability correlation — staging

Generated (ADR-ACT-0285 Phase 3 + closure). DO NOT EDIT — regenerate via the e2e-observability-correlation make target.

- Result: **FULL**
- testRunId: `run-staging-1782186734-4e293d18`
- Loki: reachable
- Tempo: reachable (required)
- Total log lines: 474
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
| `persona-matrix:scaffold-system-admin` | false | true | 106 | OBSERVED |
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

- Correlated 474 line(s); all 8 required scenario(s) observed.
- Trace 7c4c2f1126f34e205e79ce095ea41c4c for 'pipeline-health-probe' matched in Tempo: services [platform-api].
- Trace 2c856dd9eaed45d757c200f4b4240f65 for 'browser-bff-trace' matched in Tempo: services [platform-api, react-enterprise-app].
