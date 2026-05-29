# Developer Platform Baseline Audit

**Date:** 2026-05-29 (updated after corrections)
**Status:** Corrections applied — see phase tracking below.

## Compose profiles

| Profile | Services | Status |
| ------- | -------- | ------ |
| (default) | postgres, redis, clickhouse, minio, mailpit, otel-collector | ✅ Running |
| web | platform-api, react-app (Caddy) | ✅ Running |
| quality | sonarqube, sonar-postgres | ✅ Available |
| identity | keycloak, keycloak-postgres | ✅ Available |
| cloud-mocks | localstack | ✅ Available |
| external-mocks | wiremock | ✅ Added (ADR-ACT-0131) |
| sentry | sentry-web, workers, db | ✅ Available (experimental) |

## Make targets

| Target | Status |
| ------ | ------ |
| compose-up-default | ✅ |
| compose-up-web | ✅ |
| compose-up-quality | ✅ |
| compose-up-identity | ✅ |
| compose-up-cloud | ✅ |
| compose-up-external-mocks | ✅ |
| compose-up-sentry | ✅ |
| reset-local | ✅ Added |
| seed-demo | ✅ Added |
| db-shell | ✅ Added |
| redis-flush-local | ✅ Added |

## Compose validation

| Item | Status |
| ---- | ------ |
| compose:config (default) | ✅ |
| compose:config:all (all 6 profiles) | ✅ Fixed — web + external-mocks added |

## E2E modes

| Mode | Config | Status |
| ---- | ------ | ------ |
| Dev (fixture session) | playwright.config.ts | ✅ |
| Production build | playwright.prod.config.ts | ✅ |
| Live (aldous.info) | playwright.aldous.config.ts | ✅ |

## Tilt status

| Item | Status |
| ---- | ------ |
| ADR-0027 (Tilt feedback loop) | ✅ Accepted |
| Tiltfile at repo root | ✅ Implemented (ADR-ACT-0127 Done) |
| ADR-ACT-0127 (fast-dev) | ✅ Done |
| ADR-ACT-0128 (production parity) | ⚠️ In Progress — prod-build-and-test exists; Compose web-profile containers deferred |
| ADR-ACT-0129 (impact checks) | ⚠️ In Progress — i18n-validation added; full dependency mapping deferred |
| ADR-ACT-0130 (docs/evidence) | Open (depends on 0129) |

## i18n status

| Item | Status |
| ---- | ------ |
| ADR-0026 (i18n model) | ✅ Accepted |
| packages/i18n-runtime | ✅ Created (ADR-ACT-0120 Done) |
| Nested JSON support (flattenLocaleMessages) | ✅ Fixed |
| React provider/hook | ⚠️ Placeholder only (src/react.ts — full hook deferred to ADR-ACT-0121) |
| ADR-ACT-0120 (runtime baseline) | ✅ Done (with noted deferral) |
| ADR-ACT-0121 (React text migration) | Open |
| ADR-ACT-0122 (API message migration) | Open |
| ADR-ACT-0123 (validation gate) | ⚠️ In Progress — report-only, in orchestrator |
| ADR-ACT-0124 (tests/evidence) | Open |

## API contract status

| Item | Status |
| ---- | ------ |
| ADR-0013 (GraphQL primary boundary) | ✅ Accepted |
| REST supplementary routes (OpenAPI 3.1) | ✅ docs/api/openapi.json |
| OpenAPI drift validation | ❌ Not yet (ADR-ACT-0139 Open) |

## Mock/external service status

| Item | Status |
| ---- | ------ |
| WireMock service | ✅ external-mocks profile |
| docker/wiremock/mappings/ | ✅ |
| docker/wiremock/__files/ | ✅ |
| ADR-ACT-0132 (contract tests) | Open |

## Dev Container status

| Item | Status |
| ---- | ------ |
| .devcontainer/devcontainer.json | ✅ Pinned feature versions, Tilt + Keycloak ports |
| post-create.sh | ✅ Includes Tilt install |
| ADR-ACT-0134 | ✅ Done |

## Dependency automation status

| Item | Status |
| ---- | ------ |
| renovate.json | ✅ Added (conservative, no automerge) |
| Dependency update policy | ✅ docs/security/dependency-update-policy.md |
| ADR-ACT-0136 | ✅ Done |

## Local cookie security (web Compose profile)

| Item | Status |
| ---- | ------ |
| SESSION_COOKIE_SECURE default | ✅ Fixed — was hardcoded true; now `${SESSION_COOKIE_SECURE:-false}` |
| .env.example documents setting | ✅ |

## Local development docs

| File | Status |
| ---- | ------ |
| docs/local-development/compose-services.md | ✅ |
| docs/local-development/README.md | ✅ |
| docs/local-development/tilt-workflow.md | ✅ |
| docs/local-development/reset-and-fixtures.md | ✅ |
