# CLAUDE.md

This file is mandatory operating guidance for Claude Code in this repository.

Claude must behave like a local developer. Use the local development environment, inspect runtime state, watch logs, run the Makefile gates, and keep ADR governance accurate.

## Session startup is mandatory

At the start of every session:

```bash
pwd
git status --short
git log --oneline --decorate -5
npm ci
make compose-up-default
make compose-ps
make check
```

If Docker is unavailable, say so and continue with non-Docker gates. Do not silently skip Compose-dependent work.

If the task touches runtime behaviour, also start the feedback loop:

```bash
tilt up
```

Use Tilt as the normal local development control plane. It owns the inner loop for this repo.

## Runtime awareness

Before changing app, API, auth, i18n, Compose, Tilt, or E2E behaviour, inspect current runtime state:

```bash
make compose-ps
docker compose logs --tail=120 postgres redis mailpit otel-collector
curl -fsS http://localhost:3001/healthz || true
curl -fsS http://localhost:3001/readyz || true
curl -fsS http://localhost:5173/ || true
```

When using Tilt, use the Tilt UI and resource logs. Do not develop blind.

Useful local URLs:

Direct (dev server / port-mapped):

```text
React dev              http://localhost:5173
platform-api health    http://localhost:3001/healthz
platform-api session   http://localhost:3001/api/session
Keycloak admin         http://localhost:8090/kc/admin   (dev; per-env 8090–8093, ADR-ACT-0157)
Mailpit UI             http://localhost:8025
MinIO console          http://localhost:9001
SonarQube              http://localhost:9064/sonar
WireMock admin         http://localhost:8089/__admin/   (direct-port only — NOT exposed via Caddy)
ClickHouse play        http://localhost:8124/play
Tilt UI                http://localhost:10350
```

Via Caddy (aldous.info super-global ? requires `make compose-up-web`):

```text
App (super-admin)      http://aldous.info
Keycloak all-realms    http://aldous.info/kc
Mailpit (global)       http://aldous.info/mailpit
SonarQube              http://aldous.info/sonar
MinIO console          http://aldous.info/minio
Sentry (global)        http://aldous.info/sentry
Grafana                http://aldous.info/grafana
pgAdmin                http://aldous.info/pgadmin
ClickHouse             http://aldous.info/clickhouse/play
```

LocalStack is profile-gated (`cloud-mocks`, dev/test only) and is NOT linked via
Caddy in production (`devOnly` / `forbiddenInProduction` — the click-through link is
locked there; see `service-clickthrough.ts`). WireMock is direct-port only (no Caddy
route). Mailpit and Sentry are global-only services — they are NOT served per-tenant.

Per-tenant (via Caddy, requires /etc/hosts or DNS):

```text
App                    http://{slug}.aldous.info
Keycloak realm admin   http://{slug}.aldous.info/kc
```

## Production awareness

Before claiming production behaviour, check the live smoke suite:

```bash
make e2e-prod
```

If network access or browser dependencies are unavailable, say so and do not claim live production verification.

## Preferred development loop

Use this loop for normal work:

```bash
make compose-up-default
tilt up
# make the change
npm run test:platform-api
npm run test:frontend:run
npm run test:e2e
make check
```

For production-build risk:

```bash
make e2e-dev-build
```

For full baseline:

```bash
make all
```

## Makefile is canonical

Prefer Make targets over ad hoc commands.

Key targets:

```bash
make help
make check
make all
make release-confidence
make fix
make clean
make compose-up-default
make compose-up-identity
make compose-up-external-mocks
make compose-up-web
make compose-ps
make compose-logs
make reset-local
make seed-demo
make db-migrate
make db-shell
make redis-flush-local
make readmes
```

`make check` is the minimum normal gate after code or governance changes (fast; no Sonar, no compose smoke).

`make all` is the **authoritative full-confidence command**: it runs the dev → test → staging → prod
confidence ladder, and its **test stage runs the Sonar absolute-zero quality gate** (`make sonar`, via
`scripts/stages/run-stage.sh` §9 — test-stage only, the gating stage before promotion). So a green
`make all` already proves the Sonar gate passed; **Sonar runs exactly once** in the ladder.
`make release-confidence` is a discoverable alias for `make all` (it does NOT append a second `make sonar`
— that would re-scan). Keep `make check` fast — never add Sonar to it (ADR-ACT-0290 / ADR-ACT-0291).

## Compose services

Default Compose services:

```text
postgres redis clickhouse minio mailpit otel-collector
```

Profiles:

```text
external-sonar   SonarQube (shared instance, react-sonar project)
identity         Keycloak
cloud-mocks      LocalStack
external-sentry  Sentry (shared instance, react-sentry project)
web              platform-api container + Caddy React SPA
external-mocks   WireMock
```

Validate all profiles after Compose changes:

```bash
npm run compose:config
npm run compose:config:all
```

WireMock is available through:

```bash
make compose-up-external-mocks
curl -fsS http://localhost:${WIREMOCK_PORT:-8089}/__admin/health
```

