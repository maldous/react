# ADR-0024: Define slice readiness and dependency gate model

## Status

Accepted

## Date

2026-05-28

## Decision owner

Architecture owner / technical lead.

## Consulted

- Product owner
- Engineering team
- Delivery lead
- Operations reviewer
- Security reviewer

## Context

ADR-ACT-0008 defines the first vertical slice: an authenticated organisation profile route proving
the full stack from React protected route through BFF/API to Postgres.

Before that slice can begin, the local development environment must be in a known-working state.
Before the slice can reach production, progressively more durable infrastructure must be provisioned
and verified.

Without a defined readiness model, slice authors must guess which capabilities are needed before they
start. Infrastructure owners must guess which provisioning work is a hard prerequisite versus a
deferred item. Reviewers cannot consistently judge whether a slice gate has been met.

The architecture needs a shared vocabulary — a tiered readiness model — that slice authors, infra
owners, and reviewers can all use as a coordination language.

The model must also make explicit what Terraform/OpenTofu is required before each tier, versus what
application code owns (migrations, seeds, runtime config).

## Stakeholder concerns

- Engineering:
  - Slices must not begin against an untested local stack.
  - The boundary between Terraform responsibilities and application responsibilities must be clear.
  - Fixture session modes must be explicit so slices do not accidentally depend on live identity.

- Operations:
  - Cloud substrate provisioning must be gated so cloud costs are incurred only when the tier is
    needed.

- Security:
  - Real identity provisioning (Keycloak) must be a named tier gate, not an implicit assumption.

- Product:
  - Readiness gates must be passed by evidence, not by assertion.

## Decision drivers

- Give slice authors a single, unambiguous dependency declaration.
- Allow infra provisioning to be deferred to the tier that actually needs it.
- Separate fixture/fake identity from real SSO login clearly.
- Support automated gate checking via Playwright and make targets.
- Align with ADR-0023 (declarative infrastructure provisioning model).

## Options considered

### Option A: No formal model — ad-hoc slice gating

Description: Each slice owner decides what is needed and gates themselves.

Pros: Flexible.

Cons: Produces inconsistent gates, missed dependencies, and environment failures mid-slice.

### Option B: Single binary gate — everything or nothing

Description: One pre-slice-gate target must pass before any slice begins.

Pros: Simple to reason about.

Cons: Forces all provisioning (including Keycloak and cloud infra) before local slice work. Blocks
early iteration on vertical slices.

### Option C: Five-tier progressive readiness model

Description: Define five numbered tiers from local substrate to production readiness. Each slice
declares its required tier. Gate checks are automated per tier.

Pros: Progressive. Defers expensive provisioning. Makes fixture vs. real identity explicit.
Aligns with ADR-0023 provisioning model. Supports automated CI and local gate checks.

Cons: More complex vocabulary to establish upfront.

## Decision

Use a five-tier progressive readiness model.

### Tier 0 — Local substrate

The local development environment is in a known working state.

Required capabilities:

- Docker Compose config validates (all profiles).
- Required local services start and pass healthchecks (Postgres, Redis, ClickHouse, MinIO, Mailpit,
  OpenTelemetry Collector).
- Postgres migration and fixture seed complete without error.
- Platform-api substrate tests pass (health, readiness, version, session fixture handlers).
- React app browser-only substrate tests pass (Vitest/MSW).
- Architecture boundary checks pass (orchestrator all --no-reports --strict).
- Import boundary rules pass.

Terraform/OpenTofu: not required.

### Tier 1 — Local vertical slice test substrate

The local environment supports full browser-to-API vertical slice testing using deterministic
fixture actors.

Required capabilities, in addition to Tier 0:

- Platform-api HTTP server starts locally and serves /healthz, /readyz, /version, /api/session.
- React SPA (Vite dev server) starts locally and proxies /api/\* to platform-api.
- Playwright E2E tests run against the local app and local API.
- Fixture session actors are deterministic (LOCAL_FIXTURE_SESSION env var on platform-api).
- Seeded database is present for any DB-backed routes.
- Pre-slice gate passes (make pre-slice-gate).

