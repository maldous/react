# Import boundary rules

This document defines import-boundary rules for the generic enterprise React package skeleton.

It closes the documentation portion of ADR-ACT-0014 and supports ADR-ACT-0007.

## Core rule

```text
Packages may import only through public exports.
Deep imports are prohibited.
Package dependencies must respect lifecycle role, domain ownership, and adapter/contract separation.
```

## Public exports

```text
Allowed:
  import { thing } from "@platform/package-name"

Forbidden:
  import { thing } from "@platform/package-name/src/internal"
  import { thing } from "../../other-package/src/internal"
```

Every package must expose supported APIs through:

```text
package.json exports
src/index.ts
```

## Production and test boundaries

```text
production packages must not import @platform/test-support
test-support may import contracts, UI, and test-safe fixtures
test-support must not become an application runtime dependency
```

## UI boundaries

```text
@platform/ui-design-system may not import:
  adapters
  contracts
  domain-core
  profile-configuration
  access-control
  runtime clients
  PostgreSQL adapters
  ClickHouse adapters
```

UI packages are presentational and data-source agnostic.

## Feature/workflow boundaries

```text
@platform/feature-workflow may import:
  @platform/ui-design-system
  @platform/domain-core
  @platform/profile-configuration
  @platform/access-control
  @platform/contracts-graphql
  @platform/contracts-analytics
  @platform/queue-runtime           (to enqueue jobs)
  @platform/storage-runtime         (to request presigned URLs)
  @platform/audit-events            (to emit domain-level audit events)
  @platform/email-runtime           (to send transactional email)
  @platform/notification-runtime    (to send push/in-app notifications)
  @platform/search-runtime          (to perform search queries)

@platform/feature-workflow may not import:
  @platform/adapters-postgres
  @platform/adapters-clickhouse
  @platform/api-runtime
  @platform/graphql-api-runtime
  @platform/worker-runtime
  @platform/session-runtime
  @platform/security-auth
  @platform/adapters-keycloak
  @platform/adapters-redis
  @platform/adapters-sentry
  @platform/adapters-opentelemetry
  @platform/adapters-object-storage
  @platform/adapters-brevo
  direct database clients
  @platform/test-support in production source
```

Feature packages compose workflows. They do not own persistence, analytics runtime, or server-side platform runtime.

## Domain boundaries

```text
@platform/domain-core may not import:
  React runtime
  GraphQL client/runtime packages
  PostgreSQL adapters
  ClickHouse adapters
  browser-only APIs
  application packages
  feature packages
  any operations or delivery packages
```

Domain packages must remain pure TypeScript policy/model packages.

## Profile/configuration boundaries

```text
@platform/profile-configuration may import:
  @platform/domain-core

@platform/profile-configuration may not import:
  @platform/adapters-postgres
  @platform/adapters-clickhouse
  @platform/adapters-graphql
  React runtime
  identity provider runtime clients
  any operations or delivery packages
```

Profile/configuration policy is storage-independent. PostgreSQL persistence belongs to `@platform/adapters-postgres`.

## Access-control boundaries

```text
@platform/access-control may import:
  @platform/domain-core
  @platform/profile-configuration

@platform/access-control may not import:
  identity provider runtime clients
  PostgreSQL adapters
  ClickHouse adapters
  React runtime
  any operations or delivery packages
```

Access-control owns generic admin, staff, user, service, and support role policy. It does not own authentication integration or storage runtime.

## Contract boundaries

```text
contract packages may define:
  schemas
  operations
  payload types
  event envelopes
  generated type artifacts

contract packages may not import:
  runtime adapters
  database clients
  React components
  feature workflow packages
  any operations or delivery packages
```

Specific rules:

```text
@platform/contracts-graphql must not import @platform/adapters-graphql
@platform/contracts-ingestion must not import @platform/adapters-ingestion
@platform/contracts-analytics must not import @platform/adapters-clickhouse
```

## Adapter boundaries

```text
adapter packages own runtime integration.
adapter packages may include technology names when that technology is the package responsibility.
adapter packages must not define contract ownership.
```

Specific rules:

```text
@platform/adapters-postgres owns transactional persistence.
@platform/adapters-clickhouse owns analytical persistence.
@platform/adapters-graphql owns GraphQL runtime binding.
@platform/adapters-ingestion owns external ingestion runtime.
```

## PostgreSQL boundary

```text
@platform/adapters-postgres may persist:
  profile configuration
  role assignments
  operational state
  transactional data

@platform/adapters-postgres must not own:
  analytical event history
  ClickHouse query execution
  React rendering
```

## ClickHouse boundary

