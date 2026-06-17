# E2E observability correlation — test

Generated (ADR-ACT-0285 Phase 3 + closure). DO NOT EDIT — regenerate via the e2e-observability-correlation make target.

- Result: **FULL**
- testRunId: `run-test-1781704174-7bba3124`
- Loki: reachable
- Tempo: reachable (required)
- Total log lines: 17
- Required log scenarios: 6; missing: 0; unexpected observed: 0

## Per-scenario log correlation

| scenarioId | required | observed | lines | result |
| --- | --- | --- | --- | --- |
| `pipeline-health-probe` | true | true | 1 | OK |
| `internal-smoke` | false | false | 0 | ABSENT |
| `clickability-crawl` | false | false | 0 | ABSENT |
| `accessibility-safe-routes` | false | false | 0 | ABSENT |
| `persona-authz` | true | true | 4 | OK |
| `persona-matrix:unauthenticated-visitor` | true | true | 4 | OK |
| `persona-matrix:fixture-tenant-admin` | true | true | 2 | OK |
| `persona-matrix:fixture-viewer` | true | true | 4 | OK |
| `persona-matrix:fixture-no-membership` | true | true | 2 | OK |

## Tempo trace assertions

| scenarioId | traceId | found | services | route | result |
| --- | --- | --- | --- | --- | --- |
| `pipeline-health-probe` | `27af743f456d70b36dc2941e83f52556` | true | platform-api | true | PASSED |

## Notes

- Correlated 17 line(s); all 6 required scenario(s) observed.
- Trace 27af743f456d70b36dc2941e83f52556 for 'pipeline-health-probe' matched in Tempo: services [platform-api], route true.
