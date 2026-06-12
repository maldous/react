# Environment service classification

> Governing decision: **ADR-0056** (Proposed). Applied per capability in [`universal-service-foundation-registry.json`](../evidence/platform/universal-service-foundation-registry.json) (`environmentModel` / `sharedPerEnv`).

## Purpose

Classify every service so that tenant runtime data never leaks across environments or tenants, mocks never run in production, and shared services are only shared when they can prove isolation.

## Classification vocabulary

- **per-environment** — one instance per environment (dev/test/staging/prod); holds environment-specific tenant runtime data.
- **shared-cross-environment** — one instance across environments; permitted only with the full shared-service checklist below.
- **local-only** — runs only on developer machines.
- **test-only** — runs only in automated test environments.
- **mock-only** — a deterministic mock; never production.
- **production-external** — a real external provider used in production (paid or third-party).
- **production-internal** — a production-only internal service.
- **forbidden-in-production** — must never run in production.

## The shared-service checklist (ADR-0056)

A service may be `shared-cross-environment` only if it provides **all** of:

1. environment tagging
2. tenant tagging where tenant data exists
3. access controls
4. retention controls
5. backup model
6. restore model
7. deletion model
8. audit model
9. readiness proof
10. a written data-leakage analysis

If any item is missing, the service must be per-environment.

## Current and proposed classification

| Service                                 | Classification                           | Rationale                                                                                                                           |
| --------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Postgres                                | per-environment                          | Tenant state + migrations are environment-specific (schema-per-tenant + RLS).                                                       |
| Redis                                   | per-environment                          | Sessions, queues, counters are environment-specific.                                                                                |
| MinIO (object storage)                  | per-environment                          | Object data is environment-specific.                                                                                                |
| ClickHouse (product analytics/metering) | per-environment                          | Tenant analytical data is environment-specific; distinct from Sentry's ClickHouse.                                                  |
| Keycloak                                | per-environment                          | Realm/identity configuration is environment-specific.                                                                               |
| platform-api, React/Caddy               | per-environment                          | Application runtime is environment-specific.                                                                                        |
| Loki / Grafana / Alloy                  | per-environment                          | Tenant logs are environment-specific.                                                                                               |
| SonarQube (`react-sonar`)               | shared-cross-environment                 | Engineering quality, not tenant runtime data; satisfies the checklist.                                                              |
| Sentry (`react-sentry`, errors-only)    | shared-cross-environment                 | Errors only, env/tenant tagged; its internal ClickHouse/Kafka are Sentry-only and must not be reused as the platform warehouse/bus. |
| WireMock                                | mock-only / forbidden-in-production      | HTTP API stub; not routed through forward-auth; never linked in UI.                                                                 |
| LocalStack                              | mock-only / forbidden-in-production      | AWS mock; its `secretsmanager` is not the secrets capability.                                                                       |
| mock-oidc                               | mock-only / forbidden-in-production      | OIDC fixture; cannot substitute for a real IdP (real-IdP login proof is blocked).                                                   |
| Search engine (proposed)                | per-environment                          | Index-per-tenant; tenant runtime data.                                                                                              |
| Workflow engine (proposed)              | per-environment                          | Tenant-scoped workflow namespaces.                                                                                                  |
| Metering store (proposed)               | per-environment                          | Reuses per-env ClickHouse; tenant-tagged.                                                                                           |
| Metrics/trace backend (proposed)        | per-environment                          | Behind the per-env OTEL collector.                                                                                                  |
| Data catalog (proposed)                 | shared-cross-environment (metadata only) | Catalog holds metadata only; must satisfy the checklist; DSR acts per-tenant.                                                       |
| Alerting/incident (proposed)            | shared-cross-environment                 | Engineering ops with env labels; must satisfy the checklist.                                                                        |
| Support desk (proposed)                 | shared-cross-environment                 | Tickets tagged + access-scoped per tenant; must satisfy the checklist.                                                              |
| Secrets manager (proposed, Vault OSS)   | per-environment                          | Path-scoped per tenant; environment-specific.                                                                                       |
| Payment gateway (proposed)              | production-external                      | Real provider; the only sanctioned paid dependency.                                                                                 |

## Rules

- Tenant runtime data defaults to **per-environment**.
- A new service cannot be added to the service catalog (ADR-0055) without its classification, readiness model, and isolation/leakage notes.
- Shared services that hold tenant data must carry tenant tagging; the matrix validator (`npm run usf:validate`) fails any shared service lacking isolation notes.
