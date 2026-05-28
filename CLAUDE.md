# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A fully governed enterprise React platform. Architecture decisions come first — every structural choice is recorded in an ADR before code is written. The repo has 25 accepted ADRs, all quality gates passing, Docker Compose services running, and all platform packages implemented. The first vertical slice (ADR-ACT-0008 — authenticated organisation profile) is **Done** in canonical hexagonal architecture.

---

## Primary command

```bash
make all
```

Runs everything in order: install → format → lint → typecheck → test (426 tests + coverage) → test-compose (25 smoke tests) → audit → security → compose → architecture → sonar → advisory → sbom → license. This is the single source of truth for a complete quality check.

Other useful make targets:

```bash
make check          # Fast: format/lint/typecheck/audit/compose/architecture
make ci             # CI-safe: no sonar, no compose smoke tests
make fix            # Auto-fix formatting (format:write)
make clean          # Remove coverage/ reports/ .scannerwork/
make compose-up-default   # Start postgres redis clickhouse minio mailpit otel-collector
make compose-ps     # Check service health
# Public web demo (builds containers, serves on :80 — stop system Caddy first):
docker compose --profile web up -d --build
make readmes        # Regenerate package READMEs from metadata
make help           # Show all targets
```

---

## Commands

### Format

```bash
npm run format:write        # Fix formatting (run before format:check)
npm run format:check        # Verify — fails if any file is unformatted
```

### Lint

```bash
npm run lint:md             # markdownlint-cli2
npm run lint                # ESLint flat config (2-bucket: Node tools / TS packages+apps)
```

### TypeScript

```bash
npm run tsc:check           # App + all platform packages (runs tsc:check:packages)
npm run tsc:check:packages  # Platform packages only (packages/tsconfig.packages.json)
```

### Tests

```bash
npm run test:architecture   # 426 tests — architecture tools, platform packages, platform-api substrate
npm run test:coverage       # Same + generates coverage/lcov.info (V8 LCOV)
npm run test:platform-api   # 77 platform-api tests (requires Postgres running)
npm run test:compose        # 25 compose smoke tests (requires services running)
npm run test:e2e            # 13 Playwright E2E tests (requires services + Vite dev server)
```

`node --test` does **not** expand globs — use `npm run test:architecture` or `npm run test:platform-api`. For the full explicit file list, see the `package.json` `scripts` section.

After `git clean` or fresh clone, install tool dependencies:

```bash
cd tools/architecture/validate-package-metadata && npm ci
cd tools/architecture/validate-source-imports && npm ci
cd tools/architecture/validate-lifecycle-evidence && npm ci
```

### Architecture governance

```bash
# Preferred: runs all tools in dependency order
node tools/architecture/orchestrator/src/index.mjs all --no-reports --strict

# Individual tools
node tools/architecture/orchestrator/src/index.mjs validate
node tools/architecture/orchestrator/src/index.mjs generate-readmes
node tools/architecture/orchestrator/src/index.mjs generate-inventory
node tools/architecture/orchestrator/src/index.mjs generate-lifecycle-reports
node tools/architecture/orchestrator/src/index.mjs validate-evidence
```

Flags: `--root <path>`, `--format text|json`, `--no-reports`, `--strict`, `--plan-only`.

### Security and audit

```bash
npm run audit:deps          # npm audit --audit-level=high
npm run audit:osv           # osv-scanner scan --recursive .
npm run secrets:scan        # gitleaks (binary must be on PATH; hard gate in CI via action)
```

### Sonar

```bash
# Requires SONAR_TOKEN in .env or environment
npm run sonar:clean         # test:coverage + scan + quality gate check
npm run sonar:scan          # Scanner only (host URL baked in as http://localhost:9003)
npm run sonar:quality-gate  # API gate check only
```

SonarQube uses the "Governance Tooling" custom gate: bugs=0, vulnerabilities=0, hotspots reviewed, all ratings=A. Start SonarQube first:

```bash
make compose-up-quality
# or: docker compose --profile quality up -d sonarqube
```

### Compose services

```bash
npm run compose:config          # Validate compose.yaml (default profile)
npm run compose:config:all      # Validate all 5 profiles
npm run compose:up:default      # Start 6 default services explicitly
npm run compose:up              # Start default services
npm run compose:down            # Stop all
npm run compose:down:volumes    # Stop + remove volumes
npm run compose:ps              # Status
npm run compose:logs            # Follow logs
npm run compose:quality         # Start SonarQube
npm run compose:identity        # Start Keycloak
npm run compose:cloud           # Start LocalStack
npm run compose:sentry          # Start Sentry (experimental)
```

### Advisory (report-only)

```bash
npm run knip                # Unused exports/deps
npm run depcruise           # Dependency graph smoke tests
npm run sbom:generate       # CycloneDX SBOM → docs/evidence/security/sbom-baseline.json
npm run license:policy      # License policy status (documentation-only)
```

---

## Architecture

### Hexagonal + bounded-context model (ADR-0001–0003)

