# Package and module naming conventions

This document formalises package and module naming conventions for the generic enterprise React skeleton.

It closes ADR-ACT-0013.

## Naming principles

```text
Use generic architectural responsibility names.
Do not assume a product-domain end state.
Use product-domain names only when the package explicitly owns that product domain.
Keep contracts separate from adapters.
Keep transactional persistence separate from analytics persistence.
Keep runtime adapters separate from pure domain packages.
Keep test-support separate from production packages.
Use lowercase kebab-case for directories and package names.
Use package.json name as the public package identity.
```

## Root layout naming

```text
apps/
  deployable or runtime application surfaces

packages/
  shared packages, contracts, adapters, domain packages, tooling, and test support

tools/architecture/
  architecture governance tooling
```

## Package scope

```text
@platform/*
  product/platform application and package skeleton

@architecture/*
  architecture governance tooling packages
```

## Application naming

```text
apps/react-enterprise-app
@platform/react-enterprise-app
```

Rules:

```text
application packages may include the runtime framework when the framework is part of the package responsibility
application package names should describe the application surface, not a product domain
application packages may depend on feature and adapter packages through public exports only
```

## Feature package naming

```text
packages/feature-<capability>
@platform/feature-<capability>
```

Initial generic package:

```text
packages/feature-workflow
@platform/feature-workflow
```

Rules:

```text
feature packages own workflow composition
feature packages must not own transport, persistence, or reusable UI primitives
feature packages may use generic capability names until a product-domain boundary is intentionally accepted
```

## UI package naming

```text
packages/ui-<capability>
@platform/ui-<capability>
```

Initial generic package:

```text
packages/ui-design-system
@platform/ui-design-system
```

Rules:

```text
UI packages are presentational
UI packages must not fetch GraphQL data
UI packages must not own domain policy
```

## Domain package naming

```text
packages/domain-<capability>
@platform/domain-<capability>
```

Initial generic package:

```text
packages/domain-core
@platform/domain-core
```

Rules:

```text
domain packages are pure TypeScript
domain packages must not depend on React runtime, storage adapters, or GraphQL clients
domain packages should describe policy/model ownership, not persistence technology
```

## Profile and access package naming

```text
packages/profile-configuration
@platform/profile-configuration

packages/access-control
@platform/access-control
```

Rules:

```text
profile/configuration packages own storage-independent profile, preference, setting, entitlement, and configuration rules
access-control packages own generic admin, staff, user, service, and support role policy
neither package should connect directly to identity providers or databases
```

## Contract package naming

```text
packages/contracts-<capability>
@platform/contracts-<capability>
```

Initial packages:

```text
packages/contracts-graphql
packages/contracts-ingestion
packages/contracts-analytics
```

Rules:

```text
contracts define schemas, operations, payloads, events, and generated types
contracts must not own runtime clients, storage connections, or feature workflow composition
GraphQL contracts must remain separate from GraphQL adapters
external ingestion contracts must remain separate from ingestion runtime adapters
analytics contracts must remain separate from ClickHouse adapters
```

## Adapter package naming

```text
packages/adapters-<technology-or-runtime>
@platform/adapters-<technology-or-runtime>
```

Initial packages:

```text
packages/adapters-graphql
packages/adapters-ingestion
packages/adapters-postgres
packages/adapters-clickhouse
packages/adapters-keycloak
packages/adapters-redis
packages/adapters-sentry
packages/adapters-opentelemetry
packages/adapters-object-storage
```

Rules:

```text
adapters own runtime integration boundaries
adapter names may include technology names when the technology is the package responsibility
PostgreSQL appears only in transactional persistence adapter naming
ClickHouse appears only in analytical adapter naming
external ingestion runtime appears only in ingestion adapter naming
adapters must not define contract ownership
operations adapters (keycloak, redis, sentry, opentelemetry, object-storage) implement interfaces defined by operations platform packages
operations adapters must not be imported directly by feature or domain packages
```

## Operations runtime package naming

```text
packages/<capability>-runtime
@platform/<capability>-runtime
```

Packages:

```text
packages/api-runtime          HTTP API server runtime
packages/graphql-api-runtime  GraphQL server runtime
packages/worker-runtime       Background worker runtime
packages/config-runtime       Configuration service
packages/session-runtime      Session service
packages/queue-runtime        Queue abstraction
packages/storage-runtime      Object storage abstraction
```

And standalone platform packages:

```text
packages/security-auth        Authentication abstraction and RBAC
packages/audit-events         Audit event bus
packages/observability        Observability abstraction (logs, metrics, traces)
```

Rules:

```text
operations runtime packages own server-side process lifecycle and cross-cutting platform concerns
operations platform packages (security-auth, observability, queue-runtime, storage-runtime, audit-events, config-runtime) define interfaces — adapters implement them
operations runtime packages must not be imported by domain or contract packages
feature packages may import queue-runtime and storage-runtime to enqueue jobs or request presigned URLs
feature packages must not import session-runtime, security-auth, api-runtime, graphql-api-runtime, or worker-runtime
```

## Tooling package naming

```text
packages/tooling-<capability>
@platform/tooling-<capability>
```

Initial packages:

```text
packages/tooling-codegen      GraphQL codegen and artifact workflows
packages/tooling-docker       Container build tooling
packages/tooling-terraform    Terraform workflow tooling
packages/tooling-ci           CI/CD pipeline definitions
```

Rules:

```text
tooling packages support developer workflow or CI
tooling packages must not become application runtime dependencies
```

## Delivery infrastructure package naming

```text
packages/infra-<provider>
@platform/infra-<provider>

packages/dev-<capability>
@platform/dev-<capability>
```

Packages:

```text
packages/infra-aws            AWS infrastructure definitions
packages/dev-services         Local development Docker Compose and seed scripts
```

Rules:

```text
delivery packages are non-production and must carry production: false in runtime metadata
delivery packages must not be imported by any platform, feature, domain, contract, adapter, or application package
infra packages contain provider-specific infrastructure definitions (Terraform, CDK, CloudFormation)
dev packages contain local-only service definitions and seed data
```

## Test package naming

```text
packages/test-support
@platform/test-support
```

Rules:

```text
test packages must use active.test lifecycle metadata
test packages must not be imported by production packages
test packages may own fixtures, MSW handlers, React Testing Library helpers, and Playwright fixtures
```

## Module naming inside packages

```text
src/index.ts
src/<capability>.ts
src/<capability>.test.ts
```

Rules:

```text
src/index.ts is the public export entry point
internal modules should use lowercase kebab-case filenames
deep imports are not part of the public contract
public API must be exported through package.json exports and src/index.ts
```

## Current skeleton validation

The current skeleton conforms to these naming conventions:

```text
apps/react-enterprise-app
packages/feature-workflow
packages/ui-design-system
packages/domain-core
packages/profile-configuration
packages/access-control
packages/contracts-graphql
packages/contracts-ingestion
packages/adapters-ingestion
packages/adapters-graphql
packages/adapters-postgres
packages/contracts-analytics
packages/adapters-clickhouse
packages/api-runtime
packages/graphql-api-runtime
packages/worker-runtime
packages/config-runtime
packages/session-runtime
packages/security-auth
packages/audit-events
packages/observability
packages/queue-runtime
packages/storage-runtime
packages/adapters-keycloak
packages/adapters-redis
packages/adapters-sentry
packages/adapters-opentelemetry
packages/adapters-object-storage
packages/dev-services
packages/tooling-docker
packages/tooling-terraform
packages/tooling-ci
packages/infra-aws
packages/tooling-codegen
packages/test-support
```
