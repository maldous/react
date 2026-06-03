# ADR-0034: Define per-environment test composition

## Status

Accepted

## Date

2026-05-30

## Decision owner

Architecture owner / technical lead

## Consulted

- ADR-0025: Platform E2E substrate baseline (Playwright strategy)
- ADR-0032: E2E testing strategy (internal/external split)
- ADR-0033: Environment-specific domain configuration (4-stage pipeline)

## Context

ADR-0032 established the internal/external split for E2E tests: internal tests use fixture sessions
against local environments, external tests use real auth against deployed stacks.

ADR-0033 defined the 4-stage promotion pipeline (`stage-dev` → `stage-test` → `stage-staging` →
`stage-prod`) with destructive and preserving data models.

However, neither ADR specifies **which tests run in which stage**. Currently all 4 stages run the
same test suite (`run-stage-tests` + external E2E smoke), which creates two problems:

1. **Dev runs external smoke tests** — external smoke tests (infrastructure health, SPA loading,
   security headers) are designed for deployed stacks. Running them against a Tilt dev environment
   tests the wrong layer. Dev should focus on internal fixture-based tests.
2. **Prod runs the same suite as staging** — the production stage deserves a more exhaustive test
   suite that goes beyond basic smoke and auth tests to cover security headers, asset integrity,
   performance budgets, and cross-cutting concerns.

The platform needs a clearly defined test composition per environment that reflects what each stage
is designed to validate.

## Decision

### 1. Test tiers

Tests are categorized into three tiers, each with a specific scope and environment audience:

| Tier       | Directory       | Config                          | Auth model      | Environments  |
| ---------- | --------------- | ------------------------------- | --------------- | ------------- |
| Internal   | `e2e/internal/` | `playwright.internal.config.ts` | Fixture session | Dev, Test     |
| External   | `e2e/external/` | `playwright.external.config.ts` | Real Keycloak   | Staging, Prod |
| Exhaustive | `e2e/prod/`     | `playwright.prod.config.ts`     | Real Keycloak   | Prod only     |

**Internal tests** (`e2e/internal/`):

- Use `LOCAL_FIXTURE_SESSION=tenant-admin` for deterministic actor state.
- Do not require Keycloak to be running.
- `smoke.test.ts` targets the Vite dev server (`localhost:5173`).
- `build.test.ts` targets `vite preview` production bundle (`localhost:4173`).
- **Common for dev and test** — both environments validate the same internal behaviour.
- Dev additionally serves as the **test creation** environment: new tests are authored and iterated
  against the Tilt fast feedback loop before being promoted to test.

**External tests** (`e2e/external/`):

- No `LOCAL_FIXTURE_SESSION` — every test exercises the real auth flow.
- Tests must skip gracefully if preconditions are not met (e.g., Keycloak not provisioned).
- `smoke.test.ts` checks infrastructure health and SPA loading without auth.
- Auth-dependent tests (`login.spec.ts`, `logout.spec.ts`, `auth-negative.spec.ts`,
  `caddy-links.spec.ts`) require `KEYCLOAK_TEST_PASSWORD` in the environment.
- **Common for staging and prod** — both validate the deployed stack end-to-end.

**Exhaustive tests** (`e2e/prod/`):

- Build on top of external tests — the prod stage runs both external and exhaustive suites.
- Cover production-specific concerns that go beyond functional verification:
  - Security headers (CSP, HSTS, X-Frame-Options, CORS)
  - Asset integrity (content hashing, bundle size budgets)
  - API contract compliance (response shapes, error format)
  - Cookie security (HttpOnly, SameSite, expiry)
  - Performance budgets (load time, first paint, page weight)
  - Cross-cutting observability (X-Request-Id, version metadata)
- **Prod-only** — the exhaustive suite is the final confidence gate before promotion.

### 2. Per-stage test composition

| Stage   | Data model  | Unit/component tests                         | Internal E2E      | External E2E               | Exhaustive E2E     |
| ------- | ----------- | -------------------------------------------- | ----------------- | -------------------------- | ------------------ | ----------------------------------- |
| Dev     | Destructive | ✅ `test:platform-api` + `test:frontend:run` | ✅ `e2e-internal` | ❌                         | ❌                 |
| Test    | Destructive | ✅ Same                                      | ✅ `e2e-internal` | ✅ `run-stage-e2e` (smoke) | ❌                 |
| Staging | Preserving  | ✅ Same                                      | ❌                | ✅ `e2e-external` (all)    | ❌                 |
| Prod    | Preserving  | ✅ Same                                      | ❌                | ✅ `e2e-external` (all)    | ✅ `test:e2e:prod` | #### Dev — internal + test creation |

- Runs unit/component tests (platform-api + frontend) to verify code-level correctness.
- Runs internal E2E (fixture session, Vite dev server) via `e2e-internal`.
- No external tests — dev is not a deployed stack.
- Dev is where new tests are **created and iterated** during development, before promoting code
  to the test stage.

