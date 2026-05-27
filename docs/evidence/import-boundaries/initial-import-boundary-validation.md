# Initial import-boundary validation

```text
Rule set: docs/architecture/import-boundary-rules.md
Total packages: 35
Passed: 35
Failed: 0
```

| Package | Lifecycle | Domain | Context | Result |
|---|---|---|---|---|
| @platform/access-control | stable.platform | core | access-control | PASS |
| @platform/adapters-clickhouse | active.adapter | analytics | clickhouse-runtime | PASS |
| @platform/adapters-graphql | active.adapter | integration | graphql-runtime | PASS |
| @platform/adapters-ingestion | active.adapter | integration | external-ingestion-runtime | PASS |
| @platform/adapters-keycloak | active.adapter | operations | auth-keycloak | PASS |
| @platform/adapters-object-storage | active.adapter | operations | object-storage | PASS |
| @platform/adapters-opentelemetry | active.adapter | operations | telemetry | PASS |
| @platform/adapters-postgres | active.adapter | persistence | postgres-runtime | PASS |
| @platform/adapters-redis | active.adapter | operations | cache-queue-redis | PASS |
| @platform/adapters-sentry | active.adapter | operations | error-monitoring | PASS |
| @platform/api-runtime | active.platform | operations | api-server | PASS |
| @platform/audit-events | active.platform | operations | audit-service | PASS |
| @platform/config-runtime | active.platform | operations | config-service | PASS |
| @platform/contracts-analytics | active.contract | analytics | analytics-contracts | PASS |
| @platform/contracts-graphql | active.contract | core | graphql-contracts | PASS |
| @platform/contracts-ingestion | active.contract | integration | external-ingestion-contracts | PASS |
| @platform/dev-services | active.tooling | delivery | dev-local | PASS |
| @platform/domain-core | stable.platform | core | domain-core | PASS |
| @platform/feature-workflow | active.feature | experience | workflow | PASS |
| @platform/graphql-api-runtime | active.platform | operations | graphql-server | PASS |
| @platform/infra-aws | active.tooling | delivery | aws-infra | PASS |
| @platform/observability | active.platform | operations | observability-core | PASS |
| @platform/profile-configuration | stable.platform | core | profile-configuration | PASS |
| @platform/queue-runtime | active.platform | operations | queue-service | PASS |
| @platform/react-enterprise-app | active.feature | experience | app-shell | PASS |
| @platform/security-auth | active.platform | operations | auth-gateway | PASS |
| @platform/session-runtime | active.platform | operations | session-service | PASS |
| @platform/storage-runtime | active.platform | operations | storage-service | PASS |
| @platform/test-support | active.test | quality | test-support | PASS |
| @platform/tooling-ci | active.tooling | delivery | ci-pipeline | PASS |
| @platform/tooling-codegen | active.tooling | architecture | codegen | PASS |
| @platform/tooling-docker | active.tooling | delivery | container-build | PASS |
| @platform/tooling-terraform | active.tooling | delivery | terraform-workflow | PASS |
| @platform/ui-design-system | active.platform | experience | design-system | PASS |
| @platform/worker-runtime | active.platform | operations | worker-server | PASS |
