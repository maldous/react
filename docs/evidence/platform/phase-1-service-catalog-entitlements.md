# Phase 1 — service catalog + entitlement + policy substrate (delivery evidence)

- **Action:** ADR-ACT-0254 (delivery) + ADR-ACT-0255 (Phase 1.5 live-proof hardening) — scope: ADR-ACT-0253; governing ADRs: ADR-0055, ADR-0057, ADR-0058 (ADR-0055/0058 **Accepted**).
- **Date:** 2026-06-13
- **Status of this document:** delivery evidence. It records what was built and proven, and what was deliberately not delivered. The Universal Service Foundation is **not** complete.

## Proof classification

Phase 1 was node:test/MSW/in-memory proven. **Phase 1.5 (ADR-ACT-0255) upgraded the entitlement substrate to LIVE-proven** against the local Compose Postgres and the real BFF route handlers:

- `proof:entitlements-postgres` — live Postgres: migration 022 ran; `tenant_entitlements` exists with RLS **enabled + forced**; tenant self-read is RLS-isolated; cross-tenant read sees nothing (verified with an unfiltered count under a foreign tenant context — RLS, not just a `WHERE`); operator path reads/grants/revokes; absence and revoked both ⇒ not entitled; audit-before-change failure blocks the mutation (DB row unchanged); no secret columns.
- `proof:entitlements-routes` — invokes the **real route handlers**: org read requires a tenant context (400 without one); invalid tenant id and unknown key are rejected; operator grant/read/revoke work; service catalog returns the operator/global view with no secret fields; access-control metadata (tenant-scope, `platform.entitlements.read/write`) is asserted (pipeline-enforced).

Both SKIP honestly (exit 0) when Postgres is unavailable — they never fake-PASS. The registry status for `entitlements` is therefore upgraded to **`locally proven`**.

### Real finding fixed during hardening

`proof:entitlements-postgres` **caught a real RLS isolation flaw** in migration 022: its bypass predicate `pg_has_role(current_user,'rls_bypass','MEMBER')` is true for `platform_app` (a NOINHERIT *member* of `rls_bypass`), so RLS did **not** isolate `platform_app` under `withTenant()` — exactly the latent flaw migration 012 had already fixed for the other tenant tables. **Migration 023** replaces the policy with the canonical `current_user = 'rls_bypass' OR (member AND rolinherit)` predicate. After 023, the unfiltered cross-tenant count is 0 and all checks pass.

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

Phase 1.5 closed the two follow-ups from Phase 1: the entitlement substrate is now **live-Postgres + live-route proven**, and the operator console picks a tenant via a read-only lookup **Select** (`GET /api/admin/tenants`) instead of a raw UUID. Still deferred: a full tenant-management product (suspend/delete/export) and query-as-you-type lookup filtering beyond the capped list.

## Governance

- ADR-0053, ADR-0054, ADR-0055, ADR-0056, ADR-0058 **Accepted** (ADR-ACT-0253 hardening + ADR-ACT-0254 acceptance, on Matt's authority per the Quad directive).
- ADR-0057, ADR-0059, ADR-0062, ADR-0063 remain **Proposed** — too broad; require splitting before acceptance.
- Registry statuses: `entitlements` → **`locally proven`** (Phase 1.5 live proofs); `service-catalog-provider-model` proof refs extended; `abac-pdp` chain proof added.

## Commands run (green)

`npm run usf:validate`, `npm run lint:md`, `npm run test:architecture`, `npm run tsc:check`, `npm run openapi:drift`, `npm run frontend:conventions`, `npm run semgrep:gate`, `npm run test:platform-api`, `npm run test:frontend:run`, `npm run proof:entitlements`, `npm run proof:entitlement-policy-chain`, `npm run proof:service-catalog-registry`, `npm run proof:entitlements-postgres` (live), `npm run proof:entitlements-routes` (live), `npm run audit:osv`, `npm run audit:deps`, `make check`.