| Domain         | Bounded contexts                                                                                                                                                                                                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `experience`   | app-shell, workflow, design-system                                                                                                                                                                                                                                                                           |
| `core`         | domain-core, profile-configuration, access-control, graphql-contracts                                                                                                                                                                                                                                        |
| `integration`  | external-ingestion-contracts, external-ingestion-runtime, graphql-runtime                                                                                                                                                                                                                                    |
| `persistence`  | postgres-runtime                                                                                                                                                                                                                                                                                             |
| `analytics`    | analytics-contracts, clickhouse-runtime                                                                                                                                                                                                                                                                      |
| `operations`   | api-server, graphql-server, worker-server, config-service, session-service, auth-gateway, audit-service, observability-core, queue-service, storage-service, email-service, notification-service, search-service, auth-keycloak, cache-queue-redis, error-monitoring, telemetry, object-storage, email-brevo |
| `delivery`     | dev-local, container-build, terraform-workflow, ci-pipeline, aws-infra, cloudflare-infra                                                                                                                                                                                                                     |
| `architecture` | architecture-governance                                                                                                                                                                                                                                                                                      |

`team-platform` owns most operations and delivery. `team-security` owns auth-gateway, session-service, audit-service, auth-keycloak.

### Package namespace and layout

| Location              | npm scope        | Purpose                                                       |
| --------------------- | ---------------- | ------------------------------------------------------------- |
| `apps/`               | `@platform/`     | Deployable application surfaces                               |
| `packages/`           | `@platform/`     | Domain, contract, adapter, feature, UI, and platform packages |
| `tools/architecture/` | `@architecture/` | Governance tooling — never a product runtime dependency       |
| `docs/adr/`           | —                | ADRs + ACTION-REGISTER                                        |
| `docs/schemas/`       | —                | Governed JSON Schemas                                         |
| `docs/architecture/`  | —                | Import boundary rules, context map, naming conventions        |
| `docs/evidence/`      | —                | Committed governance evidence                                 |
| `docs/specs/`         | —                | Pre-implementation design specs                               |

### Package lifecycle classes (ADR-0004)

Format: `<stage>.<role>`

Stages: `experimental`, `candidate`, `active`, `stable`, `maintenance`, `external`, `deprecated`
Roles: `feature`, `platform`, `contract`, `adapter`, `tooling`, `test`

### Package metadata (ADR-0005)

All packages have an `architecture` block in `package.json`. Required top-level keys: `schemaVersion`, `component`, `lifecycle`, `governance`, `runtime`, `boundaries`, `relations`, `tags`, `readme`. Schema at `docs/schemas/package-json-architecture.schema.json`.

Key enum values:

- `component.type`: `application | library | service | api | worker | tool | test | documentation`
- `lifecycle.supportLevel`: `experimental | standard | enhanced | maintenance | deprecated | unsupported`
- `lifecycle.reviewCadence`: `none | monthly | quarterly | six-monthly | annual | on-change`
- `lifecycle.catalogLifecycle`: `experimental | production | deprecated`
- `tags.layer`: `domain | application | app | adapter | ui | infrastructure | tooling | test | documentation | contract | feature | platform | runtime`
- `boundaries.allowedConsumers` / `forbiddenConsumers`: free-form semantic role labels

### Generated READMEs (ADR-0008)

Package READMEs are generated from `architecture.readme` metadata. Do not edit generated sections — only `<!-- BEGIN MANUAL EXTENSION -->` / `<!-- END MANUAL EXTENSION -->` blocks may be edited manually. Run `make readmes` after changing metadata.

### Import boundary rules (ADR-0001–0003 + ADR-0020)

33 rules enforced by `validate-source-imports` reading `docs/architecture/import-boundary-rules.json`. Key constraints:

- No deep imports (`@platform/pkg/src/internal`)
- **Domain packages**: no React, GraphQL clients, adapters, pino, OTel SDK, Sentry, platform-logging, platform-observability
- **Feature packages**: no adapters, pino, Sentry, OTel SDK, platform-logging
- **UI packages**: no domain, adapters, platform-logging, platform-observability, platform-errors, platform-runtime-context
- **Contract packages**: no adapters, React UI, pino, OTel SDK, Sentry
- **platform-runtime-context**: zero `@platform/` dependencies
- **platform-errors**: zero `@platform/` dependencies
- **platform-observability**: only `@opentelemetry/api` — never SDK packages
- **platform-logging**: only pino + platform-runtime-context — no OTel, no Sentry, no adapters

---

## Platform packages (ADR-0020)

