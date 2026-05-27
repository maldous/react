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
operations
delivery
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
| operations | api-server | HTTP API server lifecycle, middleware pipeline, auth enforcement, and response envelope | @platform/api-runtime |
| operations | graphql-server | GraphQL server runtime, resolver execution, DataLoader batching, and schema stitching | @platform/graphql-api-runtime |
| operations | worker-server | Background worker lifecycle, job dispatch, retry policy, and concurrency control | @platform/worker-runtime |
| operations | config-service | Environment variable loading, typed config access, and secret resolution | @platform/config-runtime |
| operations | session-service | Server-side session storage, token binding, and claims propagation | @platform/session-runtime |
| operations | auth-gateway | Authentication abstraction, token validation, RBAC primitives, and auth provider interface | @platform/security-auth |
| operations | audit-service | Structured audit event emission and durable delivery contracts | @platform/audit-events |
| operations | observability-core | Structured logging, metrics, distributed tracing, and health check interface | @platform/observability |
| operations | queue-service | Job enqueue interface, queue topology contracts, and delivery guarantee definitions | @platform/queue-runtime |
| operations | storage-service | Object storage abstraction, file upload interface, and presigned URL contracts | @platform/storage-runtime |
| operations | auth-keycloak | Keycloak OIDC token validation and auth provider implementation | @platform/adapters-keycloak |
| operations | cache-queue-redis | Redis connection management, cache operations, and BullMQ queue broker | @platform/adapters-redis |
| operations | error-monitoring | Sentry error capture and performance tracing implementation | @platform/adapters-sentry |
| operations | telemetry | OpenTelemetry distributed tracing and metrics export implementation | @platform/adapters-opentelemetry |
| operations | object-storage | AWS S3 client, presigned URL generation, and storage interface implementation | @platform/adapters-object-storage |
| operations | email-service | Email send interface, template contracts, and delivery provider abstraction | @platform/email-runtime |
| operations | email-brevo | Brevo transactional email delivery implementation | @platform/adapters-brevo |
| operations | notification-service | Push, in-app, and browser notification channel interface and delivery contracts | @platform/notification-runtime |
| operations | search-service | Full-text search query interface, index management contracts, and search provider interface | @platform/search-runtime |
| delivery | dev-local | Docker Compose service definitions, seed scripts, and local environment bootstrap | @platform/dev-services |
| delivery | container-build | Dockerfiles, multi-stage build patterns, and image publishing scripts | @platform/tooling-docker |
| delivery | terraform-workflow | Terraform module patterns, provider version locks, and workspace management | @platform/tooling-terraform |
| delivery | ci-pipeline | CI/CD workflow definitions, build scripts, and security scanning | @platform/tooling-ci |
| delivery | aws-infra | AWS ECS/EKS workloads, RDS, ElastiCache, S3, IAM, and network topology | @platform/infra-aws |
| delivery | cloudflare-infra | Cloudflare CDN, R2 object storage, Pages deployment, DNS, and WAF configuration | @platform/infra-cloudflare |
| architecture | codegen | GraphQL Code Generator and architecture-safe generated artifact workflows | @platform/tooling-codegen |
| quality | test-support | Test-only MSW GraphQL handlers, React Testing Library helpers, Playwright fixtures, and generic role fixtures | @platform/test-support |

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

operations packages own server-side runtime concerns: API serving, workers, config, sessions, auth, queues, storage, email, notifications, and search
operations platform packages (security-auth, observability, queue-runtime, storage-runtime, audit-events, config-runtime, email-runtime, notification-runtime, search-runtime) define interfaces; adapters implement them
operations adapter packages (adapters-keycloak, adapters-redis, adapters-sentry, adapters-opentelemetry, adapters-object-storage) must not be imported by feature or domain packages
session-runtime and security-auth must not be imported by feature packages — only by runtime (api-runtime) and application packages

delivery packages are not runtime dependencies of any production package
delivery packages (dev-services, tooling-docker, tooling-terraform, tooling-ci, infra-aws) are consumed by the delivery pipeline, not by platform code
```
