# E2E observability correlation — prod

Generated (ADR-ACT-0285 Phase 3 + closure). DO NOT EDIT — regenerate via the e2e-observability-correlation make target.

- Result: **FULL**
- testRunId: `run-prod-1782184541-d6ab9ef3`
- Loki: reachable
- Tempo: reachable (required)
- Total log lines: 484
- Required log scenarios: 9; missing: 0; unexpected observed: 0

## Per-scenario log correlation

| scenarioId | required | observed | lines | result |
| --- | --- | --- | --- | --- |
| `pipeline-health-probe` | true | true | 1 | OK |
| `clickability-crawl` | false | true | 5 | OBSERVED |
| `accessibility-safe-routes` | false | true | 30 | OBSERVED |
| `persona-authz` | true | true | 32 | OK |
| `browser-bff-trace` | true | true | 4 | OK |
| `persona-matrix:unauthenticated-visitor` | true | true | 48 | OK |
| `persona-matrix:scaffold-system-admin` | false | true | 122 | OBSERVED |
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
| `browser-bff-trace` | `—` | true | react-enterprise-app, platform-api | true | PASSED |

## Notes

- Correlated 484 line(s); all 9 required scenario(s) observed.
- Trace 83b1c8fe188c21229d52b80cc2a5cc8e for 'pipeline-health-probe' matched in Tempo: services [platform-api].
- Trace 1537902f656e0a0dd8eb430074753bf8 for 'browser-bff-trace' matched in Tempo: services [react-enterprise-app, platform-api].
