# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

An architecture baseline and package skeleton for a modular enterprise React platform. It contains:

- Product packages (`apps/`, `packages/`) with governed metadata
- Architecture governance tooling (`tools/architecture/`)
- Architecture decision records, schemas, committed evidence, and implementation design specs (`docs/`)

There is no root `package.json` workspace. Tools run directly with `node`.

## Commands

### Architecture governance (run from repo root)

```bash
# Validate package metadata against the JSON Schema
node tools/architecture/validate-package-metadata/src/index.mjs

# Validate via orchestrator (preferred — runs tools in dependency order)
node tools/architecture/orchestrator/src/index.mjs validate

# Run all checks (metadata + readmes + inventory + lifecycle reports + evidence)
node tools/architecture/orchestrator/src/index.mjs all

# Generate / write outputs
node tools/architecture/orchestrator/src/index.mjs generate-readmes
node tools/architecture/orchestrator/src/index.mjs generate-inventory
node tools/architecture/orchestrator/src/index.mjs generate-lifecycle-reports
node tools/architecture/orchestrator/src/index.mjs generate-lifecycle-evidence
node tools/architecture/orchestrator/src/index.mjs validate-evidence
```

Common flags: `--check` (validate without writing), `--write` (write outputs), `--no-reports` (skip report files), `--format text|json`, `--root <path>`, `--plan-only` (print plan without executing).

### Tests (per tool, from repo root)

`node --test` does not expand globs when given relative paths — pass explicit file paths:

```bash
node --test \
  tools/architecture/validate-package-metadata/tests/validate-package-metadata.test.mjs \
  tools/architecture/validate-source-imports/tests/validate-source-imports.test.mjs \
  tools/architecture/generate-package-readmes/tests/generate-package-readmes.test.mjs \
  tools/architecture/generate-package-inventory/tests/generate-package-inventory.test.mjs \
  tools/architecture/validate-lifecycle-evidence/tests/validate-lifecycle-evidence.test.mjs \
  tools/architecture/orchestrator/tests/self-evidence.test.mjs
```

`validate-package-metadata` requires `ajv` to be installed. After `git clean` or a fresh clone, run:

```bash
cd tools/architecture/validate-package-metadata && npm ci
```

## Architecture

### Hexagonal + bounded-context model (ADRs 0001–0003)

The platform is structured as modular hexagonal architecture around bounded contexts. The key domains are:

| Domain | Bounded contexts |
|---|---|
| `experience` | app-shell, workflow, design-system |
| `core` | domain-core, profile-configuration, access-control, graphql-contracts |
| `integration` | external-ingestion-contracts, external-ingestion-runtime, graphql-runtime |
| `persistence` | postgres-runtime |
| `analytics` | analytics-contracts, clickhouse-runtime |
| `operations` | api-server, graphql-server, worker-server, config-service, session-service, auth-gateway, audit-service, observability-core, queue-service, storage-service, email-service, notification-service, search-service, auth-keycloak, cache-queue-redis, error-monitoring, telemetry, object-storage, email-brevo |
| `delivery` | dev-local, container-build, terraform-workflow, ci-pipeline, aws-infra, cloudflare-infra |
| `architecture` | architecture-governance |

Owner teams: `team-platform` owns most operations and delivery packages; `team-security` owns auth-gateway, session-service, audit-service, and auth-keycloak.

### Package namespace and layout

| Location | npm scope | Purpose |
|---|---|---|
| `apps/` | `@platform/` | Deployable application surfaces |
| `packages/` | `@platform/` | Shared domain, contract, adapter, feature, UI, and test packages |
| `tools/architecture/` | `@architecture/` | Governance-only tooling; never a product runtime dependency |
| `docs/adr/` | — | Architecture decision records (source of truth for decisions) |
| `docs/schemas/` | — | Governed JSON schemas |
| `docs/architecture/` | — | Context map, glossary, import rules, naming conventions |
| `docs/evidence/` | — | Committed lifecycle transition evidence bundles |
| `docs/specs/` | — | Implementation design specs (platform-agnostic, date-prefixed) |
| `reports/` | — | Generated reports (gitignored) |

### Package lifecycle classes (ADR-0004)

Every package has a lifecycle class in the form `<stage>.<role>`.

