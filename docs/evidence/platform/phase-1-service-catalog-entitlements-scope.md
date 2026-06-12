# Phase 1 — service catalog + entitlement + policy substrate (implementation scope)

- **Action:** ADR-ACT-0253 (scope) → implementation under ADR-ACT-0239 (catalog) + ADR-ACT-0241/0242 (entitlements/policy)
- **Governing ADRs:** ADR-0055 (service catalog/provider model) and ADR-0058 (PDP/entitlements/delegated admin) — both hardened to decision quality and marked **implementation-ready** (formal acceptance pending human review).
- **Date:** 2026-06-13
- **Status of this document:** implementation scope. It defines the next delivery slice; this pass does **not** implement it (it makes it safe to start).

## Why this slice

Phase 1 is the dependency spine of the Universal Service Foundation. Per the [delivery graph](./universal-service-foundation-delivery-dependencies.md), nothing in billing, metering, quotas, search, workflow, notifications, the developer portal, governance, or lifecycle can be honestly delivered before the **service catalog** (which all provider-backed capabilities depend on) and the **entitlement engine** (which all paid/restricted features gate on) exist. This is the only dependency-clear first slice.

## In scope (what Phase 1 delivers)

1. **Service catalog registry v2** — generalise `platform-services.ts` into a catalog: per-entry environment classification (ADR-0056), clickthrough policy reference (ADR-ACT-0233), isolation invariant, optional port binding. No new services composed.
2. **Provider registry model** — `provider-registry` port: capability → port → {providers with classification + probe + selection key}, seeded with already-composed services as their own local providers.
3. **Entitlement model** — tenant-scoped entitlement set (capability grants), data-only, server-authoritative.
4. **Tenant entitlement assignment** — system-operator assigns/removes entitlements for a tenant, audited.
5. **Entitlement evaluation in the BFF** — the entitlement step of the ADR-0058 chain, deny-by-default, declared via route metadata, checked centrally.
6. **Policy-chain integration point** — confirm the `session → tenant → route-scope → permission → entitlement → policy → quota` chain wiring around the existing UMA PDP (`PolicyDecisionPort` seam).
7. **Quota hook placeholder only** — a no-op pass-through point at the end of the chain; **no enforcement**.
8. **Admin UI for entitlement visibility and assignment** — system-admin can view + assign/remove tenant entitlements (audited).
9. **Tenant / self-service read-only entitlement view** — tenant-admin reads assigned entitlements if permitted (`tenant.entitlements.read`).
10. **Runtime proofs** — `proof:entitlements`, `proof:service-catalog-registry`, `proof:entitlement-policy-chain`.

## Explicitly out of scope (do NOT deliver in Phase 1)

Billing · invoices · payment provider · metering aggregation · **real quota enforcement** (hook only) · search · workflow · notifications · API keys · developer portal · **any new composed service**. These belong to Phases 2–9 and must not be started here.

## Entitlement model

- **Shape:** an entitlement is a tenant-scoped grant of a capability key (e.g. `search`, `webhooks`, `storage`), optionally with bounds (limits are *recorded* but not *enforced* in Phase 1 — that is the quota hook). State: `granted` / `revoked` (absence = not entitled).
- **Authority:** system-operator only. Tenant-admins cannot grant/modify entitlements for any tenant, including their own.
- **Storage:** Postgres, tenant-scoped, RLS-isolated; mutations audited (audit-before-change).
- **Resolution:** server-side only; React never infers entitlements. The BFF resolves the tenant's entitlement set and answers entitlement checks.
- **Relationship to flags:** independent. A feature flag never satisfies an entitlement check.
- **Relationship to permissions:** orthogonal; both must pass (ADR-0058).
- **Relationship to quota:** an entitlement may carry a limit; **enforcing** remaining quota is Phase 2. Phase 1 records the limit and exposes a no-op hook.

## Policy chain (integration point)

```text
session → tenant context → route scope → permission → entitlement → policy → quota(hook)
```

Phase 1 adds the **entitlement** step (after permission, before policy) and the **quota hook** (no-op). Deny-by-default and fail-closed per ADR-0058. Entitlement keys are declared as route metadata; the pipeline checks them centrally — never ad-hoc route-local logic.