```text
@platform/adapters-clickhouse may persist:
  analytical events
  external ingestion event history
  high-volume reporting data

@platform/adapters-clickhouse must not own:
  transactional profile configuration
  role assignment state
  React rendering
```

## External ingestion boundary

```text
@platform/contracts-ingestion owns ingestion payload and event contracts.
@platform/adapters-ingestion owns runtime ingestion, validation, and normalization flow.
```

Ingestion runtime may depend on storage adapters through governed boundaries. Contracts must remain runtime-free.

## Operations platform package boundaries

Operations platform packages define interfaces that adapters implement. They have no dependencies on other platform packages except where stated.

```text
@platform/config-runtime:
  no dependencies (leaf node)
  consumed by: adapters, runtime packages, application packages

@platform/observability:
  no dependencies (interface definition only)
  consumed by: api-runtime, graphql-api-runtime, worker-runtime, adapters-sentry, adapters-opentelemetry

@platform/security-auth:
  no dependencies (interface definition only)
  consumed by: api-runtime, session-runtime, adapters-keycloak, application packages

@platform/audit-events:
  no dependencies (interface definition only)
  consumed by: api-runtime, worker-runtime, feature packages

@platform/queue-runtime:
  no dependencies (interface definition only)
  consumed by: worker-runtime, adapters-redis, feature packages

@platform/storage-runtime:
  no dependencies (interface definition only)
  consumed by: adapters-object-storage, feature packages

@platform/api-runtime may import:
  @platform/config-runtime
  @platform/security-auth
  @platform/observability
  @platform/audit-events

@platform/graphql-api-runtime may import:
  @platform/api-runtime
  @platform/contracts-graphql
  @platform/adapters-postgres
  @platform/adapters-clickhouse
  @platform/observability

@platform/worker-runtime may import:
  @platform/queue-runtime
  @platform/config-runtime
  @platform/observability
  @platform/audit-events

@platform/session-runtime may import:
  @platform/security-auth
  @platform/adapters-redis
```

## Operations adapter boundaries

Operations adapters implement interfaces from operations platform packages. They must not be imported by feature, domain, or contract packages.

```text
@platform/adapters-keycloak may import:
  @platform/security-auth
  @platform/config-runtime

@platform/adapters-redis may import:
  @platform/config-runtime
  @platform/queue-runtime

@platform/adapters-sentry may import:
  @platform/observability
  @platform/config-runtime

@platform/adapters-opentelemetry may import:
  @platform/observability
  @platform/config-runtime

@platform/adapters-object-storage may import:
  @platform/storage-runtime
  @platform/config-runtime
```

Operations adapters must not be imported by:

```text
domain packages
contract packages
feature packages
UI packages
```

## Application boundary

```text
@platform/react-enterprise-app may import:
  feature packages
  GraphQL/runtime adapters
  access-control package for role-aware composition
  @platform/platform-errors (browser-safe typed errors)
  @platform/contracts-auth (Zod schemas)
  @platform/ui-design-system

@platform/react-enterprise-app may not import:
  direct PostgreSQL clients (pg)
  pino (Node-only logger)
  direct ClickHouse clients
  contract internals
  package internals
  test-support in production source
  operations runtime or adapter packages
  @platform/api-runtime (server-only)
  @platform/platform-logging (server-only)
  @platform/platform-observability (server-only)
  @platform/platform-runtime-context (server-only)
  @platform/adapters-* (adapter packages)
  @platform/platform-api (BFF/API app ? not a browser dependency)
```

Server/BFF logic (database migrations, seed, health/readiness/version handlers, fixture session provider)
belongs in `apps/platform-api`. See rule `no-server-packages-in-react-spa` (ADR-0022).

```text
@platform/platform-api may import:
  @platform/api-runtime
  @platform/platform-logging
  @platform/platform-observability
  @platform/platform-runtime-context
  @platform/platform-errors
  @platform/contracts-auth
  @platform/domain-identity
  @platform/session-runtime
  pg (PostgreSQL client for migrations, health checks)

@platform/platform-api must not be imported by:
  ui packages
  feature packages
  domain packages
  contract packages
```

## Delivery package boundaries

```text
delivery packages (dev-services, tooling-docker, tooling-terraform, tooling-ci, infra-aws) must not be imported by any other package
delivery packages may only be consumed by the CI/CD pipeline or local developer tooling
delivery packages carry production: false in runtime metadata
```

## Initial allowed dependency matrix

