# ADR-0034: Define per-environment test composition

## Status

Accepted — updated 2026-06-03 (persistent isolated progressive environment promotion)

## Date

2026-05-30

## Decision owner

Architecture owner / technical lead

## Consulted

- ADR-0025: Platform E2E substrate baseline (Playwright strategy)
- ADR-0032: E2E testing strategy (internal/external split)
- ADR-0033: Environment-specific domain configuration (apex domain, KC hostname per env)

## Context

ADR-0032 established the internal/external split for E2E tests: internal tests use fixture sessions
against local environments, external tests use real auth against deployed stacks.

ADR-0033 defined per-environment domain and hostname configuration (`.localhost` for dev/test,
`*.aldous.info` for staging/prod). The 4-stage promotion pipeline itself (`stage-dev` →
`stage-test` → `stage-staging` → `stage-prod`) emerged from the Makefile refactor
(ADR-ACT-0198) and is now governed by `env/stage-policy.yaml`.

However, neither ADR specifies **which tests run in which stage**. The platform needs a clearly
defined per-environment test composition that forms a progressive confidence ladder: each stage
must build on the confidence already established by the previous one, adding new dimensions of
verification appropriate to that environment's runtime characteristics.

## Decision

### 1. Core model — persistent isolated progressive environment promotion

All four environments run concurrently with fully isolated Docker project namespaces
(`react-dev`, `react-test`, `react-staging`, `react-prod`). They are started once via
`make env-up-all`, validated in order via `make promote`, and remain running after
`make all` completes. Isolation covers containers, volumes, networks, ports, databases,
Redis, ClickHouse, MinIO, Mailpit, Keycloak, SonarQube, Grafana, Loki, Alloy, Sentry,
WireMock, and Caddy routes. Use `make env-down-all` to stop everything when done.

Each stage validates what the previous stage cannot:

| Stage   | Docker project  | What it proves                                                               |
| ------- | --------------- | ---------------------------------------------------------------------------- |
| Dev     | `react-dev`     | The live development loop works. Code under active edit runs and tests pass. |
| Test    | `react-test`    | The built artefacts work in isolation. All local quality gates pass.         |
| Staging | `react-staging` | The deployed stack works end-to-end on real infrastructure (no tenants).     |
| Prod    | `react-prod`    | The tenant-bearing production environment is healthy and fully verified.     |

No environment is torn down after its stage completes. All `teardownDefault` values are
`false` in `env/stage-policy.yaml`. Destructive stages (dev, test) reset their database
data at the start of each validation run, then leave the environment running with the
freshly-validated state.

### 2. Test tiers

Tests are categorised into three tiers based on auth model and environment audience:

| Tier       | Directory       | Config                          | Auth model      | Used in       |
| ---------- | --------------- | ------------------------------- | --------------- | ------------- |
| Internal   | `e2e/internal/` | `playwright.internal.config.ts` | Fixture session | Dev, Test     |
| External   | `e2e/external/` | `playwright.external.config.ts` | Real Keycloak   | Staging, Prod |
| Exhaustive | `e2e/prod/`     | `playwright.prod.config.ts`     | Real Keycloak   | Prod only     |

**Internal tests** (`e2e/internal/`):

- Use `LOCAL_FIXTURE_SESSION=tenant-admin` for deterministic actor state.
- Do not require Keycloak to be running.
- `smoke.test.ts` targets the Vite dev server (`localhost:5173`).
- `build.test.ts` targets `vite preview` production bundle (`localhost:4173`).
- Common for dev and test. Dev is also the primary test-creation environment.

**External tests** (`e2e/external/`):

- No `LOCAL_FIXTURE_SESSION` — every test exercises the real auth flow.
- `smoke.test.ts` verifies infrastructure health and SPA loading without auth.
- Auth-dependent tests (`login.spec.ts`, `logout.spec.ts`, `auth-negative.spec.ts`,
  `caddy-links.spec.ts`) require `KEYCLOAK_TEST_PASSWORD` to be set.