## Routes (BFF contracts)

| Method | Route | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/org/entitlements` | tenant `tenant.entitlements.read` | Tenant-admin reads its own assigned entitlements (read-only). |
| `GET` | `/api/admin/tenants/:tenantId/entitlements` | operator `platform.tenants.read` | System-admin views a tenant's entitlements. |
| `PATCH` | `/api/admin/tenants/:tenantId/entitlements` | operator `platform.tenants.write` | System-admin assigns/removes entitlements (audited). |
| `GET` | `/api/platform/service-catalog` | operator `tenant.platform.read` (filtered) | Catalog v2 read; tenant-facing payload contains only `tenant_scoped_safe` entries, no secrets/internal URLs. |

All routes added to `docs/api/openapi.json` (keep `openapi:drift` green), typed error envelopes, strict redacted DTOs.

## UI

- **`apps/react-enterprise-app/src/features/admin-entitlements`** — system-admin entitlement visibility + assignment (TanStack Router/Query, RHF+Zod, design-system, a11y, permission-gated, contextual audit refresh after mutation, MSW coverage). New route `/admin/entitlements` registered in `AdminLayout` + route tree.
- **Tenant self-service read-only view** — surfaces assigned entitlements where `tenant.entitlements.read` is held; no mutation controls.

## Proofs (to be created in the implementation pass)

- `proof:entitlements` — assign → resolve → remove; RLS isolation; audit written; removal blocks access on next request.
- `proof:service-catalog-registry` — every catalog entry has classification + probe + clickthrough + isolation; nothing `up` without a probe.
- `proof:entitlement-policy-chain` — chain evaluates in order, deny-by-default; no-entitlement → unavailable; permission and entitlement both required; quota hook is a verifiable no-op.

(`proof:provider-environment-classification`, `proof:provider-readiness-honesty`, `proof:delegated-admin-policy`, `proof:policy-deny-by-default` are named in the ADRs; the first two may land with catalog v2, the delegated/quota ones with Phases 6/2.)

## Required invariants (enforced)

- Deny by default; **no entitlement means unavailable**.
- Feature flag ≠ entitlement.
- Tenant-admin **cannot** grant entitlements to their own (or any) tenant.
- System-admin **can** assign entitlements, always audited.
- Tenant-admin **can** read assigned entitlements if permitted.
- React **cannot** infer entitlements locally; the BFF owns all entitlement checks.
- All entitlement changes audited (audit-before-change; fail closed if audit write fails).
- Removed entitlement blocks capability access on the next request.
- Entitlement state is tenant-scoped (RLS).
- No paid provider required for local proof.
- Quota hook exists but **does not** pretend full quota enforcement is delivered.

## Proposed implementation shape (adjust names to repo conventions)

```text
packages/contracts-entitlements
packages/domain-entitlements
apps/platform-api/src/usecases/entitlements.ts
apps/platform-api/src/usecases/service-catalog.ts
apps/platform-api/src/ports/entitlement-repository.ts
apps/platform-api/src/ports/provider-registry.ts
apps/platform-api/src/adapters/postgres-entitlement-repository.ts
apps/platform-api/src/db/migrations/<next>-entitlements.sql
apps/react-enterprise-app/src/features/admin-entitlements
```

Reuse: the secret-redaction/strict-DTO pattern, the existing audit + readiness models, the UMA `authorisation-runtime` PEP, and the `platform-services.ts`/`service-clickthrough.ts` registries (extend, don't rewrite).

## Acceptance criteria (slice is done when)

Implementation matches ADR-0055 + ADR-0058; ACTION-REGISTER updated; the three proofs pass; the four routes exist + are in `openapi.json` (drift green); `/admin/entitlements` + tenant read view ship with MSW + a11y; every invariant above holds; `make check` green; **nothing out-of-scope delivered**; the USF is **not** described as complete.

## Stop condition

Entitlement assign/resolve/remove proven end-to-end with the policy chain and catalog v2 in place. No billing, metering, quota enforcement, search, workflow, notifications, API keys, or new composed services.
