# e2e-sentry-assertion (ADR-ACT-0285 Phase 5.5)

Proves a controlled synthetic failure is **captured by self-hosted Sentry and
queryable by API** with the correct correlation metadata. Part of the E2E
confidence ladder (ADR-0075); runs under `make all` at the `test`/`staging`/`prod`
stages via `env/stage-policy.yaml` → `scripts/tests/run-env-tests.sh`.

## What it does

1. POSTs `/internal/e2e/trigger-failure` with `x-e2e-test-run-id` / `x-e2e-scenario-id`
   headers (the endpoint stays invisible/404 unless `E2E_FAILURE_ENDPOINT_ENABLED=true`,
   and in prod also needs `E2E_ALLOW_PROD_SYNTHETIC_FAILURE=true`).
2. Queries the self-hosted Sentry API (`/api/0/projects/<org>/<project>/issues/`
   → `/api/0/issues/<id>/events/latest/`) for the event tagged with that `testRunId`.
3. Asserts the event carries `environment`, `release` (when configured), and the
   `requestId` / `trace_id` / `testRunId` / `scenarioId` tags. In prod it also runs a
   no-unexpected-events gate.

## Result semantics (honest ladder)

- **PASSED** — Sentry reachable, event present with correct metadata.
- **FAILED** (exit 1, blocks `make all`) — Sentry reachable but the event is missing
  or has wrong metadata (or, in prod, unexpected events appeared).
- **DEGRADED** (exit 0) — the Sentry API / trigger endpoint is not configured or not
  reachable for the stage. Keeps `make all` green where Sentry capture is not wired.

Evidence: `docs/evidence/e2e/<stage>-sentry-events-latest.{json,md}`.

## Config (resolved from `.env/<stage>.env`, generated from the manifests)

| Key                   | Source                            | Notes                                                 |
| --------------------- | --------------------------------- | ----------------------------------------------------- |
| `SENTRY_API_BASE_URL` | `config/environments/common.json` | self-hosted Sentry root, e.g. `http://localhost:9060` |
| `SENTRY_ORG_SLUG`     | `config/environments/common.json` | default `sentry`                                      |
| `SENTRY_PROJECT_SLUG` | `config/environments/common.json` | default `react-sentry`                                |
| `SENTRY_API_TOKEN`    | runtime-provisioned secret        | **empty until minted** (see below)                    |

Tunables (env): `SENTRY_ASSERT_INGEST_WAIT_MS`, `SENTRY_ASSERT_POLL_ATTEMPTS`,
`SENTRY_ASSERT_POLL_INTERVAL_MS`, `SENTRY_ASSERT_API_URL`, `E2E_TEST_RUN_ID`,
`E2E_SCENARIO_ID`.

## One-time token bootstrap (for a live PASS)

`SENTRY_API_TOKEN` is runtime-provisioned (like `SONAR_TOKEN`) — empty until an
operator mints it, so the assertion DEGRADES honestly rather than failing when it is
absent. To enable a live PASS on a stage:

1. Bring up the `external-sentry` compose profile and log into the Sentry UI
   (`SENTRY_ADMIN_EMAIL` / `SENTRY_ADMIN_PASSWORD`).
2. Create the `react-sentry` project (org slug `sentry`) and point the platform-api at
   it: set `SENTRY_ENABLED=true` and a real `SENTRY_DSN` for the stage.
3. Mint an **internal-integration / auth token** with `event:read`+`project:read`
   scope; seed it into the stage secret material as `SENTRY_API_TOKEN`
   (`.env/secrets/<stage>.env` → `make env-seed-secrets`). Never commit the token.
4. Enable the trigger endpoint for the run: `E2E_FAILURE_ENDPOINT_ENABLED=true`
   (prod also needs `E2E_ALLOW_PROD_SYNTHETIC_FAILURE=true`).

The token is sent only in the `Authorization` header and is never written to evidence
or logs.
