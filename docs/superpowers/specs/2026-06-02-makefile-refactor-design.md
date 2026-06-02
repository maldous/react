# Makefile Refactor — Professional Staged Platform Orchestration

**Date:** 2026-06-02  
**Status:** Approved  
**ADR coverage:** ADR-0027 (Tilt), ADR-0033 (env/domain), ADR-0034 (per-env test composition)

---

## Goal

Refactor the 1,008-line `Makefile` into a professional staged platform orchestration system without removing any existing functionality. `make all` must exercise the full platform through dev → test → staging → production with increasing confidence while preventing environment drift.

---

## File Structure

```text
Makefile                          ← single user entrypoint; only includes + top-level targets
make/
  core.mk                         ← variables, macros, colour helpers
  tools.mk                        ← install, format, lint, typecheck
  env.mk                          ← env-validate-all, env-drift-check
  clean.mk                        ← clean, clean-all
  quality.mk                      ← test, test-compose, audit, security, compose,
                                     architecture, sonar, advisory, sbom, license
  compose.mk                      ← all compose-up-*, compose-down-*, compose-ps,
                                     compose-logs, external-caddy-*, dev-up,
                                     dev-up-minimal, test-up, staging-up, prod-up,
                                     *-down, reset-local, seed-demo, db-migrate,
                                     db-shell, redis-flush-local
  tilt.mk                         ← tilt-up, tilt-down wrappers (used by stages.mk)
  test.mk                         ← run-stage-tests, e2e-internal, e2e-internal-build,
                                     test-real-auth
  e2e.mk                          ← e2e-external-smoke, e2e-external-auth, e2e-external,
                                     dev-e2e, dev-e2e-auth, test-e2e, staging-e2e, prod-e2e
  stages.mk                       ← preflight, stage-dev, stage-test, stage-staging,
                                     stage-prod, run-stage-e2e
  evidence.mk                     ← evidence (aggregates stage results)
  help.mk                         ← help, keycloak-provision, infra-check,
                                     keycloak-plan-dev, readmes, generate,
                                     pre-slice-gate, local-substrate-check

scripts/
  preflight/
    check-binaries.sh             ← node, npm, npx, docker, tilt, terraform/tofu,
                                     curl, jq, git, ss/lsof
    check-docker.sh               ← daemon up, compose plugin v2
    check-env-files.mjs           ← all 4 .env.* exist, required keys present,
                                     no prod defaults in prod
    check-port-conflicts.mjs      ← no cross-env port collisions
    check-hosts.mjs               ← aldous.info, staging.aldous.info resolve
                                     (warn-only if unreachable)
    check-clean-state.mjs         ← no stale containers from previous runs
    check-env-drift.mjs           ← staging/prod constraints vs policy
  clean/
    clean-env.sh                  ← stop services, kill port holders, remove artefacts
    assert-clean.sh               ← verify ports free, containers gone
  compose/
    up.sh                         ← ENV-scoped compose-up with retry logic
    down.sh                       ← ENV-scoped compose-down with CONFIRM_DOWN
    wait.sh                       ← poll /healthz until healthy or timeout
  tilt/
    up-dev.sh                     ← background tilt up, write PID, poll healthz+5173
    down-dev.sh                   ← read PID, tilt down, wait, remove .tilt.pid
  stages/
    run-stage.sh                  ← policy-driven stage runner (see below)
  smoke/
    http-smoke.sh                 ← curl healthz/readyz/version
    compose-smoke.sh              ← compose service reachability checks
    observability-smoke.sh        ← Loki/Grafana/Alloy health checks
  tests/
    run-env-tests.sh              ← select and run test groups from policy
  evidence/
    write-stage-evidence.mjs      ← write docs/evidence/stages/<stage>-latest.json

env/
  stage-policy.yaml               ← per-stage executor, dataPolicy, authMode,
                                     teardownDefault, requiredTests, excludedTests
```

---

## Top-Level Makefile

```makefile
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := all

include make/core.mk
include make/tools.mk
include make/env.mk
include make/clean.mk
include make/quality.mk
include make/compose.mk
include make/tilt.mk
include make/test.mk
include make/e2e.mk
include make/stages.mk
include make/evidence.mk
include make/help.mk

.PHONY: all
all: preflight \
     quality \
     env-validate-all \
     env-drift-check \
     stage-dev \
     stage-test \
     stage-staging \
     stage-prod \
     evidence
```

Only `all`, `.PHONY` for cross-file targets, and the include list live in the root Makefile. All implementation lives in `make/*.mk`.

