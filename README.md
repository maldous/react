# Enterprise React Platform

A good application needs good foundations.

That sounds obvious until a team starts from the screen, wires a few forms to an API, adds a database call where it fits, and then tries to retrofit structure once the product has already hardened around shortcuts.

This repository takes the opposite path.

It starts with decisions. Those decisions are written down as Architecture Decision Records, tested through tooling, and then used as the ground that later decisions stand on. The result is not just a React app. It is a small enterprise platform built to show how frontend, backend, infrastructure, testing, and governance can grow together without turning into a pile of exceptions.

![Platform overview](docs/images/platform-overview.svg)

## What this project is

This is a governed React 19 monorepo built around a Vite SPA, a separate Node BFF/API runtime, domain packages, adapter packages, infrastructure definitions, and architecture tools that enforce the rules.

The first real vertical slice is complete: an authenticated organisation profile flow from React protected route to API guard, use case, domain validation, Postgres adapter, structured logs, trace context, and Playwright E2E coverage.

The repo is intentionally more than a demo UI. It is a practical example of application architecture designed to survive more than the first feature.

## How the application is designed

The current application behaviour is small but complete. A user opens the organisation profile page, the React feature asks the BFF for `/api/organisation/profile`, the API resolves session context, checks permissions, validates the request, calls a pure use case, and reaches Postgres only through a repository port and adapter.

That shape matters because every dependency has a reason to exist. The UI depends on feature hooks and contracts. The API depends on guards, runtime context, use cases, and safe error mapping. The use case depends on a port, not Postgres. The adapter owns SQL, row mapping, and connection pooling. Data never leaks backwards into the React app.

![Application dependency map](docs/images/application-dependency-map.svg)

## Why it was built this way

The early decision was not "which component library should I use?" It was "what kinds of mistakes should the codebase make difficult?"

A few examples:

- The React app is browser-only. It does not own database access, migrations, sessions, or identity exchange.
- The API layer owns security enforcement. Protected routes improve UX, but API guards decide access.
- Domain and use-case code stays free of framework, HTTP, database, React, Keycloak, and observability SDK concerns.
- Adapters own external systems such as Postgres, Redis, Keycloak, OpenTelemetry, Sentry, object storage, email, and cloud services.
- Contracts use Zod so request and response shapes are explicit and testable.
- Package metadata, lifecycle rules, import boundaries, generated READMEs, and evidence bundles are validated by tools, not memory.

That makes the architecture slower to start, but faster to trust.

## How the project evolved

The commit history tells the story.

First came the governance baseline: ADRs, package metadata, lifecycle classes, JSON Schemas, generated package READMEs, inventory reports, lifecycle evidence, and an orchestrator to run the architecture checks in order.

Then came enforcement. Import-boundary validation was added so architectural rules were not just written in Markdown. Deep imports, test-support leakage, frontend-to-adapter shortcuts, and domain dependency violations became build-time failures.

Next the platform widened. Operations and delivery packages were added for API runtime, GraphQL runtime, workers, configuration, sessions, audit events, queues, storage, observability, auth, AWS, Cloudflare, Terraform workflow, CI, and local development services. These started as skeletons, but with real ownership, lifecycle metadata, and boundaries.

Then the quality baseline was tightened: Prettier, markdown linting, ESLint flat config, TypeScript strict checks, npm audit, OSV scanning, gitleaks, CodeQL, SonarQube, SBOM generation, and Docker Compose validation.

Only after that did the frontend stack become meaningful. React was paired with TanStack Router for typed routing, TanStack Query for server state, React Hook Form and Zod for forms, React Aria Components for accessible primitives, Tailwind for styling, Vitest/MSW for component tests, and Playwright for browser-level E2E tests.

Identity came next: users, organisations, memberships, roles, permissions, session actors, a Keycloak adapter boundary, and a BFF session model where raw tokens never belong in browser JavaScript.

Finally, the first vertical slice proved the architecture under pressure. A pragmatic implementation was then hardened into a cleaner hexagonal shape: repository port, Postgres adapter, dependency-injected use case, strict request contracts, safe error handling, runtime context propagation, and end-to-end tests.

![Governance loop](docs/images/governance-loop.svg)

## What the first slice proves

The organisation profile slice is deliberately small. The point was not feature volume. The point was proof.

It proves that the same path works from the browser down to persistence and back again.

![Runtime data flow](docs/images/runtime-data-flow.svg)

That slice includes read, update, forbidden, unauthenticated, fixture-session, API, repository, frontend, compose, and browser-level tests.

## React choices

The React side is intentionally modern, but not novelty-driven.

TanStack Router was chosen because route params and search params should be typed, not guessed. TanStack Query owns server/cache state because async server data does not belong in a global UI store. Zustand is reserved for local cross-component UI state. React Hook Form and Zod keep forms close to the contract model. React Aria Components provide accessible behaviour without forcing a vendor design system.

The app uses open-code UI primitives. That means the platform owns its component source and styling rather than outsourcing long-term design decisions to a heavy component framework.

## Backend and boundary choices

The backend is a BFF/API runtime, not a hidden part of the React app.

That boundary matters. It keeps the browser from knowing about database clients, migrations, Keycloak SDKs, Redis sessions, token exchange, or server-only observability concerns. The browser asks for safe session state and calls approved API routes. The API derives runtime context, checks permissions, validates input, calls use cases, and maps infrastructure failures into safe responses.

The result is a frontend that stays clean and a backend that has a clear job.

## Local platform

The local environment uses Docker Compose for the services a real platform needs:

```text
PostgreSQL  Redis  ClickHouse  MinIO  Mailpit  OpenTelemetry Collector
```

