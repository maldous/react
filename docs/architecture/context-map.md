# Initial context map

This document defines the initial bounded contexts and package domain values used by the generic enterprise React package skeleton.

No product-specific end state is assumed.

## Domain values

```text
experience
core
integration
persistence
analytics
architecture
quality
```

## Bounded contexts

| Domain | Bounded context | Purpose | Initial package |
|---|---|---|---|
| experience | app-shell | Generic browser application shell, routing, runtime composition | @platform/react-enterprise-app |
| experience | workflow | Generic enterprise workflow and feature composition | @platform/feature-workflow |
| experience | design-system | Reusable presentational React components | @platform/ui-design-system |
| core | domain-core | Generic pure TypeScript domain-core policy, validation, and state-transition primitives | @platform/domain-core |
| core | profile-configuration | User profile, preferences, settings, entitlements, and runtime configuration models | @platform/profile-configuration |
| core | access-control | Generic admin, staff, user, service, and support role and permission policy | @platform/access-control |
| core | graphql-contracts | GraphQL operations, fragments, and generated TypedDocumentNode contract artifacts | @platform/contracts-graphql |
| integration | external-ingestion-contracts | External data payload, normalization, and ingestion event contracts | @platform/contracts-ingestion |
| integration | external-ingestion-runtime | External data ingestion runtime adapters and normalization flow | @platform/adapters-ingestion |
| integration | graphql-runtime | GraphQL runtime transport, cache, auth, error, and retry binding | @platform/adapters-graphql |
| persistence | postgres-runtime | PostgreSQL transactional persistence for profile/configuration, role assignments, and operational state | @platform/adapters-postgres |
| analytics | analytics-contracts | Analytical event and query contracts | @platform/contracts-analytics |
| analytics | clickhouse-runtime | ClickHouse analytical event storage, ingestion, and query runtime | @platform/adapters-clickhouse |
| architecture | codegen | GraphQL Code Generator and architecture-safe generated artifact workflows | @platform/tooling-codegen |
| quality | test-support | Test-only MSW GraphQL handlers, React Testing Library helpers, Playwright fixtures, and generic role fixtures | @platform/test-support |
```

## Context rules

```text
experience packages may compose user-facing workflows
core packages must not depend on experience, integration, persistence, or analytics runtime packages
profile/configuration policy must remain storage-independent
access-control policy must remain storage-independent and identity-provider-independent
PostgreSQL owns transactional persistence for profile/configuration, role assignments, and operational state
ClickHouse owns analytical event storage, ingestion event history, and high-volume reporting queries
external ingestion contracts must remain separate from ingestion runtime adapters
GraphQL contracts must remain separate from GraphQL runtime adapters
quality test packages must not be imported by production packages
```