Do not commit real payloads, secrets, tokens, cookies, or production/customer samples into WireMock mappings.

## Tilt

`Tiltfile` is the local fast-development loop (ADR-0027).

Use `tilt up` for active development. Use manual Tilt resources for slower checks such as E2E and live smoke.

Do not claim full Tilt production parity until the Compose `web` profile containers are wired as Tilt production resources. Check `docs/adr/ACTION-REGISTER.md` for current status.

## Testing commands

```bash
npm run test:architecture
npm run test:platform-api
npm run test:frontend:run
npm run test:compose
npm run test:e2e
npm run test:e2e:prod
npm run test:coverage
```

Node test does not expand globs. Use package scripts.

## Architecture governance

Run the orchestrator for architecture-sensitive changes:

```bash
node tools/architecture/orchestrator/src/index.mjs all --no-reports --strict
```

The orchestrator includes package metadata, import boundaries, generated README checks, inventory, lifecycle evidence, slice readiness, and i18n validation.

## i18n

ADR-0026 governs public-facing text. Check `docs/adr/ACTION-REGISTER.md` for current migration status.

Do not claim the React provider/hook is complete until the relevant action in ACTION-REGISTER is marked Done with evidence. `packages/i18n-runtime/src/react.ts` is a bootstrap placeholder.

Do not promote i18n validation to a hard gate until both the React provider/hook migration and the API/auth/validation message migration actions are complete.

Validate i18n with:

```bash
node tools/architecture/validate-i18n/src/index.mjs .
```

## API contract

`docs/api/openapi.json` is the REST documentation baseline for supplementary BFF routes.

GraphQL remains the primary client-facing API boundary per ADR-0013.

OpenAPI drift validation is a hard gate (`validate-openapi-drift --strict`, run by `make architecture` → `make check`): it enforces path+method presence (code ↔ spec), local `$ref` integrity, and schema presence on every request body and non-bodyless response (ADR-ACT-0286/0287). Not enforced: runtime/semantic conformance that a documented schema matches the live response shape — that is contract-testing, not drift. The external developer portal/gateway, SDK generation, and sandbox mode remain Proposed under ADR-0065 (ADR-ACT-0250).

## Dev Container

The Dev Container is part of the developer baseline.

Files:

```text
.devcontainer/devcontainer.json
.devcontainer/post-create.sh
```

It installs dependencies, architecture tool dependencies, Playwright Chromium, and Tilt. It must remain secret-free and idempotent.

## Generated files and metadata

After changing package architecture metadata:

```bash
make readmes
```

Do not edit generated README sections outside manual extension blocks.

## ADR and action register rules

Every structural decision needs an ADR or an ACTION-REGISTER update.

Update `docs/adr/ACTION-REGISTER.md` whenever work is opened, progressed, completed, deferred, or superseded.

Update ADR-0007 when creating a new `docs/evidence/` subdirectory.

The authoritative next ADR number and next action number are always in `docs/adr/ACTION-REGISTER.md`. Do not maintain them here.

## Critical constraints

Never violate these without an explicit ADR amendment:

1. Do not bypass the BFF from React for server data.
2. Do not put database, Redis, Keycloak SDK, token exchange, migrations, or server-only observability in the React app.
3. Do not import adapters from domain, feature, UI, or contract packages.
4. Do not import pino in domain, feature, UI, or contract packages.
5. Do not import OpenTelemetry SDK packages in `platform-observability`.
6. Do not throw raw `Error` for expected failure paths. Use typed `platform-errors` errors.
7. Do not use `console.log` or `console.error` in app runtime, BFF, or adapter code. Use `platform-logging`.
8. Do not commit `.env`, `.tfvars`, state files, traces, screenshots, coverage output, reports, secrets, tokens, cookies, or production/customer payloads.
9. Do not mark ACTION-REGISTER rows Done without evidence.
10. Do not claim production or live verification without running the relevant command.

## Task-specific files

```text
Package metadata        packages/<name>/package.json, generated README
Import boundaries       docs/architecture/import-boundary-rules.json
ADRs                    docs/adr/NNNN-<slug>.md, ACTION-REGISTER.md
Evidence                docs/evidence/<area>/
Compose                 compose.yaml, docs/local-development/compose-services.md
Environments            config/environments/<stage>.json (+ common.json), scripts/env/, .env/<stage>.env (generated)
Tilt                    Tiltfile, docs/local-development/tilt-workflow.md
WireMock                docker/wiremock/mappings, docker/wiremock/__files
Dev Container           .devcontainer/devcontainer.json, .devcontainer/post-create.sh
i18n                    packages/i18n-runtime, tools/architecture/validate-i18n
OpenAPI                 docs/api/openapi.json, docs/api/README.md
Reset/demo data         Makefile, apps/platform-api/src/db
```

## Completion standard

A change is complete only when:

```text
- implementation matches ADRs
- ACTION-REGISTER is accurate
- docs/evidence are updated where needed
- local services are started or the reason they cannot be started is stated
- logs/health endpoints were checked for runtime work
- make check passes
- stronger tests pass for the changed surface
```
