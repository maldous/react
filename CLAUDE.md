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

```bash
node --test tools/architecture/orchestrator/tests/*.test.mjs
node --test tools/architecture/validate-package-metadata/tests/*.test.mjs
node --test tools/architecture/generate-package-readmes/tests/*.test.mjs
node --test tools/architecture/generate-package-inventory/tests/*.test.mjs
node --test tools/architecture/validate-lifecycle-evidence/tests/*.test.mjs
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
| `architecture` | architecture-governance |

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

Schema lives at `docs/schemas/package-json-architecture.schema.json`.

### Import boundary rules (enforced by architecture tooling)

Key rules — full matrix is in `docs/architecture/import-boundary-rules.md`:

- **Public exports only**: `import from "@platform/pkg"` — never from internal paths.
- **Domain packages** (`domain-core`, `profile-configuration`, `access-control`) must not import React, adapters, or framework clients.
- **Contract packages** must not import adapter or runtime packages.
- **UI** (`ui-design-system`) must remain data-source and adapter agnostic.
- **Feature packages** compose UI + domain + contracts; they do not own persistence.
- **`test-support`** must not be a production dependency.
- **Adapters** own the runtime layer; contracts remain runtime-free.

### Generated READMEs

Package READMEs are generated from `package.json` `architecture.readme` metadata by `tools/architecture/generate-package-readmes`. Do not edit generated sections — only the `<!-- BEGIN MANUAL EXTENSION -->` / `<!-- END MANUAL EXTENSION -->` block may be edited manually.

### Architecture tooling test strategy (ADR-0012)

Tools use Node.js built-in test runner (`node --test`). Tests spawn tools via `spawnSync` against real fixture directories. Golden-file tests compare generated output against committed golden files in `tests/fixtures/`.
