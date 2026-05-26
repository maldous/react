# Initial package naming

Package names use a stable scoped format:

```text
@platform/<role-or-capability>
```

Names are generic. They describe architectural responsibility rather than product intent.

## Initial package names

| Path | Package name | Lifecycle class | Domain | Bounded context |
|---|---|---|---|---|
| apps/react-enterprise-app | @platform/react-enterprise-app | active.feature | experience | app-shell |
| packages/feature-workflow | @platform/feature-workflow | active.feature | experience | workflow |
| packages/ui-design-system | @platform/ui-design-system | active.platform | experience | design-system |
| packages/domain-core | @platform/domain-core | stable.platform | core | domain-core |
| packages/profile-configuration | @platform/profile-configuration | stable.platform | core | profile-configuration |
| packages/access-control | @platform/access-control | stable.platform | core | access-control |
| packages/contracts-graphql | @platform/contracts-graphql | active.contract | core | graphql-contracts |
| packages/contracts-ingestion | @platform/contracts-ingestion | active.contract | integration | external-ingestion-contracts |
| packages/adapters-ingestion | @platform/adapters-ingestion | active.adapter | integration | external-ingestion-runtime |
| packages/adapters-graphql | @platform/adapters-graphql | active.adapter | integration | graphql-runtime |
| packages/adapters-postgres | @platform/adapters-postgres | active.adapter | persistence | postgres-runtime |
| packages/contracts-analytics | @platform/contracts-analytics | active.contract | analytics | analytics-contracts |
| packages/adapters-clickhouse | @platform/adapters-clickhouse | active.adapter | analytics | clickhouse-runtime |
| packages/tooling-codegen | @platform/tooling-codegen | active.tooling | architecture | codegen |
| packages/test-support | @platform/test-support | active.test | quality | test-support |
```

## Naming rules

```text
application packages live under apps/
shared and reusable packages live under packages/
package names must match public package identity
package folder names should be lowercase kebab-case
package names should avoid product-domain language unless the package boundary genuinely owns that product domain
GraphQL contract and adapter packages must remain separate
external ingestion contract and adapter packages must remain separate
PostgreSQL and ClickHouse adapters must remain separate because they serve different data ownership models
test-support packages must use active.test lifecycle metadata
```
