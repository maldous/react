# Packages Codemap

**Last Updated:** 2026-06-21

41 packages organized by role: domain, contracts, adapters, runtimes, experience, tooling, and delivery.

## Adapters (11)

| Name                              | Lifecycle | Context                    | @platform Deps |
| --------------------------------- | --------- | -------------------------- | -------------- |
| @platform/adapters-brevo          | active    | email-brevo                | —              |
| @platform/adapters-clickhouse     | active    | clickhouse-runtime         | —              |
| @platform/adapters-graphql        | active    | graphql-runtime            | —              |
| @platform/adapters-ingestion      | active    | external-ingestion-runtime | —              |
| @platform/adapters-keycloak       | active    | auth-keycloak              | —              |
| @platform/adapters-loki           | active    | loki-runtime               | —              |
| @platform/adapters-object-storage | active    | object-storage             | —              |
| @platform/adapters-opentelemetry  | active    | telemetry                  | —              |
| @platform/adapters-postgres       | active    | postgres-runtime           | —              |
| @platform/adapters-redis          | active    | cache-queue-redis          | —              |
| @platform/adapters-sentry         | active    | error-monitoring           | —              |

## Core & Runtimes (13)

| Name                               | Lifecycle    | Context            | @platform Deps |
| ---------------------------------- | ------------ | ------------------ | -------------- |
| @platform/api-runtime              | active       | api-server         | —              |
| @platform/audit-events             | active       | audit-service      | —              |
| @platform/authorisation-runtime    | active       | authorisation      | —              |
| @platform/config-runtime           | active       | config-service     | —              |
| @platform/domain-identity          | experimental | domain-core        | —              |
| @platform/email-runtime            | active       | email-service      | —              |
| @platform/graphql-api-runtime      | active       | graphql-server     | —              |
| @platform/graphql-browser-client   | active       | graphql-client     | —              |
| @platform/i18n-runtime             | experimental | app-shell          | —              |
| @platform/platform-errors          | experimental | api-server         | —              |
| @platform/platform-runtime-context | experimental | observability-core | —              |
| @platform/session-runtime          | active       | session-service    | —              |
| @platform/storage-runtime          | active       | storage-service    | —              |

## Contracts (6)

| Name                             | Lifecycle    | Context                      | @platform Deps |
| -------------------------------- | ------------ | ---------------------------- | -------------- |
| @platform/contracts-admin        | experimental | tenant-administration        | —              |
| @platform/contracts-analytics    | active       | analytics-contracts          | —              |
| @platform/contracts-auth         | experimental | auth-gateway                 | —              |
| @platform/contracts-graphql      | active       | graphql-contracts            | —              |
| @platform/contracts-ingestion    | active       | external-ingestion-contracts | —              |
| @platform/contracts-organisation | experimental | profile-configuration        | —              |

## Platform Services (2)

| Name                             | Lifecycle    | Context            | @platform Deps           |
| -------------------------------- | ------------ | ------------------ | ------------------------ |
| @platform/platform-logging       | experimental | observability-core | platform-runtime-context |
| @platform/platform-observability | experimental | observability-core | platform-runtime-context |

## Experience (1)

| Name                       | Lifecycle | Context       | @platform Deps |
| -------------------------- | --------- | ------------- | -------------- |
| @platform/ui-design-system | active    | design-system | —              |

## Delivery (4)

| Name                       | Lifecycle | Context          | @platform Deps |
| -------------------------- | --------- | ---------------- | -------------- |
| @platform/dev-services     | active    | dev-local        | —              |
| @platform/infra-aws        | active    | aws-infra        | —              |
| @platform/infra-cloudflare | active    | cloudflare-infra | —              |
| @platform/test-support     | active    | test-support     | —              |

## Tooling (4)

| Name                        | Lifecycle | Context            | @platform Deps |
| --------------------------- | --------- | ------------------ | -------------- |
| @platform/tooling-ci        | active    | ci-pipeline        | —              |
| @platform/tooling-codegen   | active    | codegen            | —              |
| @platform/tooling-docker    | active    | container-build    | —              |
| @platform/tooling-terraform | active    | terraform-workflow | —              |

## Total: 41 packages

**Lifecycle Distribution**: 32 active, 9 experimental

**Dependency Density**: Most packages have zero @platform/\* dependencies (leaf nodes per ADR-0020). Only platform-logging and platform-observability import platform-runtime-context.

**Key Boundary Rules**: ADR-0001 (hexagonal), ADR-0003 (monorepo), ADR-0020 (observability separation), ADR-0022 (auth adapter only).
