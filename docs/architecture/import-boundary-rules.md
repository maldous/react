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

@platform/feature-workflow may not import:
  @platform/adapters-postgres
  @platform/adapters-clickhouse
  direct database clients
  @platform/test-support in production source
```

Feature packages compose workflows. They do not own persistence or analytics runtime.

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

## Application boundary

```text
@platform/react-enterprise-app may import:
  feature packages
  GraphQL/runtime adapters
  access-control package for role-aware composition

@platform/react-enterprise-app may not import:
  direct PostgreSQL clients
  direct ClickHouse clients
  contract internals
  package internals
  test-support in production source
```

## Initial allowed dependency matrix

| Package | May depend on |
|---|---|
| @platform/react-enterprise-app | feature-workflow, access-control, adapters-graphql |
| @platform/feature-workflow | ui-design-system, domain-core, profile-configuration, access-control, contracts-graphql, contracts-analytics |
| @platform/ui-design-system | none of the runtime/domain packages |
| @platform/domain-core | none of the platform runtime packages |
| @platform/profile-configuration | domain-core |
| @platform/access-control | domain-core, profile-configuration |
| @platform/contracts-graphql | profile-configuration, access-control, contracts-analytics |
| @platform/contracts-ingestion | none of the runtime adapter packages |
| @platform/contracts-analytics | none of the runtime adapter packages |
| @platform/adapters-graphql | contracts-graphql, adapters-postgres, adapters-clickhouse |
| @platform/adapters-ingestion | contracts-ingestion, adapters-postgres, adapters-clickhouse |
| @platform/adapters-postgres | profile-configuration, access-control |
| @platform/adapters-clickhouse | contracts-analytics, contracts-ingestion |
| @platform/tooling-codegen | contracts-graphql |
| @platform/test-support | contracts-graphql, contracts-ingestion, contracts-analytics, ui-design-system |
```

## Enforcement status

These rules are currently validated against package metadata declarations.

Future source-code import scanning should enforce the same rules against actual TypeScript import statements.