| Package                           | May depend on                                                                                                                                                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| @platform/react-enterprise-app    | feature-workflow, access-control, adapters-graphql, contracts-auth, platform-errors, ui-design-system                                                                                                           |
| @platform/platform-api            | api-runtime, platform-logging, platform-observability, platform-runtime-context, platform-errors, contracts-auth, domain-identity, session-runtime                                                              |
| @platform/feature-workflow        | ui-design-system, domain-core, profile-configuration, access-control, contracts-graphql, contracts-analytics, queue-runtime, storage-runtime, audit-events, email-runtime, notification-runtime, search-runtime |
| @platform/ui-design-system        | none of the runtime/domain packages                                                                                                                                                                             |
| @platform/domain-core             | none of the platform runtime packages                                                                                                                                                                           |
| @platform/profile-configuration   | domain-core                                                                                                                                                                                                     |
| @platform/access-control          | domain-core, profile-configuration                                                                                                                                                                              |
| @platform/contracts-graphql       | profile-configuration, access-control, contracts-analytics                                                                                                                                                      |
| @platform/contracts-ingestion     | none of the runtime adapter packages                                                                                                                                                                            |
| @platform/contracts-analytics     | none of the runtime adapter packages                                                                                                                                                                            |
| @platform/adapters-graphql        | contracts-graphql, adapters-postgres, adapters-clickhouse                                                                                                                                                       |
| @platform/adapters-ingestion      | contracts-ingestion, adapters-postgres, adapters-clickhouse                                                                                                                                                     |
| @platform/adapters-postgres       | profile-configuration, access-control                                                                                                                                                                           |
| @platform/adapters-clickhouse     | contracts-analytics, contracts-ingestion                                                                                                                                                                        |
| @platform/tooling-codegen         | contracts-graphql                                                                                                                                                                                               |
| @platform/test-support            | contracts-graphql, contracts-ingestion, contracts-analytics, ui-design-system                                                                                                                                   |
| @platform/config-runtime          | none                                                                                                                                                                                                            |
| @platform/observability           | none                                                                                                                                                                                                            |
| @platform/security-auth           | none                                                                                                                                                                                                            |
| @platform/audit-events            | none                                                                                                                                                                                                            |
| @platform/queue-runtime           | none                                                                                                                                                                                                            |
| @platform/storage-runtime         | none                                                                                                                                                                                                            |
| @platform/email-runtime           | none                                                                                                                                                                                                            |
| @platform/notification-runtime    | none                                                                                                                                                                                                            |
| @platform/search-runtime          | none                                                                                                                                                                                                            |
| @platform/api-runtime             | config-runtime, security-auth, observability, audit-events                                                                                                                                                      |
| @platform/graphql-api-runtime     | api-runtime, contracts-graphql, adapters-postgres, adapters-clickhouse, observability                                                                                                                           |
| @platform/worker-runtime          | queue-runtime, config-runtime, observability, audit-events                                                                                                                                                      |
| @platform/session-runtime         | security-auth, adapters-redis                                                                                                                                                                                   |
| @platform/adapters-keycloak       | security-auth, config-runtime                                                                                                                                                                                   |
| @platform/adapters-redis          | config-runtime, queue-runtime                                                                                                                                                                                   |
| @platform/adapters-sentry         | observability, config-runtime                                                                                                                                                                                   |
| @platform/adapters-opentelemetry  | observability, config-runtime                                                                                                                                                                                   |
| @platform/adapters-object-storage | storage-runtime, config-runtime                                                                                                                                                                                 |
| @platform/adapters-brevo          | email-runtime, config-runtime                                                                                                                                                                                   |
| @platform/dev-services            | none                                                                                                                                                                                                            |
| @platform/tooling-docker          | none                                                                                                                                                                                                            |
| @platform/tooling-terraform       | none                                                                                                                                                                                                            |
| @platform/tooling-ci              | none                                                                                                                                                                                                            |
| @platform/infra-aws               | none                                                                                                                                                                                                            |
| @platform/infra-cloudflare        | none                                                                                                                                                                                                            |

## Enforcement status

These rules are validated against package metadata declarations and enforced by source-code import scanning via `tools/architecture/validate-source-imports`.

## Observability, logging, and error primitive boundaries (ADR-0020)

### Domain packages ? no raw observability

Domain packages (`domain-core`, `profile-configuration`, `access-control`) must not import:

```text
pino
@opentelemetry/api or @opentelemetry/sdk-*
@sentry/*
@platform/platform-logging
@platform/platform-observability
@platform/adapters-opentelemetry
@platform/adapters-sentry
```

Domain may import `@platform/platform-runtime-context` for typed context fields (requestId, traceId)
and `@platform/platform-errors` for typed error class checks.

### Feature packages ? no logging/tracing SDKs

Feature packages (`feature-workflow` and all future `@platform/feature-*` packages) must not import:

