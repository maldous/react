# Developer Platform Baseline Audit

**Date:** 2026-05-29
**Status:** In progress — see phase tracking below.

## Compose profiles

| Profile | Services | Status |
| --- | --- | --- |
| (default) | postgres, redis, clickhouse, minio, mailpit, otel-collector | ✅ Running |
| web | platform-api, react-app (Caddy) | ✅ Running |
| quality | sonarqube, sonar-postgres | ✅ Available |
| identity | keycloak, keycloak-postgres | ✅ Available |
| cloud-mocks | localstack | ✅ Available |
| external-mocks | wiremock | ✅ Added (ADR-ACT-0131) |
| sentry | sentry-web, workers, db | ✅ Available (experimental) |

## Make targets

| Target | Status |
| --- | --- |
| compose-up-default | ✅ |
| compose-up-web | ✅ |
| compose-up-quality | ✅ |
| compose-up-identity | ✅ |
| compose-up-cloud | ✅ |
| compose-up-external-mocks | ✅ |
| compose-up-sentry | ✅ |
| reset-local | ❌ Missing |
| seed-demo | ❌ Missing |
| db-shell | ❌ Missing |
| redis-flush-local | ❌ Missing |

## E2E modes

| Mode | Config | Status |
| --- | --- | --- |
| Dev (fixture session) | playwright.config.ts | ✅ |
| Production build | playwright.prod.config.ts | ✅ |
| Live (aldous.info) | playwright.aldous.config.ts | ✅ |

## Tilt status

| Item | Status |
| --- | --- |
| ADR-0027 (Tilt feedback loop) | ✅ Accepted |
| Tiltfile at repo root | ❌ Not yet implemented |
| ADR-ACT-0127 (fast-dev) | Open |
| ADR-ACT-0128 (production parity) | Open |
| ADR-ACT-0129 (impact checks) | Open |
| ADR-ACT-0130 (docs/evidence) | Open |

## i18n status

| Item | Status |
| --- | --- |
| ADR-0026 (i18n model) | ✅ Accepted |
| packages/i18n-runtime | ❌ Not yet created |
| ADR-ACT-0120 (runtime baseline) | Open |
| ADR-ACT-0121 (React text migration) | Open |
| ADR-ACT-0122 (API message migration) | Open |
| ADR-ACT-0123 (validation gate) | Open |
| ADR-ACT-0124 (tests/evidence) | Open |

## API contract status

| Item | Status |
| --- | --- |
| ADR-0013 (GraphQL primary boundary) | ✅ Accepted |
| REST supplementary routes documented | ❌ No docs/api/ |
| OpenAPI spec for REST routes | ❌ Not yet |
| ADR/action for OpenAPI | ❌ Not registered |

## Mock/external service status

| Item | Status |
| --- | --- |
| WireMock service | ✅ external-mocks profile |
| docker/wiremock/mappings/ | ✅ |
| docker/wiremock/__files/ | ✅ |
| ADR-ACT-0132 (contract tests) | Open |

## Dev Container status

| Item | Status |
| --- | --- |
| .devcontainer/devcontainer.json | ❌ Missing |
| ADR/action | ❌ Not registered |

## Dependency automation status

| Item | Status |
| --- | --- |
| renovate.json | ❌ Missing |
| Dependency update policy | ❌ Not documented |

## Reset/demo data status

| Item | Status |
| --- | --- |
| make reset-local | ❌ Missing |
| make seed-demo | ❌ Missing |
| Idempotency docs | ❌ Missing |

## Local development docs

| File | Status |
| --- | --- |
| docs/local-development/compose-services.md | ✅ |
| docs/local-development/README.md | ❌ Missing |
| docs/local-development/tilt-workflow.md | ❌ Missing |
| docs/local-development/reset-and-fixtures.md | ❌ Missing |

## Next steps (ordered by dependency)

1. Task 0: This audit ← current
2. Task 2: Dev Container
3. Task 3: Tilt fast-dev mode (ADR-ACT-0127)
4. Task 4: Tilt production parity (ADR-ACT-0128)
5. Task 5: i18n runtime (ADR-ACT-0120)
6. Task 6: i18n validation gate (ADR-ACT-0123)
7. Task 7: API contract surface
8. Task 8: Dependency automation
9. Task 9: Reset/demo data
10. Task 10: Developer docs index
