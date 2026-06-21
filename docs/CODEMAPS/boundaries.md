# Import Boundary Rules Codemap

**Last Updated:** 2026-06-07

39 rules enforcing layering, package isolation, and contract purity. Validated by `tools/architecture/validate-source-imports`.

## Core Isolation Rules (13)

| Rule                               | Applies To                    | Forbidden                                                  | Rationale              |
| ---------------------------------- | ----------------------------- | ---------------------------------------------------------- | ---------------------- |
| no-adapters-in-contracts-graphql   | @platform/contracts-graphql   | adapters-graphql                                           | Runtime-free contracts |
| no-adapters-in-contracts-ingestion | @platform/contracts-ingestion | adapters-ingestion, adapters-postgres, adapters-clickhouse | Runtime-free contracts |
| no-adapters-in-contracts-analytics | @platform/contracts-analytics | adapters-clickhouse                                        | Runtime-free contracts |
| no-adapters-in-feature             | @platform/feature-workflow    | adapters-postgres, adapters-clickhouse                     | No persistence deps    |

## Feature Isolation (2)

| Rule                              | Applies To                 | Forbidden                                                                                                           | Rationale               |
| --------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| no-operations-adapters-in-feature | @platform/feature-workflow | adapters-keycloak, adapters-redis, adapters-sentry, adapters-opentelemetry, adapters-object-storage, adapters-brevo | No operations adapters  |
| no-server-runtime-in-feature      | @platform/feature-workflow | api-runtime, graphql-api-runtime, worker-runtime, session-runtime, security-auth                                    | No server-side runtimes |

## Leaf Node Rules (9)

Interface packages with zero @platform/\* dependencies (ADR-0020):

| Rule                                     | Applies To                     | Forbidden    | Rationale                     |
| ---------------------------------------- | ------------------------------ | ------------ | ----------------------------- |
| no-platform-deps-in-security-auth        | @platform/security-auth        | @platform/\* | Leaf node: auth abstraction   |
| no-platform-deps-in-observability        | @platform/observability        | @platform/\* | Leaf node: observability port |
| no-platform-deps-in-queue-runtime        | @platform/queue-runtime        | @platform/\* | Leaf node: queue port         |
| no-platform-deps-in-storage-runtime      | @platform/storage-runtime      | @platform/\* | Leaf node: storage port       |
| no-platform-deps-in-audit-events         | @platform/audit-events         | @platform/\* | Leaf node: audit event bus    |
| no-platform-deps-in-config-runtime       | @platform/config-runtime       | @platform/\* | Leaf node: config port        |
| no-platform-deps-in-email-runtime        | @platform/email-runtime        | @platform/\* | Leaf node: email port         |
| no-platform-deps-in-notification-runtime | @platform/notification-runtime | @platform/\* | Leaf node: notification port  |
| no-platform-deps-in-search-runtime       | @platform/search-runtime       | @platform/\* | Leaf node: search port        |

## Observability Purity Rules (5)

ADR-0020: Observability flows through adapter layer only.

| Rule                              | Applies To                                                  | Forbidden                                                                                                                                                                                                                                     | Rationale                                       |
| --------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| no-raw-observability-in-domain    | domain-core                                                 | @opentelemetry/_, @sentry/_, @platform/platform-logging, @platform/platform-observability, @platform/adapters-opentelemetry, @platform/adapters-sentry, pino                                                                                  | No SDK direct imports                           |
| no-raw-observability-in-feature   | @platform/feature-workflow                                  | @opentelemetry/sdk-_, @sentry/_, @platform/platform-logging, @platform/platform-observability, @platform/adapters-opentelemetry, @platform/adapters-sentry, pino                                                                              | No SDK direct imports                           |
| no-observability-in-ui            | @platform/ui-design-system                                  | @platform/platform-logging, @platform/platform-observability, @platform/platform-runtime-context, @platform/adapters-opentelemetry, @platform/adapters-sentry, @opentelemetry/_, @sentry/_, pino, @platform/platform-errors                   | UI: display only                                |
| no-raw-observability-in-contracts | contracts-graphql, contracts-analytics, contracts-ingestion | @opentelemetry/sdk-_, @sentry/_, @platform/platform-logging, @platform/platform-observability, @platform/adapters-opentelemetry, @platform/adapters-sentry, pino                                                                              | No SDK in contracts                             |
| no-sdk-in-platform-observability  | @platform/platform-observability                            | @opentelemetry/sdk-_, @opentelemetry/auto-instrumentations-_, @opentelemetry/exporter-_, @opentelemetry/instrumentation-_, @sentry/_, @platform/adapters-_, @platform/platform-logging, pino, feature-workflow, ui-design-system, domain-core | API wrapper only; SDK in adapters-opentelemetry |

## Authentication Integration (3)

ADR-0022: Keycloak adapter only.

| Rule                          | Applies To                                                                  | Forbidden                                                                                                     | Rationale                 |
| ----------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------- |
| no-keycloak-sdk-in-domain     | domain-identity                                                             | @keycloak/\*, keycloak-js                                                                                     | Domain has no SDK deps    |
| no-keycloak-sdk-in-features   | @platform/feature-workflow                                                  | @keycloak/\*, keycloak-js                                                                                     | Features have no SDK deps |
| no-keycloak-sdk-in-contracts  | contracts-graphql, contracts-analytics, contracts-ingestion, contracts-auth | @keycloak/\*, keycloak-js, @platform/adapters-keycloak                                                        | Contracts: DTO only       |
| no-react-in-adapters-keycloak | @platform/adapters-keycloak                                                 | @platform/feature-_, @platform/ui-_, react, react-dom, @platform/ui-design-system, @platform/feature-workflow | Adapter: server-side only |

## Special Rules (3)

| Rule                                         | Applies To                         | Forbidden                                                                                                                            | Rationale                          |
| -------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| no-platform-deps-in-platform-runtime-context | @platform/platform-runtime-context | @platform/\*                                                                                                                         | Zero @platform deps (ADR-0020)     |
| no-platform-deps-in-platform-errors          | @platform/platform-errors          | @platform/\*                                                                                                                         | Browser-safe, zero deps (ADR-0020) |
| no-disallowed-in-platform-logging            | @platform/platform-logging         | @opentelemetry/_, @sentry/_, @platform/adapters-_, @platform/platform-observability, feature-workflow, ui-design-system, contracts-_ | Pino wrapper only (ADR-0020)       |

## SPA Boundary (1)

| Rule                            | Applies To                     | Forbidden                                                                                                            | Rationale                                 |
| ------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| no-server-packages-in-react-spa | @platform/react-enterprise-app | api-runtime, platform-logging, platform-observability, platform-runtime-context, adapters-\*, platform-api, pg, pino | Browser-only; BFF routes all server calls |

---

## Validation

Run: `npx tsx tools/architecture/validate-source-imports`

All rules are machine-enforced. Violations block CI/CD (see ADR-0011).