| Package                              | Key exports                                                                                                                                                                                                                                           |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@platform/platform-runtime-context` | `RuntimeContext`, `createRequestContext`, `withOperation`, `withFeature`, `withActor`, `withTenant`, `withTrace`, `safeClientContext`                                                                                                                 |
| `@platform/platform-errors`          | `AppError` (abstract base), `ValidationError` (400), `NotFoundError` (404), `ConflictError` (409), `UnauthorizedError` (401), `ForbiddenError` (403), `InfrastructureError` (502, retryable), `UnexpectedError` (500), `isAppError`, `toSafeResponse` |
| `@platform/platform-logging`         | `createLogger`, `createChildLogger`, `createRequestLogger`, `createBrowserLogger`, `safeErrorMeta`, `safeContextMeta`, `redactionPaths`                                                                                                               |
| `@platform/platform-observability`   | `createTracer`, `withSpan`, `withSpanSync`, `getTraceContext`, `recordException`, `setSpanAttributes`                                                                                                                                                 |
| `@platform/api-runtime`              | `HealthResponse`, `ReadinessResponse`, `VersionResponse`, `createHealthResponse`, `createReadinessResponse`, `createVersionResponse`                                                                                                                  |

`platform-runtime-context` and `platform-errors` have zero `@platform` dependencies. The others may only depend on `platform-runtime-context` (not adapters, features, domain, or UI).

---

## Active ADRs (reference)

| ADR       | Title                                                                   |
| --------- | ----------------------------------------------------------------------- |
| 0001      | Use modular hexagonal architecture                                      |
| 0002      | Model the platform around bounded contexts                              |
| 0003      | Use a modular monorepo with promotion-ready package boundaries          |
| 0004      | Define package lifecycle classes                                        |
| 0005      | Define package metadata vocabulary and format                           |
| 0006      | Define package lifecycle transition rules                               |
| 0007      | Define architecture artifact and repository directory layout            |
| 0008–0012 | README structure, inventory, evidence, tooling execution, test strategy |
| 0013      | Define client-facing API boundary                                       |
| 0014      | Define transactional data ownership                                     |
| 0015      | Define analytical data ownership                                        |
| 0016      | Define enterprise quality gate and security baseline                    |
| 0017      | Define local integration service substrate                              |
| 0019      | Define React component platform and frontend integration stack          |
| 0020      | Define observability, diagnostics, and runtime introspection primitives |
| 0021      | Define identity, tenancy, roles, and permissions model                  |
| 0022      | Define authentication, session, and SSO integration boundary            |
| 0023      | Define declarative infrastructure provisioning model                    |
| 0024      | Define slice readiness and dependency gate model                        |
| 0025      | Define Playwright end-to-end testing strategy                           |

ADR-0018 is reserved. Next ADR: **0026**. Next ACTION-REGISTER entry: **ADR-ACT-0120**.

---

## Key files by task

| Task                        | Files                                                                           |
| --------------------------- | ------------------------------------------------------------------------------- |
| Add/change package metadata | `packages/<name>/package.json` → run `make readmes`                             |
| Add import boundary rule    | `docs/architecture/import-boundary-rules.json` + `import-boundary-rules.md`     |
| Create ADR                  | `docs/adr/NNNN-<slug>.md` + ACTION-REGISTER + ADR-0007 (if new evidence dir)    |
| Add evidence category       | `docs/adr/0007-define-architecture-artifact-and-repository-directory-layout.md` |
| Add architecture tool tests | `tools/architecture/<tool>/tests/<name>.test.mjs`                               |
| Add platform package tests  | `packages/<name>/tests/<name>.test.ts` (Node 25 runs .ts natively)              |
| Compose changes             | `compose.yaml` + `.env.example` + `docs/local-development/compose-services.md`  |
| Sonar quality gate          | `tools/quality/sonar-quality-gate.mjs`                                          |
| Frontend platform           | See ADR-0019 + `docs/evidence/frontend/`                                        |
| Observability               | See ADR-0020 + `docs/evidence/observability/`                                   |

---

## CI

`.github/workflows/ci.yml` — two jobs:

**quality-gates**: format:check, lint:md, lint, tsc:check, audit:deps, OSV scanner (action), gitleaks (action), compose:config, compose:config:all, knip (report-only), depcruise (report-only)

**architecture-checks**: install tool deps, orchestrator all --strict, all 15 test files

**codeql.yml**: CodeQL javascript-typescript, security-extended queries (on push, PR, weekly)

Sonar is **local-only** until `SONAR_TOKEN` and `SONAR_HOST_URL` are available as repository secrets (ADR-ACT-0092).

---

## Critical constraints

Never violate these without an explicit ADR amendment:

1. **Do not start ADR-ACT-0008** (first vertical slice) unless explicitly instructed.
2. **No `console.log`/`console.error`** in app runtime, BFF, or adapter code — use `platform-logging`.
3. **No raw `Error` throws** for expected failure paths — use typed errors from `platform-errors`.
4. **No OTel SDK imports** in `platform-observability` — SDK stays in `adapters-opentelemetry`.
5. **No pino imports** in domain, feature, UI, or contract packages.
6. **No adapter imports** in domain, feature, UI, or contract packages.
7. **Run `make all`** (or at minimum `make check`) after governance changes.
8. **Run `make readmes`** after changing `package.json` `architecture` metadata.
9. **Update ACTION-REGISTER** when any action is opened, progressed, or closed.
10. **Update ADR-0007** when creating a new `docs/evidence/` subdirectory.