```text
pino
@opentelemetry/sdk-*
@sentry/*
@platform/platform-logging
@platform/platform-observability
@platform/adapters-opentelemetry
@platform/adapters-sentry
```

Features may import:

- `@platform/platform-errors` ? safe client error types and instanceof checks
- `@platform/platform-runtime-context` ? requestId types (via contract client helpers only)

### UI packages ? no observability or error primitives

UI packages (`ui-design-system`) must not import:

```text
pino
@opentelemetry/*
@sentry/*
@platform/platform-logging
@platform/platform-observability
@platform/platform-runtime-context
@platform/platform-errors
@platform/adapters-opentelemetry
@platform/adapters-sentry
```

UI components handle display only. Error display uses UI-safe `ErrorState` primitives
(to be defined in `packages/ui` as part of ADR-ACT-0095). The `@platform/platform-errors`
prohibition may be revisited once `ErrorState` exposes a separately exported safe display type.

### Contract packages ? no concrete observability

Contract packages (`contracts-graphql`, `contracts-analytics`, `contracts-ingestion`) must not import:

```text
pino
@opentelemetry/sdk-*
@sentry/*
@platform/platform-logging
@platform/platform-observability
@platform/adapters-opentelemetry
@platform/adapters-sentry
```

Contract packages define data shapes and DTO schemas only.

### platform-runtime-context ? zero @platform dependencies

`@platform/platform-runtime-context` must not import any `@platform/*` package.
It exports typed interfaces and factory helpers only.

### platform-errors ? zero @platform dependencies

`@platform/platform-errors` must not import any `@platform/*` package.
It must remain importable by React feature packages without pulling in server-side dependencies.

### Inbound constraints on platform-logging and platform-observability

These rules prevent the two wrapping packages from accidentally pulling in SDK-level dependencies.

**`@platform/platform-logging`** must not import:

```text
@opentelemetry/*      (tracing is separate ? platform-observability owns it)
@sentry/*             (error monitoring is adapter-only)
@platform/adapters-*  (no adapter imports)
@platform/platform-observability  (no circular observability dependency)
pino is the only allowed third-party logger; browser wrapper uses console only
```

**`@platform/platform-observability`** must not import:

```text
@opentelemetry/sdk-*                 (SDK wired by adapters-opentelemetry at startup only)
@opentelemetry/auto-instrumentations-*
@opentelemetry/exporter-*
@opentelemetry/instrumentation-*
@sentry/*
@platform/adapters-*
@platform/platform-logging
pino, features, domain, ui, contracts
```

Only `@opentelemetry/api` and `@platform/platform-runtime-context` are allowed in `platform-observability`.

### Allowed import paths (summary)

```text
packages/platform-logging:
  May import: pino (Node), @platform/platform-runtime-context (types only)
  Must not import: @opentelemetry/*, @sentry/*, adapters, features, domain, contracts, ui

packages/platform-observability:
  May import: @opentelemetry/api (only), @platform/platform-runtime-context (types only)
  Must not import: @opentelemetry/sdk-*, adapters, features, domain, contracts, ui, platform-logging

packages/platform-runtime-context:
  May import: nothing @platform
  Has zero @platform dependencies

packages/platform-errors:
  May import: nothing @platform
  Has zero @platform dependencies
```

## Identity and authentication boundary rules (ADR-0021 + ADR-0022)

### Keycloak SDK ? forbidden everywhere except adapters-keycloak

`keycloak-js` and `@keycloak/*` packages are forbidden in all packages except `@platform/adapters-keycloak`:

```text
Forbidden in: domain packages, feature packages, contract packages, UI packages
Reason: ADR-0022 ? Keycloak is an adapter. Only adapters-keycloak imports Keycloak SDK.
Note: @platform/adapters-keycloak is already forbidden by existing domain/feature rules.
```

### adapters-keycloak ? must not import React or features

`@platform/adapters-keycloak` must not import:

```text
react, react-dom
@platform/ui-design-system
@platform/feature-* packages
```

The Keycloak adapter is a server-side integration only. React-side auth flows, if ever needed, require a separate browser-side adapter with its own ADR.

### domain-identity ? pure domain rules

`@platform/domain-identity` follows the same zero-infrastructure-dependency pattern as other domain packages. It must not import:

```text
adapters, API runtime, session runtime, pino, OTel, Sentry, React, UI
```

It may import `@platform/platform-runtime-context` for typed value objects if needed.

### contracts-auth ? Zod schemas only

`@platform/contracts-auth` must not import:

```text
Any @platform/adapters-* package
Any @platform/domain-* package
Session runtime, logging, observability
keycloak-js, @keycloak/*
react, react-dom
```

It exports SessionActor, auth request/response Zod schemas, and AuthError subtypes only.
