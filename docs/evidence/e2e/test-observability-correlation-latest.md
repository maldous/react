# E2E observability correlation — test

Generated (ADR-ACT-0285 Phase 3 + closure). DO NOT EDIT — regenerate via the e2e-observability-correlation make target.

- Result: **FULL**
- testRunId: `run-test-1781752233-a39df920`
- Loki: reachable
- Tempo: reachable (required)
- Total log lines: 18
- Required log scenarios: 7; missing: 0; unexpected observed: 0

## Per-scenario log correlation

| scenarioId | required | observed | lines | result |
| --- | --- | --- | --- | --- |
| `pipeline-health-probe` | true | true | 1 | OK |
| `internal-smoke` | false | false | 0 | ABSENT |
| `clickability-crawl` | false | false | 0 | ABSENT |
| `accessibility-safe-routes` | false | false | 0 | ABSENT |
| `persona-authz` | true | true | 4 | OK |
| `browser-bff-trace` | true | true | 1 | OK |
| `persona-matrix:unauthenticated-visitor` | true | true | 4 | OK |
| `persona-matrix:fixture-tenant-admin` | true | true | 2 | OK |
| `persona-matrix:fixture-viewer` | true | true | 4 | OK |
| `persona-matrix:fixture-no-membership` | true | true | 2 | OK |

## Tempo trace assertions

| scenarioId | traceId | found | services | route | result |
| --- | --- | --- | --- | --- | --- |
| `pipeline-health-probe` | `—` | true | platform-api | true | PASSED |
| `browser-bff-trace` | `—` | true | react-enterprise-app, platform-api | true | PASSED |

## Notes

- Correlated 18 line(s); all 7 required scenario(s) observed.
- Trace d6c0b063cd3695eac7accdb8df8d25aa for 'pipeline-health-probe' matched in Tempo: services [platform-api].
- Trace d3ff722a83bb1f5b567ca3a98eedebe2 for 'browser-bff-trace' matched in Tempo: services [react-enterprise-app, platform-api].