- `tenant-prod.spec.ts` is scoped to the real production domain and skips if
  `isProd()` returns false.
- Common for staging and prod with different `PROD_BASE_URL` and auth provisioning.

**Exhaustive tests** (`e2e/prod/`):

- Build on top of external tests — prod runs both external smoke and exhaustive suites.
- Cover production-specific concerns: security headers, asset integrity, API contract
  compliance, cookie security, performance budgets, and cross-cutting observability.
- Prod-only. The exhaustive suite is the final confidence gate before declaring a release ready.

### 3. Per-stage test composition

| Stage   | Data policy | Auth mode | Test groups (policy order)                                                                                                        | E2E tier              |
| ------- | ----------- | --------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Dev     | Destructive | Fixture   | `minimal-smoke`, `unit`, `e2e-smoke`                                                                                              | Internal              |
| Test    | Destructive | Fixture   | `unit`, `contract`, `port`, `interface`, `compose-smoke`, `e2e-smoke`                                                             | Internal              |
| Staging | Preserve    | Real      | `integration`, `compose-smoke`, `external-smoke`                                                                                  | External smoke only   |
| Prod    | Preserve    | Real      | `unit`, `contract`, `port`, `interface`, `integration`, `tenant`, `compose-smoke`, `external-smoke`, `auth-e2e`, `production-e2e` | External + Exhaustive |

All test groups are defined in `env/stage-policy.yaml` and dispatched by
`scripts/tests/run-env-tests.sh`. Each group maps to a concrete runner (see §5).

#### Dev — live workflow validation

- **Executor:** Tilt (`tilt up`)
- **Data policy:** Destructive — volumes reset before and after.
- **Auth mode:** Fixture (`LOCAL_FIXTURE_SESSION=tenant-admin`).
- Verifies that the developer's live-edit loop produces a correct result.
- Runs `minimal-smoke` (HTTP health endpoints), `unit` (platform-api + frontend), and
  `e2e-smoke` (internal Playwright against the Tilt-served Vite dev server on `localhost:5173`).
- No external tests — dev is not a deployed stack.

#### Test — local quality confidence

- **Executor:** Compose (destructive — full stack rebuilt from scratch).
- **Auth mode:** Fixture.
- Runs the **full local test suite**: `unit` (254 platform-api + 26 frontend), `contract`
  (638 architecture + package), `port` (cross-env port conflict check), `interface` (Docker
  container reachability), `compose-smoke` (full integration smoke including DB resets), and
  `e2e-smoke` (internal Playwright with port isolation to avoid conflicts with the Compose API).
- Confirms that the built container artefacts produce the same result as the source.

#### Staging — integration on production-like infrastructure

- **Executor:** Compose (`dataPolicy: preserve`) — HA stack, no teardown.
- **Auth mode:** Real.
- **Explicit exclusions:** `tenant-data`, `destructive`, `production-customer-data` tests are
  permanently excluded. No tenant provisioning, no destructive database operations.
- Runs `integration` (API unit suite scoped to tests safe for a preserve environment),
  `compose-smoke` (infrastructure health only — no `resetDatabase()` calls), and
  `external-smoke` (14 Playwright tests via `make e2e-external-smoke` against
  `http://localhost:WEB_HTTP_PORT`).
- Auth-E2E tests are **not required** at staging. If `KEYCLOAK_TEST_PASSWORD` is set and
  Keycloak is provisioned, they can be run manually via `make test-real-auth`.

#### Prod — exhaustive tenant-bearing verification

- **Executor:** Compose (`dataPolicy: preserve`) — HA stack, no teardown.
- **Auth mode:** Real.
- Runs everything from test and staging, plus: `tenant` (FQDN routing, BFF isolation,
  sysadmin provisioning), `auth-e2e`, and `production-e2e` (`test:e2e:prod` via
  `playwright.prod.config.ts`).