---

## make/core.mk

Contains everything currently in the Makefile's variable block:

- `ENV ?= dev`, `STAGE ?= $(ENV)`
- `COMPOSE_PROJECT_NAME := react-$(ENV)`
- `ENV_FILE := .env.$(ENV)`
- `STAGE_POLICY := env/stage-policy.yaml`
- `COMPOSE_CMD = docker/compose-wrapper.sh $(ENV)`
- `PRESERVE_JVM_VOLUMES ?= true`
- `BOLD`, `GREEN`, `BLUE`, `YELLOW`, `RED`, `RESET` colour variables
- `STEP`, `OK`, `WARN`, `SKIP` macros
- `ORCHESTRATOR` shorthand
- `JVM_PORTS_EXCLUDE` shell fragment
- `CONN_URLS` define block
- `CONFIRM_DOWN`, `CONFIRM_PORT_FREE`, `CONFIRM_VOLUME_GONE` define blocks

No targets live here — only variables and macros.

---

## make/clean.mk

Extracts the `clean` and `clean-all` recipes verbatim. The embedded shell logic in `clean` moves to `scripts/clean/clean-env.sh` and `scripts/clean/assert-clean.sh`:

```makefile
clean:
    $(call STEP,clean: $(ENV))
    bash scripts/clean/clean-env.sh $(ENV)
    bash scripts/clean/assert-clean.sh $(ENV)
    $(call OK,clean complete for $(ENV))
```

`clean-env.sh` receives ENV as `$1` and contains the current logic for:

- Stopping all compose profiles for that env
- Force-removing containers by project label
- Killing stale port-holding processes via `fuser`
- Removing artefacts (`coverage/`, `reports/`, `.scannerwork/`, etc.)

`assert-clean.sh` receives ENV as `$1` and contains:

- `CONFIRM_DOWN` equivalent for the env's project
- Port-free verification loop for all `_PORT=` values in `.env.$1`

---

## make/compose.mk

All existing compose targets preserved exactly. Each `compose-up-*` becomes a thin wrapper that delegates to the scripts:

```makefile
compose-up-default:
    $(call STEP,compose:up:default ($(ENV)))
    bash scripts/compose/up.sh $(ENV) default
    $(call OK,default services healthy for $(ENV))

compose-up-identity:
    $(call STEP,compose:up:identity ($(ENV)))
    bash scripts/compose/up.sh $(ENV) identity
    $(call OK,Keycloak ready for $(ENV))
```

`scripts/compose/up.sh <ENV> <PROFILE>` encapsulates the retry logic currently embedded in `compose-up-default`. `scripts/compose/down.sh <ENV>` encapsulates `compose-down` + `CONFIRM_DOWN`.

All existing targets are preserved as-is or as one-line wrappers:

- `compose-up`, `compose-up-default`, `compose-up-quality`, `compose-up-identity`
- `compose-up-cloud`, `compose-up-sentry`, `compose-up-external-mocks`
- `compose-up-web`, `compose-up-observability`
- `compose-down`, `compose-down-web`, `compose-down-volumes`, `compose-down-reset`
- `compose-ps`, `compose-logs`
- `external-caddy-up`, `external-caddy-down`
- `dev-up`, `dev-up-minimal`, `test-up`, `staging-up`, `prod-up`
- `dev-down`, `test-down`, `staging-down`, `prod-down`
- `reset-local`, `seed-demo`, `db-migrate`, `db-shell`, `redis-flush-local`

---

## make/stages.mk

```makefile
.PHONY: preflight stage-dev stage-test stage-staging stage-prod run-stage-e2e

preflight:
    $(call STEP,preflight)
    bash scripts/preflight/check-binaries.sh
    bash scripts/preflight/check-docker.sh
    node scripts/preflight/check-env-files.mjs
    node scripts/preflight/check-port-conflicts.mjs
    node scripts/preflight/check-hosts.mjs
    node scripts/preflight/check-clean-state.mjs
    $(call OK,preflight passed)

stage-dev:
    $(call STEP,stage:dev)
    bash scripts/stages/run-stage.sh dev

stage-test:
    $(call STEP,stage:test)
    bash scripts/stages/run-stage.sh test

stage-staging:
    $(call STEP,stage:staging)
    bash scripts/stages/run-stage.sh staging

stage-prod:
    $(call STEP,stage:prod)
    bash scripts/stages/run-stage.sh prod

run-stage-e2e:
    $(call STEP,run-stage-e2e ($(ENV)))
    @_url="$$(grep -oP 'APP_BASE_URL=\K\S+' .env.$(ENV) 2>/dev/null | head -1)"; \
    _url=$${_url:-http://localhost}; \
    PROD_BASE_URL="$$_url" \
    npx playwright test --config playwright.external.config.ts e2e/external/smoke.test.ts
    $(call OK,stage E2E passed for $(ENV))
```

