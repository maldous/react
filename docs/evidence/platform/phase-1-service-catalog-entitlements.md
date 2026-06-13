# Phase 1 — service catalog + entitlement + policy substrate (delivery evidence)

- **Action:** ADR-ACT-0254 (delivery) — scope: ADR-ACT-0253; governing ADRs: ADR-0055, ADR-0057, ADR-0058 (ADR-0055/0058 **Accepted**).
- **Date:** 2026-06-13
- **Status of this document:** delivery evidence. It records what was built and proven, and what was deliberately not delivered. The Universal Service Foundation is **not** complete.

## Proof classification

This slice is **node:test-proven + MSW-proven + in-memory-runtime-proven**, not live-Postgres proven. The three new `proof:*` scripts run against in-memory repositories (no Docker required); the BFF routes + RLS migration are wired and type-checked but a live end-to-end proof against Postgres is a follow-up. Honest status in the registry is therefore `partial` for `entitlements` (not `delivered`/`locally proven`).

## Phase 1 delivered

**Service catalog + entitlements + policy-chain hook.** Specifically:

1. **Entitlement model** — `public.tenant_entitlements` (migration 022): tenant-scoped, RLS-enabled + forced, `(organisation_id, entitlement_key)` unique, `state` granted/revoked, `source`, `metadata`, audit columns. Absence of a `granted` row = unavailable (deny-by-default).
2. **Port + adapter** — `ports/entitlement-repository.ts` + `adapters/postgres-entitlement-repository.ts`: tenant self-read via `withTenant` (RLS), operator read/write via `withSystemAdmin` (rls_bypass).
3. **Entitlement usecase** — `usecases/entitlements.ts`: static entitlement catalog, list (tenant + operator), grant/revoke with **audit-before-change** (audit emit awaited before upsert; failure aborts the write), `isEntitled`, `assertEntitlement` (typed 403), the `evaluateEntitlement` chain (permission → entitlement → policy → quota), and an honest `quotaHook` (always `not_enforced`/`not_applicable`).
4. **Service catalog v2** — `usecases/service-catalog.ts` + `ports/provider-registry.ts`: a static catalog seed with environment classification, clickthrough visibility, provider bindings, and `requiresEntitlement`; `buildServiceCatalog` visibility/entitlement filtering; `forbiddenProvidersForEnvironment` (no mock-in-production invariant). No secrets in any entry.
5. **BFF routes** (+ OpenAPI): `GET /api/org/entitlements` (tenant read-only), `GET`/`PATCH /api/admin/tenants/:tenantId/entitlements` (operator, audited), `GET /api/platform/service-catalog` (operator).
6. **Policy-chain integration point** — the ADR-0058 chain `session → tenant → route-scope → permission → entitlement → policy → quota`, deny-by-default; `evaluateEntitlement` + `assertEntitlement` are the reusable handler-level guards (repo idiom). Quota is a **hook only**.
7. **Permissions** — `tenant.entitlements.read` (tenant-admin) and `platform.entitlements.read`/`write` (system-operator) added to `domain-identity` role bundles; no tenant self-grant.
8. **Admin UI** — `/admin/entitlements`: operator console (tenant-id field + grant/revoke) when the viewer holds `platform.entitlements.write`; tenant read-only view otherwise. REST-over-BFF, RHF-free toggle action, contextual audit invalidation, MSW + a11y test.
9. **Proofs** — `proof:entitlements`, `proof:entitlement-policy-chain`, `proof:service-catalog-registry` (all in-memory, no infra) + `entitlements`/`service-catalog` node:test suites + the frontend test.
10. **Maintenance** — resolved the esbuild OSV advisory (GHSA-gv7w-rqvm-qjhr) by reconciling `apps/react-enterprise-app` to its declared vite 8 (rolldown; esbuild removed). `audit:osv` + `audit:deps` green.

## Enforced invariants (proven)

- Deny by default; no entitlement → unavailable (`proof:entitlements`, `entitlements.test.ts`).
- Feature flag ≠ entitlement (unknown keys rejected; no audit emitted).
- Tenant-admin cannot grant entitlements (grant/revoke routes are operator-scoped `global`; usecase only called from them).
- System-admin grant/revoke is audited; audit-before-change aborts on audit failure.
- Removed entitlement blocks access on the next check.
- Entitlement state is tenant-scoped (RLS + in-memory tenant-scope test).
- React cannot infer entitlements locally (REST-over-BFF; server authoritative).
- Quota hook is an honest no-op (`not_enforced`/`not_applicable`).
- Service catalog hides `not_exposed`/`global_only`/un-entitled entries from tenants; mock providers are forbidden in production; no secret-bearing fields.

## Still NOT delivered (explicitly)

- **billing**, **invoices**, **payment provider** — Phase 9.
- **metering aggregation** — Phase 2.
- **real quota enforcement** — Phase 2 (only a hook exists now).
- **search**, **workflow engine**, **notification engine** — Phases 4–6.
- **API keys**, **developer portal** — Phase 3.
- **new composed services** — none added this pass.
- **live-Postgres end-to-end proof** of the entitlement routes — follow-up (proofs are in-memory).
- **cross-tenant operator console with a tenant picker** — the console uses a tenant-id field; a picker needs a tenant-list surface (later).

## Governance

- ADR-0053, ADR-0054, ADR-0055, ADR-0056, ADR-0058 **Accepted** (ADR-ACT-0253 hardening + ADR-ACT-0254 acceptance, on Matt's authority per the Quad directive).
- ADR-0057, ADR-0059, ADR-0062, ADR-0063 remain **Proposed** — too broad; require splitting before acceptance.
- Registry statuses updated: `entitlements` → `partial`; `service-catalog-provider-model` proof refs extended; `abac-pdp` chain proof added.

## Commands run (green)

`npm run usf:validate`, `npm run lint:md`, `npm run test:architecture`, `npm run tsc:check`, `npm run openapi:drift`, `npm run frontend:conventions`, `npm run semgrep:gate`, `npm run test:platform-api`, `npm run test:frontend:run`, `npm run proof:entitlements`, `npm run proof:entitlement-policy-chain`, `npm run proof:service-catalog-registry`, `npm run audit:osv`, `npm run audit:deps`, `make check`.