- **`auth-e2e` must not silently skip.** If `PROD_BASE_URL` resolves to `localhost`, the
  stage fails with an actionable message. Prod requires real KC redirect flow. Options:
  run against real DNS (`PROD_BASE_URL=https://aldous.info make stage-prod`) or provision
  KC first (`make keycloak-provision ENV=prod`).

### 4. Playwright config naming convention

```text
playwright.internal.config.ts   — internal fixture tests (e2e/internal/)
playwright.build.config.ts      — internal build tests (e2e/internal/ via vite preview)
playwright.external.config.ts   — external E2E tests (e2e/external/)
playwright.prod.config.ts       — exhaustive prod tests (e2e/prod/)
```

No config targets multiple directories. Each config declares `testDir` scoped to its tier.

### 5. Policy-driven stage runner

Each Makefile stage target delegates to `scripts/stages/run-stage.sh`, which reads
`env/stage-policy.yaml`:

```makefile
stage-dev:     bash scripts/stages/run-stage.sh dev
stage-test:    bash scripts/stages/run-stage.sh test
stage-staging: bash scripts/stages/run-stage.sh staging
stage-prod:    bash scripts/stages/run-stage.sh prod
```

The policy file (`env/stage-policy.yaml`) is the single source of truth for each stage's
configuration. The current policy for reference:

```yaml
dev:
  executor: tilt
  dataPolicy: destructive
  authMode: fixture
  teardownDefault: false # remains running after stage-dev
  requiredTests: [minimal-smoke, unit, e2e-smoke]

test:
  executor: compose
  dataPolicy: destructive
  authMode: fixture
  teardownDefault: false # remains running after stage-test
  requiredTests: [unit, contract, port, interface, compose-smoke, e2e-smoke]

staging:
  executor: compose
  dataPolicy: preserve
  authMode: real
  teardownDefault: false
  requiredTests: [integration, compose-smoke, external-smoke]
  excludedTests: [tenant-data, destructive, production-customer-data]

prod:
  executor: compose
  dataPolicy: preserve
  authMode: real
  teardownDefault: false
  requiredTests:
    [
      unit,
      contract,
      port,
      interface,
      integration,
      tenant,
      compose-smoke,
      external-smoke,
      auth-e2e,
      production-e2e,
    ]
```

`run-stage.sh` execution sequence:

1. Parses stage policy via pure-awk YAML reader.
2. Sources `.env.${STAGE}`.
3. Enforces policy guards: `LOCAL_FIXTURE_SESSION` blocked for real-auth stages;
   `COOKIE_SECURE=false` blocked for staging/prod; destructive ops (reset, seed, volumes)
   blocked for preserve stages unless `ALLOW_PROD_MUTATION=true`.
4. Runs stage-scoped preflight checks.
5. Resets data (destructive stages) or skips (preserve stages).
6. Starts executor: Tilt for dev (idempotent — skips restart if already healthy); `default` + `web`
   Compose profiles for all others (idempotent — no-op if already running).
7. Waits for `/healthz` readiness.
8. Runs `db:migrate` (always) and `db:seed` (destructive stages only).
9. Dispatches test groups via `scripts/tests/run-env-tests.sh`.
10. **Does not tear down.** All `teardownDefault` values are `false`. The environment remains
    running for subsequent inspection, debugging, or re-validation.
11. Writes stage evidence to `docs/evidence/stages/${stage}-latest.json`.

Test group dispatch table (as implemented in `scripts/tests/run-env-tests.sh`):

