# Evidence: ADR-ACT-0202 — Alloy label policy + test-env log ingestion

**Date:** 2026-06-10
**Status:** Done
**Action:** ADR-ACT-0202
**ADR Ref:** ADR-0035

## Scope

ADR-ACT-0202 asserted two problems: (1) `docker/alloy/config.alloy` promotes
high-cardinality Pino fields (requestId, durationMs, path, status, operationName,
method) to **Loki labels**, violating ADR-0035; and (2) the test environment does
not ingest platform-api logs into Loki ("only grafana/pgadmin appear") while prod
does. Both were investigated against the live `react-test` stack.

## Finding 1 — label policy was already compliant

The claim that high-cardinality fields are Loki labels is **inaccurate**. Since the
first commit of `config.alloy` (33d047f), `stage.labels` has only ever contained
`level`, `service`, `environment`; all high-cardinality fields were already in
`stage.structured_metadata` (queryable via `| json`, not indexed). The required
outcome was therefore already met.

Hardening applied:

- Added the missing `route` field to the JSON extraction + structured metadata
  (the BFF logs `route` in `routeMeta`; it belongs with `path`/`operationName`).
- Corrected the stale `ADR-0032` comment to `ADR-0035` and expanded the policy note.
- Added a label-cardinality guard to `scripts/smoke/loki-smoke.sh` that fails if
  any of `requestId traceId spanId actorId tenantId organisationId route path
  method status durationMs operationName errorCode` appears as a Loki label.

**Loki label set (test, verified):** `container, environment, level, platform,
service, service_name` — none of the forbidden high-cardinality fields are labels.
(`container`/`platform`/`service_name` are low-cardinality and intentional/auto.)

| Field set | Before | After |
| --------- | ------ | ----- |
| Loki labels (indexed) | service, environment, level (+ container, platform, service_name) | unchanged |
| Structured metadata (JSON) | requestId, traceId, spanId, actorId, tenantId, organisationId, operationName, method, path, status, durationMs, errorCode, errName | + **route** |

## Finding 2 — root cause of "test does not ingest platform-api logs"

**Not an Alloy discovery/compose/project/container-filter problem.** The test Alloy
correctly discovers `react-test` containers (`COMPOSE_PROJECT_FILTER=react-test`,
container `react-test-platform-api-1`, service `platform-api`) and ingestion works:
with a 24h Loki lookback, `service` values include `platform-api, postgres, redis,
keycloak, clickhouse, react-app, …`. The original "only grafana/pgadmin" observation
is an artifact of Loki's short **label-values lookback window** — grafana/pgadmin log
continuously, whereas platform-api is quiet between requests.

**Actual root cause:** `.env.test` set `LOG_LEVEL=warn` (confirmed on the running
container). `http.request.complete` is emitted at **`info`** (ADR-0035), so at `warn`
platform-api produces **no per-request log line** — `/healthz` yielded an
`x-request-id` but zero stdout log, so `loki-smoke.sh` could never find it. prod/staging
use `LOG_LEVEL=info`, which is why prod "ingests correctly". This is an environment
log-level misconfiguration, not an ingestion-pipeline defect.

Fix:

- The repo template `.env.example` already uses `LOG_LEVEL=debug` (emits `info`); a
  comment now documents that test/staging/prod must keep `LOG_LEVEL <= info` so
  request logs are searchable. `.env.*` files are gitignored/operator-managed —
  operators must set `.env.test` `LOG_LEVEL=info` (not `warn`).
- `loki-smoke.sh` now prints a precise diagnostic when no request log is found,
  naming the `LOG_LEVEL > info` cause.

## Verification (live, react-test, 2026-06-10)

Recreated `react-test-platform-api-1` at `LOG_LEVEL=info` and restarted
`react-test-alloy-1` with the updated config, then:

```text
$ bash scripts/smoke/loki-smoke.sh test
▶ loki-smoke (test): API=http://localhost:3002 LOKI=http://localhost:3101
  requestId = 4c8150e8-…
✓ loki-smoke: Loki has 1 platform-api line(s) with requestId 4c8150e8-…
  loki labels: container environment level platform service service_name
✓ loki-smoke: label cardinality OK — no high-cardinality fields are labels
```

- platform-api request logs ingest into **test** Loki. ✓
- A `requestId` is queryable via `{service="platform-api"} | json | requestId="…"`. ✓
- `route`, `path`, `status`, `durationMs` present as JSON fields on that line. ✓
- No high-cardinality field is a Loki label. ✓

## Remaining operator action

`.env.test` must use `LOG_LEVEL=info` (currently `warn` in the local env) for the
ingestion to persist across `make compose-up-web ENV=test`. The repo template,
the smoke diagnostic, and this evidence document the requirement; the value itself
lives in a gitignored env file outside version control.