Stages: `experimental`, `candidate`, `active`, `stable`, `maintenance`, `external`, `deprecated`  
Roles: `feature`, `platform`, `contract`, `adapter`, `tooling`, `test`

### Package metadata (ADR-0005)

All packages must have an `architecture` block in `package.json`. Required top-level keys:

```json
"architecture": {
  "schemaVersion": "1.0",
  "component": { "type", "name", "system", "domain", "boundedContext", "owner" },
  "lifecycle": { "stage", "role", "class", "catalogLifecycle", "visibility", "supportLevel", "reviewCadence" },
  "governance": { "decisionRefs", "semverPolicy", "changeControl", "promotionEligible" },
  "runtime": { "production", "testOnly", "serviceName", "serviceNamespace", "deploymentEnvironments" },
  "boundaries": { "publicExportsOnly", "deepImportsAllowed", "allowedConsumers", "forbiddenConsumers" },
  "relations": { "dependsOn", "providesApis", "consumesApis" },
  "tags": { "scope", "type", "stage", "role", "layer" },
  "readme": { "generated", "summary", "responsibilities", "nonResponsibilities", "usage", "operationalNotes" }
}
```

Schema lives at `docs/schemas/package-json-architecture.schema.json`. Validated by ajv (draft-2020-12 via `Ajv2020`) inside `validate-package-metadata`. Key enum constraints to know when writing package.json:

- `component.type`: `application | library | service | api | worker | tool | test | documentation`
- `lifecycle.stage`: `experimental | candidate | active | stable | maintenance | external | deprecated`
- `lifecycle.role`: `feature | platform | contract | adapter | tooling | test`
- `lifecycle.supportLevel`: includes `best-effort` (used by delivery/tooling packages)
- `runtime.deploymentEnvironments` items: `local | development | test | ci | staging | production`
- `tags.type`: same enum as `component.type`
- `tags.layer`: `domain | application | app | adapter | ui | infrastructure | tooling | test | documentation | contract | feature | platform | runtime`
- `boundaries.allowedConsumers` / `forbiddenConsumers`: **free-form strings** — use semantic role labels (`application`, `feature`, `platform`, `adapter`, `domain`, `ui`, `tooling`, `test`, etc.).

### Import boundary rules (enforced by architecture tooling)

Key rules — full matrix is in `docs/architecture/import-boundary-rules.md`:

- **Public exports only**: `import from "@platform/pkg"` — never from internal paths.
- **Domain packages** (`domain-core`, `profile-configuration`, `access-control`) must not import React, adapters, or framework clients.
- **Contract packages** must not import adapter or runtime packages.
- **UI** (`ui-design-system`) must remain data-source and adapter agnostic.
- **Feature packages** compose UI + domain + contracts; they do not own persistence. They may use the interface packages (`queue-runtime`, `storage-runtime`, `audit-events`, `email-runtime`, `notification-runtime`, `search-runtime`) but must never import their concrete adapters.
- **`test-support`** must not be a production dependency.
- **Adapters** own the runtime layer; contracts remain runtime-free.
- **Operations interface packages** (`config-runtime`, `observability`, `security-auth`, `audit-events`, `queue-runtime`, `storage-runtime`, `email-runtime`, `notification-runtime`, `search-runtime`) are leaf nodes with **zero `@platform/*` dependencies**. They define interfaces only; adapters implement them.
- **Operations adapter packages** (`adapters-keycloak`, `adapters-redis`, `adapters-sentry`, `adapters-opentelemetry`, `adapters-object-storage`, `adapters-brevo`) must not be imported by domain, contract, feature, or UI packages.
- **Delivery packages** (`dev-services`, `tooling-docker`, `tooling-terraform`, `tooling-ci`, `infra-aws`, `infra-cloudflare`) must not be imported by any other package. They carry `production: false` in runtime metadata.

### Generated READMEs

Package READMEs are generated from `package.json` `architecture.readme` metadata by `tools/architecture/generate-package-readmes`. Do not edit generated sections — only the `<!-- BEGIN MANUAL EXTENSION -->` / `<!-- END MANUAL EXTENSION -->` block may be edited manually.

### Architecture tooling test strategy (ADR-0012)

Tools use Node.js built-in test runner (`node --test`). Tests spawn tools via `spawnSync` against real fixture directories. Golden-file tests compare generated output against committed golden files in `tests/fixtures/`.