| Group            | Runner                                                                   | Stages              |
| ---------------- | ------------------------------------------------------------------------ | ------------------- |
| `minimal-smoke`  | `bash scripts/smoke/http-smoke.sh`                                       | Dev                 |
| `unit`           | `npm run test:platform-api` + `NODE_ENV=test npm run test:frontend:run`  | Dev, Test, Prod     |
| `contract`       | `npm run test:architecture`                                              | Test, Prod          |
| `port`           | `node tools/architecture/validate-compose-ports/src/index.mjs`           | Test, Prod          |
| `interface`      | `bash scripts/smoke/compose-smoke.sh`                                    | Test, Prod          |
| `compose-smoke`  | `npm run test:compose` (with `DATA_POLICY=preserve` for staging/prod)    | Test, Staging, Prod |
| `integration`    | `make run-stage-tests ENV=$STAGE`                                        | Staging, Prod       |
| `e2e-smoke`      | `make e2e-internal` (dev/test, with port isolation for test)             | Dev, Test           |
| `external-smoke` | `PROD_BASE_URL=http://localhost:WEB_HTTP_PORT make e2e-external-smoke`   | Staging, Prod       |
| `tenant`         | `PROD_BASE_URL=... npx playwright test e2e/external/tenant-prod.spec.ts` | Prod                |
| `auth-e2e`       | `make e2e-external-auth` — **fails hard if localhost on prod**           | Prod                |
| `production-e2e` | `PROD_BASE_URL=... npm run test:e2e:prod`                                | Prod                |

**`unit` group note:** For staging and prod (preserve, no `LOCAL_FIXTURE_SESSION`), `run-stage-tests`
selects the test subset appropriate for the environment:

- Prod (`NODE_ENV=production` in `.env.prod`): runs the full 254-test `test:platform-api` suite.
  The fixture organisation must exist in the prod database.
- Staging: runs `test:platform-api:unit-safe` (206 tests) which excludes substrate tests that
  require the fixture organisation, since staging's database is never seeded with fixture data.

**`compose-smoke` group note:** When `DATA_POLICY=preserve`, `compose-smoke.test.mjs` skips
all calls to `resetDatabase()` and tests that assert clean-state row counts. Infrastructure
health checks (postgres, redis, minio, mailpit, otel, clickhouse, pgadmin) still run.

**`auth-e2e` failure semantics:**

- Staging: graceful skip with log message if `PROD_BASE_URL` is localhost. Auth E2E is not
  required for staging.
- Prod: hard `exit 1` if `PROD_BASE_URL` is localhost. Prod cannot silently drop required
  auth confidence gates.

### 6. Makefile lifecycle targets

The following targets manage the persistent multi-environment topology:

| Target         | Purpose                                                                        |
| -------------- | ------------------------------------------------------------------------------ |
| `env-up-all`   | Start all four environments (`react-dev/test/staging/prod`) and leave running  |
| `env-down-all` | Stop all four environments                                                     |
| `env-status`   | Show container health for all four environments                                |
| `promote`      | Run the full confidence ladder (stage-dev → prod) without teardown             |
| `make all`     | `preflight` + `quality` + `env-up-all` + `promote` + `evidence` + `env-status` |

`make all` is idempotent: if environments are already running from a previous run,
`env-up-all` is a no-op (Compose `up` is idempotent; Tilt startup checks `/healthz`
before restarting). `promote` then re-runs validation against the live stacks.

### 7. Meta-test: pipeline composition validation

`validate-pipeline-composition` (part of `make check` and `make all`) validates that the
Makefile stage recipe comments follow the ADR-0034 hierarchy. The validator reads
`make/stages.mk` and all `make/*.mk` included files.

The validator checks recipe comments for required and forbidden strings, then verifies that
test breadth is non-decreasing from dev to prod.

Current rules:

| Stage   | Must contain                      | Must not contain                                 |
| ------- | --------------------------------- | ------------------------------------------------ |
| Dev     | `e2e-internal`                    | `e2e-external`, `test:e2e:prod`, `run-stage-e2e` |
| Test    | `e2e-internal`, `run-stage-tests` | `$(MAKE) e2e-external`, `test:e2e:prod`          |
| Staging | `external-smoke`                  | `e2e-internal`, `test:e2e:prod`, `run-stage-e2e` |
| Prod    | `external-smoke`, `test:e2e:prod` | `e2e-internal`, `run-stage-e2e`                  |