Optional profiles add Keycloak, LocalStack, SonarQube, and Sentry. Terraform/OpenTofu is used for declarative infrastructure provisioning where infrastructure configuration matters, especially identity and later cloud environments.

![Readiness tiers](docs/images/readiness-tiers.svg)

## Current status

### Done

- **ADRs 0001–0031** accepted and enforced (governance, hexagonal architecture, multi-tenant isolation, dynamic authorisation, infrastructure provisioning privilege model)
- **60 governed packages** with architecture metadata, lifecycle evidence, and import-boundary validation
- Architecture tooling: validate-package-metadata, validate-source-imports, validate-openapi-drift, generate-package-readmes, and orchestrator gate
- Quality baseline: Prettier, ESLint, TypeScript strict, SonarQube, markdownlint, lefthook pre-commit
- Local service substrate: Postgres, Redis, ClickHouse, MinIO, Mailpit, OTel Collector, Keycloak, WireMock
- React 19 platform stack: TanStack Router, TanStack Query, React Hook Form, Zod, React Aria, Tailwind
- Identity model: User, Organisation, Membership, ExternalIdentity, SessionActor (ADR-0021)
- Playwright E2E substrate and authenticated organisation profile vertical slice
- Real OAuth 2.0 Authorization Code + PKCE login through platform-api BFF with tenant-aware Keycloak realm selection
- Multi-tenant isolation: schema-per-tenant (PostgreSQL), RLS policies, Redis namespace, S3 prefix per tenant
- Caddy FQDN routing: `aldous.info` (super-global), `{slug}.aldous.info` (tenant), path-prefixed admin tool UIs
- Tenant provisioning API (`POST /api/admin/tenants`) with per-resource tier configuration
- Auth Settings API: IdP, MFA, session, and sysadmin-brokering management per tenant realm
- Tilt fast-dev loop with keycloak-provision and WireMock resources
- Hexagonal adapter packages for Keycloak, Postgres, Redis, S3, ClickHouse, Sentry, Brevo, OTel, GraphQL

### In progress (not production ready)

The following are structurally complete but have explicit caveats. Each is tracked in `docs/adr/ACTION-REGISTER.md`.

**UMA dynamic policy enforcement (ADR-ACT-0145):** The BFF uses a static `requiredPermission` bridge that checks session-resolved permissions from Redis. Keycloak Authorization Services UMA ticket evaluation is not yet wired. ADR-0030's "no-deploy policy changes" claim is NOT satisfied until ADR-ACT-0145 is complete. The Auth Settings API (`/api/auth/settings/*`) manages realm configuration but does not substitute for runtime UMA evaluation.

**RLS requires a non-superuser production DB role (ADR-ACT-0153):** Migration 004 adds FORCE ROW LEVEL SECURITY and the `withTenant`/`withSystemAdmin` helpers correctly set `app.current_tenant_id` / `app.bypass_rls`. However, the Docker Compose dev setup creates `platform` as a PostgreSQL superuser — superusers bypass FORCE RLS unconditionally. RLS will only enforce in production when a non-superuser application DB role is used.

**Auth Settings API audit (ADR-ACT-0154):** The POST/PATCH `/api/auth/settings/*` routes validate bodies and proxy to Keycloak, but do not yet emit persistent audit events. Deferred pending a persistent `AuditEventPort` adapter (ADR-ACT-0148).

**Persistent audit events (ADR-ACT-0148):** Provisioning emits audit events to an in-memory port. A ClickHouse- or Postgres-backed adapter is required for durable audit trails before tenant-admin UI release.

**Live Keycloak browser E2E:** The current E2E test suite uses `LOCAL_FIXTURE_SESSION`. Browser-driven login through a real Keycloak realm requires `KEYCLOAK_CLIENT_SECRET` env var and the identity Compose profile running.

### Next

- Live Keycloak browser E2E login confirmation
- Keycloak global logout (end-session endpoint)
- UMA ticket evaluation in BFF pipeline (ADR-ACT-0145)
- Production non-superuser DB role (ADR-ACT-0153)
- Persistent audit event adapter (ADR-ACT-0148, ADR-ACT-0154)
- Second product vertical slice

## Commands

Normal local development loop:

```sh
npm ci
make compose-up-default
make check
tilt up
```

Full baseline (required before claiming make all passes):

```sh
make all
```

Common targets and scripts:

```sh
make compose-up-default          # start core services (Postgres, Redis, ClickHouse, MinIO, Mailpit, OTel)
make compose-up-external-mocks   # add WireMock for adapter contract tests
make compose-up-web              # build + serve the full stack on :80 via Caddy
make compose-ps                  # list running services and health
npm run compose:config           # validate default Compose config
npm run compose:config:all       # validate all profiles

npm run test:platform-api        # Node/BFF unit + substrate tests
npm run test:frontend:run        # Vitest component tests
npm run test:e2e                 # Playwright E2E (dev server + fixture session)
npm run test:e2e:prod            # Playwright E2E (production build)
npx playwright test --config playwright.aldous.config.ts   # live smoke against aldous.info
```

## Repository map

```text
docs/                 ADRs, architecture notes, evidence, schemas, specs
apps/                 deployable application surfaces
packages/             domain, contract, feature, adapter, platform packages
tools/architecture/   governance tooling
infra/                Terraform/OpenTofu modules and environments
compose.yaml          local service substrate
Makefile              main developer workflow
```

## The point

This repo is what happens when React work is treated as application architecture, not just page construction.

It shows how trade-offs become decisions, how shortcuts are kept from becoming standards, and how design decisions are turned into enforceable code. Frontend state, routing, forms, accessibility, BFF boundaries, auth, domain modelling, infrastructure, CI, testing, observability, and architecture governance all have a place here.
