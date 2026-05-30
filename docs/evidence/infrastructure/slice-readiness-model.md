# Slice Readiness Model Evidence

**Date:** 2026-05-28
**ADR references:** ADR-0024, ADR-ACT-0113

## Summary

The five-tier slice readiness model (ADR-0024) is established. ADR-ACT-0008 (first vertical
slice) requires Tier 1. Slice manifests live at `docs/slices/`.

## Readiness tiers

### Tier 0 ? Local substrate

**Status: PASSED** (ADR-ACT-0111 complete)

Evidence:

- Docker Compose config validates (all profiles): `npm run compose:config` passes
- Postgres, Redis, ClickHouse, MinIO, Mailpit, otel-collector start and pass healthchecks
- Database migration and fixture seed complete: `npm run db:migrate && npm run db:seed`
- Platform-api substrate tests pass: `npm run test:platform-api`
- React app browser-only Vitest tests pass: `npm run test:frontend:run`
- Architecture boundary checks pass: `node tools/architecture/orchestrator/src/index.mjs all --no-reports --strict`

### Tier 1 ? Local vertical slice test substrate

**Status: ESTABLISHED** (ADR-ACT-0112 complete)

Evidence:

- Platform-api HTTP server: `apps/platform-api/src/server/http.ts`
- Vite proxy config: `apps/react-enterprise-app/vite.config.ts` (proxies /api/\*, /healthz, /readyz, /version)
- Playwright E2E tests: `e2e/substrate/smoke.test.ts` (8 tests)
- make e2e-check target established
- Playwright webServer config starts both services automatically

### Tier 2 ? Real identity substrate

**Status: BLOCKED** on ADR-ACT-0110 (Keycloak Terraform/OpenTofu provisioning)

Terraform/OpenTofu required: Keycloak realm, clients, scopes, mappers, roles.
Not required for ADR-ACT-0008.

### Tier 3 ? Cloud deployment substrate

**Status: BLOCKED** on cloud Terraform/OpenTofu modules (not yet defined)

Terraform/OpenTofu required: all cloud infrastructure (database, cache, DNS, TLS, ingress).
Not required for ADR-ACT-0008.

### Tier 4 ? Production readiness

**Status: BLOCKED** on Tier 3 and production approval workflow.

## Terraform/OpenTofu boundary

Terraform/OpenTofu provisions durable infrastructure only:

- Tier 2: Keycloak realm, clients, protocol mappers, roles, fixture users
- Tier 3: Cloud networking, database, cache, storage, DNS, TLS, OIDC deploy role
- Tier 4: Secrets manager, backup configuration, alerting

Terraform/OpenTofu must NOT:

- Create application tables (owned by app migrations in `apps/platform-api/src/db/migrations/`)
- Seed application fixture data (owned by seed scripts in `apps/platform-api/src/db/seed.ts`)

## ADR-ACT-0008 slice declaration

Slice manifest: `docs/slices/ADR-ACT-0008.json`

- requiredReadinessTier: 1
- blockedBy: ADR-ACT-0112, ADR-ACT-0113
- allowedFixtureModes: fixture-session
- forbiddenDependencies: live-keycloak

ADR-ACT-0008 may begin. Tier 1 gate is established.
Real Keycloak login is NOT required for this slice.

## Commands

```bash
# Tier 0 check
npm run test:platform-api
npm run test:frontend:run

# Tier 1 check
make e2e-check

# Full pre-slice gate (Tier 0 + Tier 1 + Sonar)
make pre-slice-gate
```