Breadth counter (for hierarchy progression check):

- `e2e-internal` in recipe comment → +1 (internal E2E tier)
- `e2e-external`, `external-smoke`, or `run-stage-e2e` in recipe comment → +1 (external E2E tier)
- `test:e2e:prod` in recipe comment → +1 (exhaustive tier)

Expected non-decreasing sequence: dev(1) ≤ test(1) ≤ staging(1) ≤ prod(2).

**Important:** The validator checks recipe comments, not runtime behaviour. The comments must
accurately describe what `run-stage.sh` will do, enforced by the comment style in `make/stages.mk`.
The validator intentionally checks comments because the stage runner is policy-driven — the
Makefile recipe is a one-liner `bash scripts/stages/run-stage.sh $STAGE`.

## Rationale

**Internal tests are not appropriate in staging/prod.** Fixture sessions bypass the auth
pipeline. Running them against deployed stacks would test less-realistic code paths and require
`LOCAL_FIXTURE_SESSION` to be allowed — which the policy guards explicitly block for real-auth
stages.

**External tests are not appropriate in dev.** Dev uses Tilt with a fixture session.
External tests require a provisioned Keycloak realm and real redirect flow. Tilt does not
provision the platform KC realm by default.

**Staging is tenant-free by policy.** Tenant provisioning and deletion are destructive
operations. Staging excludes `tenant-data`, `destructive`, and `production-customer-data`
test groups to prevent accidental data mutation on the staging stack.

**Prod auth-e2e cannot skip silently.** By the time code reaches prod, auth tests have had
multiple opportunities to be verified (explicitly via `make test-real-auth`). If `auth-e2e`
cannot run at the prod stage it means a required precondition (KC realm provisioning, real DNS)
is not satisfied. Skipping silently would mean prod passed without verifying its authentication
layer — a category of failure the pipeline must surface, not absorb.

**The confidence ladder is additive.** Prod does not merely repeat earlier stages. It adds
tenant verification (FQDN routing, BFF isolation, sysadmin provisioning), auth E2E (login, logout,
auth-negative, Caddy forward_auth), and exhaustive prod tests (security headers, asset integrity,
API contracts, cookie security, performance budgets). These gates are only meaningful on a
tenant-bearing prod-configured stack.

**Persistent environments enable realistic inspection.** Because environments remain running after
`make all`, developers can inspect the live state of each environment, run ad-hoc queries, replay
requests against a known-good stack, and diff behaviour across environments. This is not possible
when environments are torn down immediately after validation.

## Consequences

- All four environments run concurrently under isolated Docker project names.
  No shared container names, volume names, network names, or ports.
- All `teardownDefault` values are `false`. Environments persist after `make all` completes.
- Dev runs `minimal-smoke` + `unit` + `e2e-internal` (via `e2e-smoke`). No external tests.
- Test runs the full local quality suite: all 254 platform-api tests, 638 architecture tests,
  port validation, interface smoke, integration smoke (with DB resets), and internal E2E.
- Staging runs integration (unit-safe subset) + infrastructure smoke (preserve mode) +
  external smoke (14 Playwright tests). No auth E2E, no tenant operations, no DB resets.
- Prod runs the full suite. `auth-e2e` hard-fails if KC redirect flow cannot run.
- Each stage's composition is declared in `env/stage-policy.yaml` and enforced by
  `validate-pipeline-composition`. Changing the composition requires both a policy change and
  a comment update in `make/stages.mk`.
- `compose-smoke.test.mjs` must check `DATA_POLICY` before calling `resetDatabase()`.
  This guard is already implemented.