Terraform/OpenTofu: not required.

### Tier 2 — Real identity substrate

The local environment uses real Keycloak login rather than fixture session actors.

Required capabilities, in addition to Tier 1:

- Keycloak Terraform/OpenTofu provisioning baseline applied (infra/modules/keycloak/).
- Realm, SPA client (PKCE), BFF/API client, scopes, protocol mappers, and roles provisioned.
- Local and dev fixture users provisioned via Terraform where allowed.
- No manual Admin Console setup is required.
- Real OIDC login callback tested end-to-end.
- No fixture session shortcut active (LOCAL_FIXTURE_SESSION not set in production mode).

Terraform/OpenTofu: required for Keycloak realm/client provisioning.

### Tier 3 — Cloud deployment substrate

The slice is deployable to a non-production cloud environment.

Required capabilities, in addition to Tier 2:

- Cloud Terraform/OpenTofu modules applied for the target environment.
- Remote state backend configured.
- Environment-specific .tfvars applied.
- CI/CD OIDC deploy role provisioned.
- Managed database and cache provisioned.
- DNS, TLS, and ingress configured.
- Application health and readiness endpoints reachable from the cloud environment.

Terraform/OpenTofu: required for all cloud infrastructure.

Note: Terraform/OpenTofu must not create application tables. Application migrations own schema.
Seed scripts own fixture data. Terraform provisions durable infrastructure only.

### Tier 4 — Production readiness

The slice is eligible for production release.

Required capabilities, in addition to Tier 3:

- Secrets manager integration configured (no hardcoded secrets).
- Backup and restore evidence committed.
- Alerting and log retention configured and verified.
- Release promotion gate passed.
- Rollback runbook committed and reviewed.
- Production approval workflow approved.

Terraform/OpenTofu: required for all production infrastructure and secrets provisioning.

## Rules

- Every slice must declare its required readiness tier in docs/slices/<action-id>.json.
- A slice must not begin unless its required tier gate passes.
- ADR-ACT-0008 (first vertical slice) requires Tier 1.
- Real Keycloak login requires Tier 2. ADR-ACT-0008 may use fixture session actors until
  ADR-ACT-0110 (Keycloak provisioning) is Done.
- Cloud or staging deployment requires Tier 3.
- Production release requires Tier 4.
- Terraform/OpenTofu is required only for tiers that depend on durable provisioned infrastructure
  (Tier 2 for identity, Tier 3 for cloud, Tier 4 for production).
- Terraform/OpenTofu must not create application tables. Application migrations own schema.
  Seed scripts own fixture data.
- Slice manifests live at docs/slices/<action-id>.json (see ADR-ACT-0113).
- E2E tests are the primary automated gate for Tier 1 (see ADR-0025).

## Consequences

- ADR-ACT-0112: Create Playwright E2E substrate gate. Required before ADR-ACT-0008 Tier 1 can be
  declared met.
- ADR-ACT-0113: Create slice dependency declaration and readiness checker. Slice manifests declare
  requiredReadinessTier and blockedBy.
- ADR-ACT-0114: Create local app/API runtime start scripts for E2E.
- ADR-ACT-0115: Create E2E fixture session mode for deterministic actors.
- Future slices requiring Keycloak must be gated on Tier 2 and ADR-ACT-0110.
- Future slices requiring cloud must be gated on Tier 3 and the relevant cloud module ADRs.

## References

- ADR-0023: Declarative infrastructure provisioning model
- ADR-0025: Playwright end-to-end testing strategy
- ADR-ACT-0008: Authenticated organisation profile slice
- ADR-ACT-0110: Keycloak Terraform/OpenTofu provisioning baseline
- ADR-ACT-0111: Local platform substrate smoke gate
- docs/slices/ (slice manifests)
