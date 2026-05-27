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
| packages/api-runtime | @platform/api-runtime | active.platform | operations | api-server |
| packages/graphql-api-runtime | @platform/graphql-api-runtime | active.platform | operations | graphql-server |
| packages/worker-runtime | @platform/worker-runtime | active.platform | operations | worker-server |
| packages/config-runtime | @platform/config-runtime | active.platform | operations | config-service |
| packages/session-runtime | @platform/session-runtime | active.platform | operations | session-service |
| packages/security-auth | @platform/security-auth | active.platform | operations | auth-gateway |
| packages/audit-events | @platform/audit-events | active.platform | operations | audit-service |
| packages/observability | @platform/observability | active.platform | operations | observability-core |
| packages/queue-runtime | @platform/queue-runtime | active.platform | operations | queue-service |
| packages/storage-runtime | @platform/storage-runtime | active.platform | operations | storage-service |
| packages/adapters-keycloak | @platform/adapters-keycloak | active.adapter | operations | auth-keycloak |
| packages/adapters-redis | @platform/adapters-redis | active.adapter | operations | cache-queue-redis |
| packages/adapters-sentry | @platform/adapters-sentry | active.adapter | operations | error-monitoring |
| packages/adapters-opentelemetry | @platform/adapters-opentelemetry | active.adapter | operations | telemetry |
| packages/adapters-object-storage | @platform/adapters-object-storage | active.adapter | operations | object-storage |
| packages/dev-services | @platform/dev-services | active.tooling | delivery | dev-local |
| packages/tooling-docker | @platform/tooling-docker | active.tooling | delivery | container-build |
| packages/tooling-terraform | @platform/tooling-terraform | active.tooling | delivery | terraform-workflow |
| packages/tooling-ci | @platform/tooling-ci | active.tooling | delivery | ci-pipeline |
| packages/infra-aws | @platform/infra-aws | active.tooling | delivery | aws-infra |
| packages/tooling-codegen | @platform/tooling-codegen | active.tooling | architecture | codegen |
| packages/test-support | @platform/test-support | active.test | quality | test-support |

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
operations platform packages use descriptive capability names (api-runtime, worker-runtime, config-runtime, etc.)
operations adapter packages follow the adapters-<technology> convention (adapters-keycloak, adapters-redis, etc.)
delivery packages are not importable by production packages and must have production: false in runtime metadata
```