- New test files must be placed in the correct tier directory (`e2e/internal/`, `e2e/external/`,
  or `e2e/prod/`) based on their auth model and environment scope.
- `preflight` does not check clean state. All four environments may be running when
  `make all` starts. Use `make env-down-all` to stop everything, then `make clean-all` if a
  fully fresh start is needed.

## History

- 2026-05-30: Accepted — initial per-stage composition decision.
- 2026-06-03 (first update): Aligned with policy-driven pipeline (ADR-ACT-0198):
  - Composition declared in `env/stage-policy.yaml`, not inline Makefile targets.
  - Dev gains `e2e-smoke` (e2e-internal via Tilt servers).
  - Staging composition tightened; external smoke not full `e2e-external` suite.
  - Prod `auth-e2e` hard-fails on localhost.
  - Staging tenant/destructive exclusions made explicit.
  - Meta-test rules updated to `external-smoke` naming.
- 2026-06-03 (second update): Persistent isolated progressive environment promotion:
  - All four environments run concurrently under `react-dev/test/staging/prod` project names.
  - `teardownDefault: false` for dev and test (previously `true`).
  - `docker/compose-wrapper.sh` now uses `--project-name "react-$ENV"`.
  - All project label filters updated to `react-$ENV` across shell scripts.
  - Port conflict checker validates all 6 concurrent pairs (was only 2).
  - `scripts/tilt/up-dev.sh` is idempotent (skips restart if already healthy).
  - New lifecycle targets: `env-up-all`, `env-down-all`, `env-status`, `promote`.
  - `make all` = preflight + quality + env-up-all + promote + evidence + env-status.
  - `preflight` no longer checks clean state (stale containers are expected).

## AI-assistance record

AI used: Yes

- Tool/model: Claude Sonnet 4.6
- Assistance scope: ADR update to align with implemented pipeline
- Human review status: Reviewed by architecture owner

## Validation / evidence

Evidence level: Implementation — validated by `make check` (validate-pipeline-composition)
and stage run evidence in `docs/evidence/stages/`.

Validation commands:

```bash
# Meta-test passes
node tools/architecture/validate-pipeline-composition/src/index.mjs

# Dev stage includes e2e-internal
make stage-dev

# Unknown policy group fails hard
bash scripts/tests/run-env-tests.sh staging "typo_group" "" 2>&1; echo "exit: $?"

# Staging skips auth-e2e gracefully
bash scripts/tests/run-env-tests.sh staging "auth-e2e" "" 2>&1

# Prod fails auth-e2e on localhost
bash scripts/tests/run-env-tests.sh prod "auth-e2e" "" 2>&1; echo "exit: $?"

# Full ladder
make all
```

## Impacted areas

- `env/stage-policy.yaml` — canonical test group declarations (authoritative source)
- `scripts/stages/run-stage.sh` — stage runner reading policy
- `scripts/tests/run-env-tests.sh` — test group dispatcher
- `make/stages.mk` — stage recipe comments (checked by meta-test)
- `tools/architecture/validate-pipeline-composition/src/index.mjs` — meta-test rules
- `tests/integration/compose-smoke.test.mjs` — `DATA_POLICY` guard for `resetDatabase()`

## Follow-up actions

Follow-up actions tracked in `docs/adr/ACTION-REGISTER.md`.

## Review date

2026-09-03

## Supersedes

Extends ADR-0032 (E2E testing strategy) and ADR-0033 (environment domain configuration).

## Superseded by

None.

## References

- ADR-0025: Platform E2E substrate baseline
- ADR-0032: E2E testing strategy (internal/external split)
- ADR-0033: Environment-specific domain and hostname configuration
- `env/stage-policy.yaml` — per-stage policy definitions
- `scripts/stages/run-stage.sh` — policy-driven stage runner
- `scripts/tests/run-env-tests.sh` — test group dispatcher
- `e2e/internal/`, `e2e/external/`, `e2e/prod/` — E2E test directories
