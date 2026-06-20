# E2E observability correlation — prod

Generated (ADR-ACT-0285 Phase 3 + closure). DO NOT EDIT — regenerate via the e2e-observability-correlation make target.

- Result: **FULL**
- testRunId: `run-prod-1781928221-7f266718`
- Loki: reachable
- Tempo: reachable (required)
- Total log lines: 365
- Required log scenarios: 9; missing: 0; unexpected observed: 0

## Per-scenario log correlation

| scenarioId | required | observed | lines | result |
| --- | --- | --- | --- | --- |
| `pipeline-health-probe` | true | true | 1 | OK |
| `clickability-crawl` | false | true | 3 | OBSERVED |
| `accessibility-safe-routes` | false | true | 22 | OBSERVED |
| `persona-authz` | true | true | 22 | OK |
| `browser-bff-trace` | true | true | 3 | OK |
| `persona-matrix:unauthenticated-visitor` | true | true | 38 | OK |
| `persona-matrix:scaffold-system-admin` | false | true | 104 | OBSERVED |
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
| `pipeline-health-probe` | `—` | true | platform-api | true | PASSED |
| `browser-bff-trace` | `—` | true | react-enterprise-app, platform-api | true | PASSED |

## Notes

- Correlated 365 line(s); all 9 required scenario(s) observed.
- Trace 973f49f3a38eb2a17da3a89221b7a1ff for 'pipeline-health-probe' matched in Tempo: services [platform-api].
- Trace 220d1722709f171bcf2b6801fda824aa for 'browser-bff-trace' matched in Tempo: services [react-enterprise-app, platform-api].
