# Packages Codemap

**Last Updated:** 2026-06-18

48 packages organized by role: domain, contracts, adapters, runtimes, features, tooling, and apps.

## Domain & Policy (3)

| Name                            | Lifecycle    | Context               | @platform Deps |
| ------------------------------- | ------------ | --------------------- | -------------- |
| @platform/domain-core           | deprecated   | domain-core           | —              |
| @platform/domain-identity       | experimental | domain-core           | —              |
| @platform/profile-configuration | deprecated   | profile-configuration | —              |

## Contracts (4)

| Name                             | Lifecycle    | Context                      | @platform Deps |
| -------------------------------- | ------------ | ---------------------------- | -------------- |
| @platform/contracts-auth         | experimental | auth-gateway                 | —              |
| @platform/contracts-analytics    | active       | analytics-contracts          | —              |
| @platform/contracts-graphql      | active       | graphql-contracts            | —              |
| @platform/contracts-ingestion    | active       | external-ingestion-contracts | —              |
| @platform/contracts-organisation | experimental | profile-configuration        | —              |

## Policy/Control (2)

| Name                            | Lifecycle  | Context        | @platform Deps |
| ------------------------------- | ---------- | -------------- | -------------- |
| @platform/access-control        | deprecated | access-control | —              |
| @platform/authorisation-runtime | active     | authorisation  | —              |

## Observability & Errors (5)

| Name                               | Lifecycle    | Context            | @platform Deps           |
| ---------------------------------- | ------------ | ------------------ | ------------------------ |
| @platform/platform-errors          | experimental | api-server         | —                        |
| @platform/platform-runtime-context | experimental | observability-core | —                        |
| @platform/platform-logging         | experimental | observability-core | platform-runtime-context |
| @platform/platform-observability   | experimental | observability-core | platform-runtime-context |
| @platform/observability            | active       | observability-core | —                        |

## Adapters (11)

| Name                              | Lifecycle | Context                    | @platform Deps |
| --------------------------------- | --------- | -------------------------- | -------------- |
| @platform/adapters-brevo          | active    | email-brevo                | —              |
| @platform/adapters-clickhouse     | active    | clickhouse-runtime         | —              |
| @platform/adapters-graphql        | active    | graphql-runtime            | —              |
| @platform/adapters-ingestion      | active    | external-ingestion-runtime | —              |
| @platform/adapters-keycloak       | active    | auth-keycloak              | —              |
| @platform/adapters-object-storage | active    | object-storage             | —              |
| @platform/adapters-opentelemetry  | active    | telemetry                  | —              |
| @platform/adapters-postgres       | active    | postgres-runtime           | —              |
| @platform/adapters-redis          | active    | cache-queue-redis          | —              |
| @platform/adapters-sentry         | active    | error-monitoring           | —              |
| @platform/adapters-ingestion      | active    | external-ingestion-runtime | —              |

## Runtimes (16)

| Name                           | Lifecycle  | Context              | @platform Deps |
| ------------------------------ | ---------- | -------------------- | -------------- |
| @platform/api-runtime          | active     | api-server           | —              |
| @platform/graphql-api-runtime  | active     | graphql-server       | —              |
| @platform/worker-runtime       | deprecated | worker-server        | —              |
| @platform/session-runtime      | active     | session-service      | —              |
| @platform/security-auth        | deprecated | auth-gateway         | —              |
| @platform/audit-events         | active     | audit-service        | —              |
| @platform/config-runtime       | active     | config-service       | —              |
| @platform/email-runtime        | active     | email-service        | —              |
| @platform/notification-runtime | deprecated | notification-service | —              |
| @platform/queue-runtime        | deprecated | queue-service        | —              |
| @platform/search-runtime       | deprecated | search-service       | —              |
| @platform/storage-runtime      | active     | storage-service      | —              |

## UI & Features (2)

| Name                       | Lifecycle  | Context       | @platform Deps |
| -------------------------- | ---------- | ------------- | -------------- |
| @platform/ui-design-system | active     | design-system | —              |
| @platform/feature-workflow | deprecated | workflow      | —              |

## i18n (1)

| Name                   | Lifecycle    | Context   | @platform Deps |
| ---------------------- | ------------ | --------- | -------------- |
| @platform/i18n-runtime | experimental | app-shell | —              |

## Infrastructure & Tooling (8)

| Name                        | Lifecycle | Context            | @platform Deps |
| --------------------------- | --------- | ------------------ | -------------- |
| @platform/infra-aws         | active    | aws-infra          | —              |
| @platform/infra-cloudflare  | active    | cloudflare-infra   | —              |
| @platform/tooling-ci        | active    | ci-pipeline        | —              |
| @platform/tooling-codegen   | active    | codegen            | —              |
| @platform/tooling-docker    | active    | container-build    | —              |
| @platform/tooling-terraform | active    | terraform-workflow | —              |
| @platform/dev-services      | active    | dev-local          | —              |
| @platform/test-support      | active    | test-support       | —              |

## Total: 48 packages

**Lifecycle Distribution**: 5 stable, 31 active, 9 experimental, 9 deprecated (ADR-ACT-0288 — superseded scaffolding, pending removal review 2026-12-18)

**Dependency Density**: Most packages have zero @platform/\* dependencies (leaf nodes per ADR-0020). Only platform-logging and platform-observability import platform-runtime-context.

**Key Boundary Rules**: ADR-0001 (hexagonal), ADR-0003 (monorepo), ADR-0020 (observability separation), ADR-0022 (auth adapter only).
