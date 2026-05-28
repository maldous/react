# Enterprise React Platform

A production-grade, governed React monorepo built from first principles — architecture decisions first, code second.

[![Quality Gate](https://img.shields.io/badge/Sonar-passing-brightgreen)](docs/evidence/quality-gates/)
[![Tests](https://img.shields.io/badge/tests-271%20passing-brightgreen)](docs/evidence/quality-gates/)
[![Coverage](https://img.shields.io/badge/coverage-83%25-green)](docs/evidence/quality-gates/)
[![ADRs](https://img.shields.io/badge/ADRs-20%20accepted-blue)](docs/adr/)
[![Packages](https://img.shields.io/badge/packages-51-blue)](packages/)
![License](https://img.shields.io/badge/license-private-lightgrey)

---

## What this is

A fully governed enterprise React platform skeleton — complete with architecture decisions, quality gates, observability primitives, a local service substrate, and a component stack — ready for the first vertical slice of product code.

Every technical choice is recorded in an Architecture Decision Record (ADR). Nothing is accidental. Nothing is undocumented.

---

## The story

This platform was built in layers, each layer ratified before the next began:

| Phase                 | What was established                                                                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Foundations**       | Hexagonal architecture, bounded contexts, modular monorepo, package lifecycle, metadata format, transition rules, directory layout (ADR-0001–0007)        |
| **Tooling**           | Generated READMEs, inventory reports, lifecycle evidence, tooling execution model, test strategy (ADR-0008–0012)                                          |
| **Domain model**      | Client-facing API boundary, transactional data ownership, analytical data ownership (ADR-0013–0015)                                                       |
| **Quality baseline**  | Prettier, markdownlint, ESLint, TypeScript strict, npm audit, OSV scanner, gitleaks, CodeQL, SonarQube — all passing before feature work began (ADR-0016) |
| **Local services**    | Docker Compose substrate: PostgreSQL, Redis, ClickHouse, MinIO, Mailpit, OTel Collector — profile-gated for Keycloak, LocalStack, Sentry (ADR-0017)       |
| **Frontend stack**    | TanStack Router, TanStack Query, React Aria Components, Tailwind CSS, open-code component model, Vitest + MSW (ADR-0019)                                  |
| **Observability**     | OpenTelemetry tracing, Pino structured logging, typed error hierarchy, runtime context propagation, health endpoint contracts (ADR-0020)                  |
| **Platform packages** | `platform-runtime-context`, `platform-errors`, `platform-logging`, `platform-observability` — fully implemented with tests                                |

The first vertical slice (ADR-ACT-0008) begins from a clean, validated baseline.

---

## Quick start

```sh
git clone https://github.com/maldous/react.git
cd react
npm ci
cp .env.example .env
make all
```

To start local development services:

```sh
make compose-up-default
```

This starts PostgreSQL, Redis, ClickHouse, MinIO, Mailpit, and the OTel Collector. See [Local services](#local-services) below.

---

## Architecture decisions

Twenty accepted ADRs govern every structural choice:

| ADR                                                                                            | Decision                                                                     |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [0001](docs/adr/0001-use-modular-hexagonal-architecture.md)                                    | Hexagonal architecture — domain logic independent from frameworks            |
| [0002](docs/adr/0002-model-the-platform-around-bounded-contexts.md)                            | Bounded contexts as the primary product boundary                             |
| [0003](docs/adr/0003-use-a-modular-monorepo-with-promotion-ready-package-boundaries.md)        | Modular monorepo, `@platform/` scope, no root workspace                      |
| [0004](docs/adr/0004-define-package-lifecycle-classes.md)                                      | Package lifecycle classes (`stage.role`)                                     |
| [0005](docs/adr/0005-define-package-metadata-format.md)                                        | `package.json` architecture block as single source of truth                  |
| [0006](docs/adr/0006-define-package-lifecycle-transition-rules.md)                             | Governed lifecycle transitions with evidence bundles                         |
| [0007](docs/adr/0007-define-architecture-artifact-and-repository-directory-layout.md)          | Canonical directory layout                                                   |
| [0008–0012](docs/adr/)                                                                         | Generated READMEs, inventory, evidence bundles, tooling model, test strategy |
| [0013](docs/adr/0013-define-client-facing-api-boundary.md)                                     | GraphQL API boundary via typed contracts                                     |
| [0014](docs/adr/0014-define-transactional-data-ownership.md)                                   | Transactional data owned by domain packages                                  |
| [0015](docs/adr/0015-define-analytical-data-ownership.md)                                      | Analytical events via ClickHouse adapters                                    |
| [0016](docs/adr/0016-define-enterprise-quality-gate-baseline.md)                               | Three-tier quality gates: hard / advisory / architectural                    |
| [0017](docs/adr/0017-define-local-integration-service-substrate.md)                            | Docker Compose substrate with profile-gated services                         |
| [0019](docs/adr/0019-define-react-component-platform-and-frontend-integration-stack.md)        | React component platform — TanStack, React Aria, open-code UI                |
| [0020](docs/adr/0020-define-observability-diagnostics-and-runtime-introspection-primitives.md) | OpenTelemetry, Pino, typed errors, runtime context                           |

All decisions are tracked in [`docs/adr/ACTION-REGISTER.md`](docs/adr/ACTION-REGISTER.md).

---

## Quality gates

`make all` runs every gate in sequence. The platform starts clean:

| Gate               | Tool                                  | Type                   |
| ------------------ | ------------------------------------- | ---------------------- |
| Formatting         | Prettier 3.8.3                        | Hard                   |
| Markdown lint      | markdownlint-cli2                     | Hard                   |
| Code lint          | ESLint flat config                    | Hard                   |
| TypeScript strict  | tsc 6.0.3                             | Hard                   |
| Dependency audit   | npm audit                             | Hard                   |
| Vulnerability scan | osv-scanner 1.9.0                     | Hard                   |
| Secret detection   | gitleaks                              | Hard (CI)              |
| Security analysis  | CodeQL                                | Hard (CI)              |
| Code quality       | SonarQube 9.9 LTS                     | Hard (local pre-slice) |
| Architecture gates | validate-source-imports, orchestrator | Always hard            |
| Unused exports     | Knip                                  | Advisory               |
| Dependency graph   | dependency-cruiser                    | Advisory               |
| SBOM               | CycloneDX npm                         | Advisory               |

---

## Local services

```sh
make compose-up-default
```

| Service        | Host                  | Purpose                        |
| -------------- | --------------------- | ------------------------------ |
| PostgreSQL     | `localhost:5433`      | Primary database               |
| Redis          | `localhost:6379`      | Cache and queue                |
| ClickHouse     | `localhost:8124`      | Analytics storage              |
| MinIO          | `localhost:9000`      | Object storage (S3-compatible) |
| Mailpit        | `localhost:8025`      | Email capture (UI)             |
| OTel Collector | `localhost:4317/4318` | Telemetry ingestion            |

Additional profiles: `quality` (SonarQube on `:9003`), `identity` (Keycloak), `cloud-mocks` (LocalStack), `sentry` (experimental).

All ports are configurable via `.env`. See [`docs/local-development/compose-services.md`](docs/local-development/compose-services.md).

---

## Package structure

51 packages across 8 domains, all governed by ADR-0005 metadata.

**Platform packages** — the cross-cutting foundation:

| Package                              | Purpose                                                                |
| ------------------------------------ | ---------------------------------------------------------------------- |
| `@platform/platform-runtime-context` | Typed RuntimeContext carrier — zero `@platform` dependencies           |
| `@platform/platform-errors`          | Typed error hierarchy (ValidationError, NotFoundError, ConflictError…) |
| `@platform/platform-logging`         | Pino-backed Node logger + browser-safe wrapper + 29-path redaction     |
| `@platform/platform-observability`   | OpenTelemetry API wrapper (createTracer, withSpan, getTraceContext)    |

**Product packages:**

- `apps/react-enterprise-app` — React 19 SPA shell (Vite, TanStack Router)
- `packages/domain-core`, `access-control`, `profile-configuration` — Business logic, no framework dependencies
- `packages/contracts-graphql`, `contracts-analytics`, `contracts-ingestion` — Zod DTO schemas
- `packages/feature-workflow` — First feature package (experience domain)
- `packages/ui-design-system` — Accessible UI components (React Aria + Tailwind)
- `packages/adapters-postgres`, `adapters-redis`, `adapters-clickhouse`, `adapters-opentelemetry`, `adapters-sentry`, and more
- `packages/observability`, `security-auth`, `api-runtime`, and 15 more operations-domain packages

**Governance tooling** (`tools/architecture/`):

- `orchestrator` — runs all tools in dependency order
- `validate-package-metadata` — JSON schema + lifecycle rules
- `validate-source-imports` — import boundary enforcement
- `generate-package-readmes` — README generation from metadata
- `generate-package-inventory`, `validate-lifecycle-evidence`, `generate-lifecycle-reports`

---

## Testing

```sh
make test          # 271 tests + LCOV coverage
make test-compose  # 17 compose service smoke tests (starts services automatically)
```

| Suite                              | Tests | Coverage              |
| ---------------------------------- | ----- | --------------------- |
| Architecture tooling (integration) | 180   | —                     |
| Architecture tooling (unit)        | 91    | 83% line / 80% branch |
| Compose service smoke tests        | 17    | —                     |

Compose smoke tests verify actual roundtrips: PostgreSQL, Redis, ClickHouse, MinIO, Mailpit, and OTel Collector — using npm clients (`pg`, `redis`, `@aws-sdk/client-s3`, `nodemailer`) rather than shell commands.

---

## Frontend stack

Chosen in [ADR-0019](docs/adr/0019-define-react-component-platform-and-frontend-integration-stack.md) — binding before the first slice:

| Concern        | Choice                                           |
| -------------- | ------------------------------------------------ |
| Routing        | TanStack Router (type-safe params + search)      |
| Server state   | TanStack Query                                   |
| Local/UI state | React local state + Zustand                      |
| Forms          | React Hook Form + Zod                            |
| UI components  | React Aria Components + Tailwind CSS (open-code) |
| Tables         | TanStack Table + TanStack Virtual                |
| Testing        | Vitest + React Testing Library + MSW             |
| Notifications  | Sonner                                           |
| Charts         | Recharts                                         |
| Dates          | date-fns + React Aria date components            |

---

## Observability

Every request is traceable from browser to adapter via W3C `traceparent`:

```text
Browser ──traceparent──► BFF ──► use case ──► adapter
                          │                       │
                     platform-logging       child span
                     platform-observability structured log
                          │
                     OTel Collector
                          │
                    any backend (Jaeger / Grafana Tempo / Datadog)
```

All Node logs are structured JSON with `requestId`, `traceId`, and `packageName`. Redaction is enforced at the logger level — 29 credential, token, and secret paths are never emitted. See [ADR-0020](docs/adr/0020-define-observability-diagnostics-and-runtime-introspection-primitives.md).

---

## Repository layout

```text
docs/
  adr/               Architecture decisions + ACTION-REGISTER
  architecture/      Import boundary rules, context map, naming conventions
  evidence/          Committed governance evidence (quality, observability, frontend…)
  schemas/           JSON Schemas (package metadata, lifecycle evidence)
  security/          License policy
  specs/             Pre-implementation design documents
  local-development/ Compose service guide

packages/            @platform/* product and platform packages
apps/                Deployable application surfaces
tools/architecture/  Governance tooling
docker/              Docker service configuration files

Makefile             make all — runs everything
compose.yaml         Docker Compose service definitions
.env.example         Environment variable reference
```

---

## Governance evidence

All architectural decisions are backed by committed evidence:

| Area              | Evidence location                                                      |
| ----------------- | ---------------------------------------------------------------------- |
| Quality gates     | [`docs/evidence/quality-gates/`](docs/evidence/quality-gates/)         |
| Compose substrate | [`docs/evidence/local-platform/`](docs/evidence/local-platform/)       |
| Frontend platform | [`docs/evidence/frontend/`](docs/evidence/frontend/)                   |
| Observability     | [`docs/evidence/observability/`](docs/evidence/observability/)         |
| Import boundaries | [`docs/evidence/import-boundaries/`](docs/evidence/import-boundaries/) |
| Package scope     | [`docs/evidence/platform-scope/`](docs/evidence/platform-scope/)       |
| Security SBOM     | [`docs/evidence/security/`](docs/evidence/security/)                   |

---

> **Status:** Pre-slice baseline complete. ADR-ACT-0008 (first vertical slice) has not started.