#### Test — validation

- Runs the same unit/component tests.
- Runs internal E2E (common with dev) to confirm internal behaviour is preserved.
- Runs external smoke tests (`run-stage-e2e`) against the full Compose stack to validate
  the application works in a production-like container setup.
- External smoke tests confirm infrastructure health (healthz, readyz, version) and basic
  SPA loading against the deployed Compose stack.

#### Staging — integration

- Runs unit/component tests.
- Runs full external E2E suite (`e2e-external`) against the Cloudflare-deployed staging
  environment (`https://staging.aldous.info`).
- Validates login, logout, auth-negative, Caddy forward_auth, and smoke tests over real
  Cloudflare TLS.

#### Prod — exhaustive

- Runs unit/component tests.
- Runs full external E2E suite (`e2e-external`) against `https://aldous.info`.
- Runs exhaustive prod tests (`test:e2e:prod`) covering security headers, asset integrity,
  API contracts, cookie security, performance budgets, and cross-cutting concerns.
- This is the final confidence gate before declaring a release ready.

### 3. Playwright config naming convention

```text
playwright.internal.config.ts       — internal fixture tests (e2e/internal/)
playwright.build.config.ts          — internal build tests (e2e/internal/ via vite preview)
playwright.external.config.ts       — external E2E tests (e2e/external/)
playwright.prod.config.ts           — exhaustive prod tests (e2e/prod/)
```

No config targets multiple directories. Each config declares `testDir` scoped to its tier.

### 4. Makefile target mapping

| Make target                   | Config                          | Scope                                |
| ----------------------------- | ------------------------------- | ------------------------------------ |
| `e2e-internal`                | `playwright.internal.config.ts` | All internal tests (fixture session) |
| `e2e-internal-build`          | `playwright.build.config.ts`    | Production bundle internal tests     |
| `e2e-external`                | `playwright.external.config.ts` | All external tests (real auth)       |
| `e2e-external-smoke`          | `playwright.external.config.ts` | Smoke subset of external tests       |
| `e2e-external-auth`           | `playwright.external.config.ts` | Auth subset of external tests        |
| (via `npm run test:e2e:prod`) | `playwright.prod.config.ts`     | All exhaustive prod tests            |

### 5. Stage target implementation

Each stage target in `make/stages.mk` delegates to the policy-driven stage runner
(`scripts/stages/run-stage.sh`) which reads `env/stage-policy.yaml` to determine the
executor (Tilt or Compose), data policy, auth mode, teardown behaviour, and required
test groups for each environment:

```makefile
stage-dev:
    bash scripts/stages/run-stage.sh dev

stage-test:
    bash scripts/stages/run-stage.sh test

stage-staging:
    bash scripts/stages/run-stage.sh staging

stage-prod:
    bash scripts/stages/run-stage.sh prod
```

The policy file (`env/stage-policy.yaml`) defines per-environment configuration:

```yaml
# stage-policy.yaml — example structure
dev:
  executor: tilt
  dataPolicy: destructive
  authMode: fixture
  teardownDefault: true
  requiredTests:
    - e2e-smoke
    # plus others via run-env-tests.sh policy groups
```

The `run-stage.sh` script:

1. Reads policy for the target stage.
2. Sources the environment file (`.env.${STAGE}`).
3. Enforces policy guards (no fixture auth in staging/prod, no destructive ops in preserve stages).
4. Runs preflight checks.
5. Resets data (destructive stages) or preserves (preserving stages).
6. Starts the executor (Tilt) or Compose stack.
7. Waits for readiness.
8. Runs migrations and seed (destructive stages).
9. Executes test groups via `scripts/tests/run-env-tests.sh`, which reads the stage policy's
   `requiredTests` list and dispatches each group to the appropriate test runner.
10. Runs the E2E equivalent (`e2e-internal` for dev/test, `e2e-external` for staging/prod).
11. Tears down the stack (unless `teardownDefault: false` or `KEEP_STACKS_UP=true`).
12. Writes stage evidence to `docs/evidence/stages/`.

Test groups are dispatched by `scripts/tests/run-env-tests.sh` which receives the
stage name and a CSV of required test groups from the policy file:

| Test group      | Runner                                                                     | Stages        |
| --------------- | -------------------------------------------------------------------------- | ------------- |
| `unit`          | `npm run test:platform-api` + `npm run test:frontend:run`                  | Dev, Test     |
| `contract`      | `npm run test:architecture`                                                | Dev, Test     |
| `port`          | `node tools/architecture/validate-compose-ports/src/index.mjs`             | Dev, Test     |
| `interface`     | `bash scripts/smoke/compose-smoke.sh`                                      | Dev, Test     |
| `compose-smoke` | `npm run test:compose`                                                     | Dev, Test     |
| `integration`   | `make run-stage-tests`                                                     | Staging, Prod |
| `e2e-smoke`     | `make e2e-internal` (dev/test) or `make e2e-external-smoke` (staging/prod) | All           |

