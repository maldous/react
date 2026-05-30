# Full-stack package scope assessment

**Assessment date:** 2026-05-27
**Assessed by:** architecture-governance

## Purpose

Evaluate the full set of packages required for a complete, generic, enterprise-grade full-stack platform. Determine which to add now, defer, or omit. No product-specific names or assumptions.

## Evaluation criteria (5-test)

A package is added only when it passes at least 4 of 5 tests:

1. **Stable ownership** ? a single team or role owns it unambiguously
2. **Different dependency rules** ? it has forbidden consumers or dependencies distinct from neighboring packages
3. **Different runtime/deployment concerns** ? it runs in a different process, environment, or has a separate lifecycle
4. **Different validation/evidence needs** ? it requires its own compliance or governance checks
5. **Likely reuse** ? multiple other packages or teams will depend on it

## Summary

```text
Total candidates evaluated: 28
Added now:                  25
Deferred:                    0
Omitted:                     3
```

Two new domains added: `operations`, `delivery`.
Two new teams added: `team-platform`, `team-security`.

Round 2 added 5 previously-deferred packages after the boundary rationale was validated.

---

## Packages added

### Operations domain ? server-side runtime

| Package | Owner | Class | Rationale |
| --- | --- | --- | --- |
| @platform/api-runtime | team-platform | active.platform | HTTP server lifecycle with distinct auth/middleware concerns; separate from GraphQL server and domain logic |
| @platform/graphql-api-runtime | team-platform | active.platform | GraphQL schema stitching, DataLoader, persisted-query enforcement ? distinct from generic HTTP runtime |
| @platform/worker-runtime | team-platform | active.platform | Separate process, different lifecycle (drain on shutdown), different queue-broker dependencies |
| @platform/config-runtime | team-platform | active.platform | Leaf node with no @platform deps; consumed by every adapter and runtime; typed-schema-at-startup pattern |
| @platform/session-runtime | team-security | active.platform | Crosses auth, Redis, and request context ? distinct from auth interface and Redis adapter |

### Operations domain ? cross-cutting platform abstractions

| Package | Owner | Class | Rationale |
| --- | --- | --- | --- |
| @platform/security-auth | team-security | active.platform | Pure interface with no @platform deps; enables provider swap without touching platform code |
| @platform/audit-events | team-security | active.platform | Distinct compliance ownership, durable delivery requirements, schema versioning governance |
| @platform/observability | team-platform | active.platform | No @platform deps; consumed by every runtime and adapter; vendor decoupling is a platform-wide concern |
| @platform/queue-runtime | team-platform | active.platform | Stable contract point between producers (features) and consumers (worker-runtime, adapters-redis) |
| @platform/storage-runtime | team-platform | active.platform | No @platform deps; presigned URL flow is a distinct abstraction pattern from other runtime concerns |

### Operations domain ? concrete adapters

| Package | Owner | Class | Rationale |
| --- | --- | --- | --- |
| @platform/adapters-keycloak | team-security | active.adapter | Concrete auth provider; limits Keycloak SDK exposure to one package; enables provider swap |
| @platform/adapters-redis | team-adapter | active.adapter | Serves both cache (sessions) and queue (BullMQ); both consumers are platform packages |
| @platform/adapters-sentry | team-platform | active.adapter | Implements observability error interface; vendor separation enables monitoring provider change |
| @platform/adapters-opentelemetry | team-platform | active.adapter | Must initialize before all other imports (auto-instrumentation startup concern) |
| @platform/adapters-object-storage | team-adapter | active.adapter | AWS S3 SDK encapsulation; presigned URL, multipart upload distinct from storage-runtime abstraction |

### Delivery domain ? CI/CD and infrastructure

| Package | Owner | Class | Rationale |
| --- | --- | --- | --- |
| @platform/dev-services | team-platform | active.tooling | Local-only scope; Docker Compose + seeds; must never be a production dependency |
| @platform/tooling-docker | team-platform | active.tooling | Container image definitions; distinct from CI workflow and infrastructure |
| @platform/tooling-terraform | team-platform | active.tooling | Terraform module patterns and provider locks; shared across environments |
| @platform/tooling-ci | team-platform | active.tooling | Top-level delivery orchestrator; invokes Docker builds, Terraform applies, governance checks |
| @platform/infra-aws | team-platform | active.tooling | AWS resource definitions on a different change cadence from application code |

---

## Packages added (round 2)

These packages were initially deferred and subsequently added after boundary rationale was validated.

| Package | Owner | Class | Rationale |
| --- | --- | --- | --- |
| @platform/email-runtime | team-platform | active.platform | Email send interface is a stable abstraction consumed by multiple feature packages; provider swap (e.g. Brevo ? SES) requires only a new adapter. |
| @platform/adapters-brevo | team-platform | active.adapter | Brevo free-tier transactional email (300/day free); concrete implementation of email-runtime registered at application startup only. |
| @platform/notification-runtime | team-platform | active.platform | Push and in-app notification delivery is a distinct cross-cutting concern with a channel registry pattern separating interface from provider SDKs. |
| @platform/search-runtime | team-platform | active.platform | Search has distinct eventual-consistency semantics, index management lifecycle, and provider-swap requirements that justify a dedicated interface. |
| @platform/infra-cloudflare | team-platform | active.tooling | Cloudflare free tier (CDN, R2 storage) complements infra-aws and eliminates AWS data egress costs for static assets. |

---

## Packages deferred

None. All previously-deferred packages were resolved in round 2 or moved to omitted.

---

## Packages omitted

These candidates were assessed and explicitly rejected.

| Candidate | Reason |
| --- | --- |
| feature-flags (standalone) | Feature flag reads belong in config-runtime. Insufficient boundary separation. |
| data-migrations (standalone) | Migrations are tightly coupled to adapters-postgres schema ownership. Should be a sub-module, not a package. |
| @platform/adapters-stripe | Payment processing is product-domain specific; omitted in favour of free-tier services only. |

---

## Architecture notes

**Interface/adapter split:** Each cross-cutting concern (auth, observability, queue, storage, audit) is split into an interface package (no @platform deps) and one or more adapter packages. This means:

- Platform code imports the interface ? never the adapter
- Adapter packages are registered at application startup only
- Swapping vendors requires only a new adapter package

**Operations adapter boundary:** Operations adapters (adapters-keycloak, adapters-redis, adapters-sentry, adapters-opentelemetry, adapters-object-storage) are forbidden from feature and domain packages. This is enforced by `validate-source-imports` rules.

**Delivery isolation:** All delivery packages carry `production: false` in runtime metadata and have empty `allowedConsumers` lists. They are consumed only by the CI/CD pipeline.
