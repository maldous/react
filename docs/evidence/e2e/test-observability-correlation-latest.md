# E2E observability correlation — test

Generated (ADR-ACT-0285 Phase 3 + closure). DO NOT EDIT — regenerate via the e2e-observability-correlation make target.

- Result: **FULL**
- testRunId: `run-test-1782183762-bf26192e`
- Loki: reachable
- Tempo: reachable (required)
- Total log lines: 46
- Required log scenarios: 7; missing: 0; unexpected observed: 0

## Per-scenario log correlation

| scenarioId | required | observed | lines | result |
| --- | --- | --- | --- | --- |
| `pipeline-health-probe` | true | true | 1 | OK |
| `internal-smoke` | false | false | 0 | ABSENT |
| `clickability-crawl` | false | false | 0 | ABSENT |
| `accessibility-safe-routes` | false | false | 0 | ABSENT |
| `persona-authz` | true | true | 10 | OK |
| `browser-bff-trace` | true | true | 1 | OK |
| `persona-matrix:unauthenticated-visitor` | true | true | 10 | OK |
| `persona-matrix:fixture-tenant-admin` | true | true | 10 | OK |
| `persona-matrix:fixture-viewer` | true | true | 8 | OK |
| `persona-matrix:fixture-no-membership` | true | true | 6 | OK |

## Tempo trace assertions

| scenarioId | traceId | found | services | route | result |
| --- | --- | --- | --- | --- | --- |
| `pipeline-health-probe` | `—` | true | platform-api | true | PASSED |
| `browser-bff-trace` | `—` | true | react-enterprise-app, platform-api | true | PASSED |

## Notes

- Correlated 46 line(s); all 7 required scenario(s) observed.
- Trace 9f8dd86d22eb3000a54398306e38cfd3 for 'pipeline-health-probe' matched in Tempo: services [platform-api].
- Trace 2f51a16592c8c1f0c26273cd21818e07 for 'browser-bff-trace' matched in Tempo: services [react-enterprise-app, platform-api].