---

## scripts/stages/run-stage.sh

Full execution contract (STAGE=$1):

```text
1.  Load env/stage-policy.yaml — parse STAGE block for:
      executor, dataPolicy, authMode, teardownDefault,
      requiredTests[], excludedTests[]

2.  Source .env.$STAGE

3.  Policy guards (exit 1 if violated):
      authMode=real → assert LOCAL_FIXTURE_SESSION is unset
      dataPolicy=preserve → assert reset-local/seed are not being called
      STAGE=staging|prod → assert COOKIE_SECURE != "false"

4.  scripts/preflight/check-binaries.sh (stage-scoped: skip tilt check for compose stages)

5.  dataPolicy=destructive:
        make compose-down-reset ENV=$STAGE
      dataPolicy=preserve:
        (no teardown, stack may already be running)

6.  Start executor:
      tilt   → bash scripts/tilt/up-dev.sh
      compose → bash scripts/compose/up.sh $STAGE web

7.  bash scripts/compose/wait.sh $STAGE (polls /healthz, 120s timeout)

8.  npm run db:migrate
    dataPolicy=destructive → npm run db:seed

9.  bash scripts/tests/run-env-tests.sh $STAGE
      (reads requiredTests[], excludedTests[], runs each group,
       logs skipped groups with reason)

10. Run E2E equivalent:
      dev/test  → make e2e-internal
      staging   → make e2e-external PROD_BASE_URL=https://staging.aldous.info
      prod      → make e2e-external PROD_BASE_URL=https://aldous.info
                  npm run test:e2e:prod

11. Capture exit code → $STAGE_RESULT

12. teardownDefault=true:
      tilt   → bash scripts/tilt/down-dev.sh
               make compose-down-reset ENV=$STAGE
      compose → make compose-down-reset ENV=$STAGE
    teardownDefault=false: no teardown

13. node scripts/evidence/write-stage-evidence.mjs $STAGE $STAGE_RESULT $START_TS

14. exit $STAGE_RESULT
```

---

## scripts/tilt/up-dev.sh

```text
1. tilt up &
2. echo $! > .tilt.pid
3. _api_port from .env.dev PLATFORM_API_PORT (default 3001)
4. Poll curl http://localhost:$_api_port/healthz (120s timeout, 2s interval)
   On timeout or tilt crash: call down-dev.sh, exit 1
5. Poll curl http://localhost:5173/ (120s timeout, 2s interval)
   On timeout: call down-dev.sh, exit 1
6. exit 0
```

## scripts/tilt/down-dev.sh

```text
1. Read PID from .tilt.pid (if missing: warn and try pgrep)
2. tilt down
3. wait $PID (suppress errors)
4. Poll pgrep -f tilt until gone (30s timeout)
5. rm -f .tilt.pid
6. exit 0
```

---

## env/stage-policy.yaml

```yaml
dev:
  executor: tilt
  dataPolicy: destructive
  buildMode: live
  authMode: fixture
  tenants: none
  teardownDefault: true
  requiredTests:
    - minimal-smoke
    - unit

test:
  executor: compose
  dataPolicy: destructive
  buildMode: containers
  authMode: fixture
  tenants: none
  teardownDefault: true
  requiredTests:
    - unit
    - contract
    - port
    - interface
    - compose-smoke
    - e2e-smoke

staging:
  executor: compose
  dataPolicy: preserve
  buildMode: production
  authMode: real
  tenants: none
  teardownDefault: false
  requiredTests:
    - integration
    - compose-smoke
    - external-smoke
    - e2e-smoke
  excludedTests:
    - tenant-data
    - destructive
    - production-customer-data

prod:
  executor: compose
  dataPolicy: preserve
  buildMode: production
  authMode: real
  tenants: real
  teardownDefault: false
  requiredTests:
    - unit
    - contract
    - port
    - interface
    - integration
    - tenant
    - compose-smoke
    - external-smoke
    - auth-e2e
    - production-e2e
```

---

## Test Group Mapping (scripts/tests/run-env-tests.sh)