For dev and test stages, `e2e-smoke` runs internal fixture-based E2E tests via
`playwright.internal.config.ts`. For the test stage specifically, the script:

- Cleans up stale platform-api/Vite processes from previous stages.
- Uses separate ports (`PLATFORM_API_PORT=3012`, `APP_PORT=5183`) to avoid conflict
  with the Compose-started platform-api (on port 3002 for test).
- Passes `LOCAL_FIXTURE_SESSION=tenant-admin` to ensure fresh platform-api processes
  start with the correct fixture session configuration.

## Rationale

**Internal tests are not useful in staging/prod.** Staging and prod validate the deployed stack
against real Cloudflare traffic. Running fixture-based internal tests against these environments
would test the same code paths as external tests but with less fidelity.

**External tests are not useful in dev.** Dev uses Tilt with fixture sessions. External tests
require Keycloak to be running and test real auth flows, which Tilt doesn't provision. Running
external smoke tests against the Tilt stack tests infrastructure endpoints that are already
covered by unit tests.

**Prod deserves exhaustive tests.** By the time code reaches the prod stage, all functional tests
have passed in dev, test, and staging. What remains is production-specific quality verification:
security headers, performance budgets, asset integrity, and contract compliance. These tests
catch deployment-specific issues (missing headers, oversized bundles, relaxed cookie policies)
that no amount of functional testing can detect.

**No test/staging-specific test files needed at this time.** The existing internal tests cover
behaviour tested in both dev and test. The existing external tests cover staging and prod. Adding
environment-specific test files would duplicate coverage without catching additional failure modes.
Future environment-specific concerns (e.g., staging-specific rate limits, test-specific fixture
data) can be added as separate test files in the appropriate directory when needed.

## Consequences

- Dev no longer runs external smoke tests — only internal E2E + unit tests.
- Test runs both internal and external E2E, bridging the two tiers.
- Staging runs the full external suite (not just smoke).
- Prod adds the exhaustive `e2e/prod/` suite as the final gate.
- Each environment's test composition is explicitly documented, making it clear what confidence
  each stage provides.
- New test files must be placed in the correct tier directory (`internal/`, `external/`, or `prod/`)
  based on their auth model and environment scope.

## AI-assistance record

AI used: Yes

- Tool/model: DeepSeek V4 Flash
- Assistance scope: ADR drafting
- Human review status: Reviewed by architecture owner

## Validation / evidence

Evidence level: Decision — implementation evidence in Makefile stage targets and Playwright configs.

## Impacted areas

- Makefile: Update `stage-dev`, `stage-test`, `stage-staging`, `stage-prod` targets
- docs/adr/0032-e2e-testing-strategy.md: Update to mention `e2e/prod/` directory
- docs/adr/ACTION-REGISTER.md: Track implementation actions

### 6. Meta-test: pipeline composition validation

A meta-test (`validate-pipeline-composition`) validates that the Makefile stage targets
follow the ADR-0034 hierarchy. It is wired into the architecture governance orchestrator
as `validate-pipeline-composition` and runs as part of `make check` and `make all`.

The meta-test checks:

- Each stage target contains the required E2E test types (e.g., `e2e-internal` in dev/test,
  `e2e-external` in staging/prod, `test:e2e:prod` in prod).
- Each stage target does NOT contain forbidden test types (e.g., `e2e-external` in dev,
  `e2e-internal` in staging/prod).
- Non-decreasing test breadth from dev to prod (informational warning).

Validation rules:

| Stage   | Must contain                    | Must not contain                                 |
| ------- | ------------------------------- | ------------------------------------------------ |
| Dev     | `e2e-internal`                  | `e2e-external`, `test:e2e:prod`, `run-stage-e2e` |
| Test    | `e2e-internal`, `run-stage-e2e` | `$(MAKE) e2e-external`, `test:e2e:prod`          |
| Staging | `e2e-external`                  | `e2e-internal`, `test:e2e:prod`, `run-stage-e2e` |
| Prod    | `e2e-external`, `test:e2e:prod` | `e2e-internal`, `run-stage-e2e`                  |

This ensures the pipeline hierarchy is enforced by CI, not just convention.

## Follow-up actions

Follow-up actions tracked in `docs/adr/ACTION-REGISTER.md`.

## Review date

2026-08-30

## Supersedes

Extends ADR-0032 (E2E testing strategy) and ADR-0033 (environment configuration).

## Superseded by

None.

## References

- ADR-0025: Platform E2E substrate baseline
- ADR-0032: E2E testing strategy
- ADR-0033: Environment-specific domain configuration
- `e2e/internal/`, `e2e/external/`, `e2e/prod/` — E2E test directories
- `playwright.internal.config.ts`, `playwright.external.config.ts`, `playwright.prod.config.ts`
