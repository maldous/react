# Initial import-boundary validation

```text
Rule set: docs/architecture/import-boundary-rules.md
Total packages: 15
Passed: 15
Failed: 0
```

| Package | Lifecycle | Domain | Context | Result |
|---|---|---|---|---|
| @platform/access-control | stable.platform | core | access-control | PASS |
| @platform/adapters-clickhouse | active.adapter | analytics | clickhouse-runtime | PASS |
| @platform/adapters-graphql | active.adapter | integration | graphql-runtime | PASS |
| @platform/adapters-ingestion | active.adapter | integration | external-ingestion-runtime | PASS |
| @platform/adapters-postgres | active.adapter | persistence | postgres-runtime | PASS |
| @platform/contracts-analytics | active.contract | analytics | analytics-contracts | PASS |
| @platform/contracts-graphql | active.contract | core | graphql-contracts | PASS |
| @platform/contracts-ingestion | active.contract | integration | external-ingestion-contracts | PASS |
| @platform/domain-core | stable.platform | core | domain-core | PASS |
| @platform/feature-workflow | active.feature | experience | workflow | PASS |
| @platform/profile-configuration | stable.platform | core | profile-configuration | PASS |
| @platform/react-enterprise-app | active.feature | experience | app-shell | PASS |
| @platform/test-support | active.test | quality | test-support | PASS |
| @platform/tooling-codegen | active.tooling | architecture | codegen | PASS |
| @platform/ui-design-system | active.platform | experience | design-system | PASS |