| Group                 | Command                                                                    |
| --------------------- | -------------------------------------------------------------------------- |
| `minimal-smoke`       | `bash scripts/smoke/http-smoke.sh`                                         |
| `unit`                | `npm run test:platform-api && npm run test:frontend:run`                   |
| `contract`            | `npm run test:architecture`                                                |
| `port`                | `node tools/architecture/validate-compose-ports/src/index.mjs`             |
| `interface`           | `bash scripts/smoke/compose-smoke.sh`                                      |
| `compose-smoke`       | `npm run test:compose`                                                     |
| `integration`         | `make run-stage-tests ENV=$STAGE`                                          |
| `tenant`              | `npx playwright test ... e2e/external/tenant-prod.spec.ts`                 |
| `e2e-smoke`           | `make e2e-internal` (dev/test) or `make e2e-external-smoke` (staging/prod) |
| `external-smoke`      | `make e2e-external-smoke`                                                  |
| `auth-e2e`            | `make e2e-external-auth`                                                   |
| `production-e2e`      | `npm run test:e2e:prod`                                                    |
| `observability-smoke` | `bash scripts/smoke/observability-smoke.sh`                                |

---

## make/env.mk

```makefile
env-validate-all:
    $(call STEP,env-validate-all)
    node scripts/preflight/check-env-files.mjs --all
    $(call OK,all env files valid)

env-drift-check:
    $(call STEP,env-drift-check)
    node scripts/preflight/check-env-drift.mjs
    $(call OK,no env drift detected)
```

`check-env-drift.mjs` asserts for all env files:

- staging/prod: `LOCAL_FIXTURE_SESSION` must be absent
- staging/prod: `COOKIE_SECURE` must not be `false`
- staging/prod: `LOG_LEVEL` must be `info` or `warn`
- each stage: `APEX_DOMAIN` matches expected value from policy
- each stage: ports unique across concurrently-runnable envs

---

## Evidence

`scripts/evidence/write-stage-evidence.mjs` writes:

```text
docs/evidence/stages/
  dev-latest.json
  test-latest.json
  staging-latest.json
  prod-latest.json
```

Each file:

```json
{
  "stage": "dev",
  "gitSha": "<git rev-parse --short HEAD>",
  "timestamp": "<ISO 8601>",
  "envFile": ".env.dev",
  "composeProject": "react-dev",
  "profiles": ["default"],
  "dataPolicy": "destructive",
  "testGroupsRun": ["minimal-smoke", "unit"],
  "testGroupsSkipped": [],
  "e2eCommand": "make e2e-internal",
  "urlsChecked": ["http://localhost:3001/healthz", "http://localhost:5173/"],
  "result": "passed",
  "durationSeconds": 142,
  "failureSummary": null
}
```

`make evidence` aggregates all four latest files into `docs/evidence/stages/summary.json`.

---

## Target Preservation

Every target listed in the spec is preserved. Targets that move to a `.mk` file keep the same name. Compatibility aliases are added where any target is renamed:

```makefile
# None needed — all names are stable.
```

`check`, `ci`, `full`, and `fix` are preserved in `make/quality.mk` exactly as they exist today.

---

## Hard Safety Rules (enforced in run-stage.sh)

| Rule                                            | Enforcement                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| `reset-local` blocked in staging/prod           | `run-stage.sh` checks dataPolicy; exits 1 if preserve + destructive op |
| `compose-down-volumes` blocked in staging/prod  | Same dataPolicy guard                                                  |
| `LOCAL_FIXTURE_SESSION` blocked in staging/prod | Policy guard step 3                                                    |
| `COOKIE_SECURE=false` blocked in staging/prod   | `check-env-drift.mjs` + policy guard                                   |
| No seed in staging/prod                         | `dataPolicy=preserve` skips seed in step 8                             |
| Production mutations require guard var          | `ALLOW_PROD_MUTATION=true` required for any write op in prod stage     |

---

## Definition of Done

- `make help` lists all user-facing targets
- All existing target names work unchanged
- `make all` runs preflight → quality → env-validate → env-drift → 4 stages → evidence
- Dev uses Tilt + minimal-smoke + unit
- Test builds containers, runs unit/contract/port/interface/compose-smoke/e2e-smoke
- Staging runs integration/compose-smoke/external-smoke/e2e-smoke (no tenant/destructive)
- Prod runs all production-safe test groups + production-e2e
- Destructive operations blocked at staging/prod by policy guard
- All compose walkthrough targets present
- Complex shell logic lives in scripts/, not in Make recipes
- Stage results produce evidence files
- `make help` output readable enough to understand the platform lifecycle
