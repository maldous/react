# Delegated Capability Permissions & Unrealised Permutations

Action: ADR-ACT-0234 (Source ADR-0021, ADR-0030)
Date: 2026-06-12
Status: documentation + registry honesty alignment (no new roles implemented)

## Scope delivered

Honesty alignment for the actor-identity permutations that are **defined but
not realised**, so the capability map and permission vocabulary stop implying
function that does not exist (ADR-ACT-0230 findings 8–9).

### 1. Delegated admin roles — deliberately deferred

The permutation review enumerated candidate delegated roles: domain-reader,
domain-manager, auth-reader, auth-manager, integration-manager,
observability-reader, support-operator. **None are implemented.** Tenant roles
remain exactly `tenant-admin | manager | member | viewer`
(`packages/domain-identity`), with system-admin as the only global role.

Why deferred rather than added now:

- Role bundles are an authorisation surface. Permissions are the enforcement
  primitive (ADR-0021); adding role bundles changes what every existing and
  future route grants — that requires an ADR, not a registry tweak.
- The permission vocabulary is already delegation-shaped: every capability has
  separate `*.read` / `*.write` permissions (e.g. `tenant.domains.read/write`),
  and ADR-ACT-0232 moved domain activation under `tenant.domains.write` so a
  future domain-manager role can be a pure bundle with no route changes.
- UMA resource policies (ADR-0030, `/api/auth/settings/resource-policies`)
  already allow per-tenant runtime tightening; a delegated-role ADR should
  decide bundle vs UMA-policy as the delegation mechanism.

Registered as capability `delegated_admin_roles` = `deferred`/`deferred`
(never reported ready). Denied-by-default is the failure mode: an actor without
a bundle holding a permission is denied by the pipeline's static check and by
UMA when configured.

### 2. Groups and sub-organisations — API without UI

Source-verified state (ADR-ACT-0230 finding 8):

| Aspect | Groups | Sub-organisations |
| --- | --- | --- |
| Permissions defined | tenant.groups.read/create/update/delete | tenant.suborgs.read/create/update/delete |
| Routes implemented | GET/POST /api/org/groups, PATCH/DELETE /api/org/groups/:groupId | GET/POST /api/org/sub-organisations, PATCH/DELETE /api/org/sub-organisations/:subOrgId (+ global-quirk POST /api/admin/sub-tenants) |
| Route scope | tenant | tenant |
| Unit tests | tests/unit/groups.test.ts | tests/unit/sub-organisations.test.ts |
| Admin UI | **none** | **none** |
| Runtime proof | **none** | **none** |
| Capability registry (before) | **absent** | **absent** |

Decision: keep the APIs (functional, tested, permission-gated) and register
both capabilities honestly as `partial` (API-only, `adminRoute: null`) rather
than removing the permissions — tenant-admin legitimately holds them and the
routes enforce them. A UI slice is future work and must flip these rows only
when delivered with evidence.

### 3. Actor permutation status summary

| Actor permutation | Status |
| --- | --- |
| unauthenticated / viewer / member / manager / tenant-admin | implemented (pipeline + bundles + tests) |
| system-admin apex; tenant-FQDN-blocked; audited support mode (target/wrong tenant) | implemented + tested (support-mode.test.ts) |
| fixture actor | implemented (E2E-only; skips FQDN/scope checks by design) |
| expired/missing session; cross-tenant session | implemented (401 / canAccessTenantFqdn 403) |
| disabled / invited member | implemented (membership status lifecycle, ADR-ACT-0206) |
| delegated roles (all variants) | **deferred** (this document) |
| brokered/cross-tenant identity | partial — sysadmin brokering settings exist; real brokered login blocked (ADR-ACT-0220) |

## Tests run

`npm run test:platform-api` (capability registry tests pass with the three new
rows), `npm run test:frontend:run`, `make check`.

## No-fake-readiness guarantee

`tenant_groups` / `tenant_suborgs` are `partial` with `adminRoute: null` — the
readiness map shows them without claiming a UI. `delegated_admin_roles` is
`deferred`/`deferred` and can never surface as ready.

## ACTION-REGISTER linkage

ADR-ACT-0234. Source review:
`docs/evidence/platform/domain-identity-capability-permutation-review.md`.
