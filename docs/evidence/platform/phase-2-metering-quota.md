# Phase 2 — metering + quota enforcement (delivery evidence)

- **Action:** ADR-ACT-0256 — governing ADRs: ADR-0067 (metering + quota, **Accepted**), ADR-0061 (analytics/metering boundary, **Accepted**); ADR-0057 re-scoped to billing (Phase 9, Proposed).
- **Date:** 2026-06-13
- **Status of this document:** delivery evidence. The Universal Service Foundation is **not** complete. Phase 2 is metering + quota enforcement only; billing/payment is **not** delivered.

## Proof classification

**Live-proven** against the local Compose Postgres (real RLS) — the new proofs run as the non-superuser `platform_app` role, create + clean up their own v4 test orgs, and SKIP honestly (exit 0) if Postgres is unavailable:

- `proof:metering` — idempotent recording (tenant+meter+idempotency key); unknown meter rejected; negative quantity rejected unless an explicit adjustment; entitlement gate on recording; **RLS tenant isolation** (unfiltered count under a foreign tenant context = 0); windowed aggregation; no secret columns.
- `proof:quota-enforcement` — grant entitlement → set quota → usage below limit allowed → usage at/over limit denied (decidedBy `quota`) → revoke entitlement → denied (decidedBy `entitlement`, **before** quota); `assertQuota` throws a typed error; no-quota ⇒ allowed.
- `proof:metering-quota-routes` — invokes the **real route handlers**: operator ingestion records + dedups; invalid tenant id rejected; org reads need a tenant context; operator usage/quota reads; operator sets a quota; **no secret fields** in usage/quota responses; access-control metadata asserted.

In-memory `node:test` suites (`metering`, `quota`) cover the usecase logic without infra.

## Delivered

1. **Metering model** — `meter_events` (migration 024): tenant-scoped, **RLS enabled + forced** (canonical inherit-aware bypass predicate, not the naive one), idempotent by `(organisation_id, meter_key, idempotency_key)`, append-safe, `quantity`/`subject_id`/`occurred_at`/`recorded_at`/`source`/`metadata`. `MeteringRepository` port + `PostgresMeteringRepository` (idempotent `ON CONFLICT DO NOTHING`; windowed aggregation daily/monthly/rolling_30d/lifetime; tenant self-read via `withTenant`, operator via `withSystemAdmin`).
2. **Metering usecase** — `recordMeterEvent` (validates meter key + quantity; **requires the meter's entitlement**; negative rejected unless `metadata.adjustment`); `getUsage`. Meter → entitlement mapping in `METER_CATALOG`.
3. **Quota model** — `tenant_quotas` (migration 024, RLS): quota_key + entitlement_key + meter_key + limit + window + action. `QuotaRepository` + `PostgresQuotaRepository`.
4. **Quota enforcement** — `quota` usecase replaces the Phase-1 no-op hook: `evaluateQuota` (chain after permission: **entitlement → quota**, deny-by-default; no-quota ⇒ allowed), `assertQuota` (typed error on denial), `listQuotas` (live usage + state), `setQuota` (operator-only, **audit-before-change**, `quota.set`/`quota.removed`).
5. **Routes** (+ OpenAPI): `POST /api/admin/tenants/:tenantId/meter-events` (operator/internal ingestion), `GET /api/org/usage`, `GET /api/admin/tenants/:tenantId/usage`, `GET /api/org/quotas`, `GET /api/admin/tenants/:tenantId/quotas`, `PATCH /api/admin/tenants/:tenantId/quotas`.
6. **Permissions** — `tenant.metering.read` (tenant), `platform.metering.read|write` + `platform.quotas.read|write` (operator) in `domain-identity`.
7. **UI** — `/admin/usage`: operator quota console (tenant lookup Select + set-quota form + quotas/usage tables) when `platform.quotas.write`; tenant read-only usage + quota view otherwise. REST-over-BFF; React renders BFF state only.
8. **Contracts** — metering/quota schemas in `@platform/contracts-admin`; `quota` audit resource + `quota.set`/`quota.removed` actions.

## Enforced invariants (proven)

Tenant-scoped + RLS-isolated meter events and quotas; idempotent recording; invalid meter key rejected; negative usage rejected unless adjustment; recording requires entitlement; quota check runs after permission + entitlement; entitlement denial precedes quota; quota denial is a typed error + auditable; quota changes audited (audit-before-change); React makes no quota decision (server-authoritative); no secret fields in usage/quota responses; no paid provider in local proof.

## Still NOT delivered (explicitly)

- **Billing, invoices, payment capture** — Phase 9 (ADR-0057, Proposed).
- **ClickHouse / OpenMeter metering provider** — Phase 2.5, behind the `MeteringRepository` port (the existing `adapters-clickhouse` is analytics-only and lacks synchronous uniqueness for idempotency).
- **Product analytics** — separate future capability (ADR-0061 boundary).
- Search, workflow, notifications, API keys, developer portal — later phases.
- Quota denial uses HTTP 403; 429 semantics is a later refinement.

## Governance

- ADR-0057 **split**: entitlements → ADR-0058 (Accepted); metering+quota → **ADR-0067** (Accepted); billing → ADR-0057 re-scoped (Phase 9, Proposed). ADR-0061 **Accepted** (metering/analytics boundary). CODEMAPS updated (67 ADRs; next 0068).
- Registry: `metering-usage-meters` + `quota-enforcement` → **locally proven**; the Phase-1 "no quota before Phase 2" validator guard was retired and replaced by a "billing not delivered (Phase 9)" guard.

## Commands run (green)

`npm run usf:validate`, `lint:md`, `test:architecture`, `tsc:check`, `openapi:drift`, `frontend:conventions`, `semgrep:gate`, `test:platform-api`, `test:frontend:run`, `proof:entitlements`, `proof:entitlement-policy-chain`, `proof:service-catalog-registry`, `proof:entitlements-postgres`, `proof:entitlements-routes`, `proof:metering` (live), `proof:quota-enforcement` (live), `proof:metering-quota-routes` (live), `audit:osv`, `audit:deps`, `make check`.
