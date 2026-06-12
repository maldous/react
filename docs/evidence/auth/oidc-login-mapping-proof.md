# OIDC Mapping Proof / Login-Simulation Closure — Evidence (ADR-0046 / ADR-ACT-0220)

Date: 2026-06-12. Owner: Architecture owner / technical lead.
AI assistance: Claude Opus 4.8 (analysis + this note), human-reviewed.

## Purpose

Honestly assess whether the remaining OIDC enterprise gap from ADR-0046 / ADR-ACT-0215
can be closed in this pass:

- `oidc_claim_mapping` — **partial** (configured, not login-exercised)
- `oidc_group_role_mapping` — **partial** (configured, not login-exercised)
- `oidc_login_simulation` — **deferred** (no honest repeatable proof)

**Outcome: the gap is documented and BLOCKED on an external dependency (real IdP
configuration), NOT closed.** No status is upgraded; `oidc_login_simulation` stays
`deferred` and the two mapping capabilities stay `partial`. ADR-ACT-0220 is recorded as
**Blocked** (not Done) — mock-oidc cannot prove tenant-OIDC mapping; readiness is never faked.

## What IS proven today

- **Discovery / issuer / JWKS / callback / test-connection** (ADR-0046): implemented and
  proven — `node:test` (`oidc-discovery.test.ts`) + the runtime proof
  `npm run proof:auth-oidc-enterprise` (`apps/platform-api/scripts/oidc-enterprise-runtime-proof.ts`)
  against mock-oidc / local Keycloak. Evidence: `docs/evidence/auth/oidc-enterprise-hardening.md`.
- **Claim + group/role mapping configuration** (ADR-0046): the
  `PATCH /api/auth/settings/idps/:alias/mapping` path applies oidc-user-attribute +
  oidc-role mappers through `RealmAdminPort`, with roles allowlisted to tenant roles.
  Unit-proven by `apps/platform-api/tests/unit/oidc-mapping.test.ts` (mapper payload shape,
  allowlist enforcement, redaction). This proves the mappers are *configured correctly on
  the IdP*, not that a real login *produces the mapped session*.
- **Brokered-login mechanism** (ADR-ACT-0157): the production-true brokered flow
  (`/login` → Keycloak → mock IdP → BFF `/auth/callback` → app session) is E2E-proven by
  `e2e/identity/broker-login.spec.ts` (verified user authenticates; denied / provider-error /
  unverified-email rejected with no session; sign-out clears the session). This proves the
  *foundational login → callback → mapped-session mechanism* works end to end — but for the
  platform's social broker IdPs (mock-google/azure/apple), **not** for a tenant-configured
  OIDC IdP set up through the ADR-0046 discovery + mapping flow, and it does **not assert the
  specific mapped claims/roles** in the resulting session.

## What is NOT proven (the honest gap)

A repeatable proof that a **tenant-configured OIDC IdP** (created via the ADR-0046 flow,
with claim + group/role mappers) drives a real brokered login whose resulting **platform
actor/session carries the expected mapped claims and tenant roles**. Until that exists:

- `oidc_claim_mapping` and `oidc_group_role_mapping` remain **partial** — configured and
  unit-verified, but not login-exercised.
- `oidc_login_simulation` remains **deferred / blocked** — there is no honest, repeatable
  browser/auth proof of the tenant-OIDC mapping outcome, and one cannot be built in the
  current environment (see below). Unit/MSW evidence must not be used to claim it.

## Why it is BLOCKED (not merely "not done yet")

The local stack brokers the **mock-oidc** fixture (mock-google/azure/apple) as Keycloak
IdPs for `broker-login.spec.ts`. Mock-oidc is a login-flow fixture: it proves the brokered
login *mechanism*, but it is **not** a real upstream OIDC provider issuing tenant-controlled
claims/groups through the ADR-0046 tenant-IdP discovery + mapping path. There is therefore
no way to honestly prove that a tenant-configured OIDC IdP's claim/group mappers produce the
expected mapped platform session **until real IdPs are configured** for the environment.

This is an **external prerequisite**, not a harness we can write around: pointing the
ADR-0046 tenant-IdP flow at mock-oidc would not exercise real claim/group mapping, so any
"proof" built on it would be misleading. Per the no-fake-readiness rule we leave it blocked.

## Exact next step to close it (once real IdPs exist)

Prerequisite (external): configure ≥1 **real** OIDC IdP (e.g. a real Entra/Okta/Google
tenant, or a self-hosted real OIDC provider that is not the mock fixture) reachable by the
environment, with test identities carrying known claims/groups.

Then add `npm run proof:auth-oidc-login-simulation` (or `e2e/identity/oidc-tenant-mapping.spec.ts`):
register the IdP via the ADR-0046 discovery flow, apply claim + group/role mappers via
`PATCH .../idps/:alias/mapping`, drive a real brokered login, assert the resulting BFF
session/actor carries the mapped claims + tenant role, then tear down. Only when that proof
is repeatable:

- upgrade `oidc_claim_mapping` → implemented (login-proven),
- upgrade `oidc_group_role_mapping` → implemented (login-proven),
- upgrade `oidc_login_simulation` → implemented,

and mark a new ACTION-REGISTER row Done with this evidence file showing the executed proof.
Not before.

## Capability map

Unchanged — already honest: `oidc_claim_mapping` / `oidc_group_role_mapping` = `partial`
(readiness `deferred`); `oidc_login_simulation` = `deferred` (readiness `deferred`). Pinned by
the never-fake-readiness guard in `apps/platform-api/tests/unit/capability-registry.test.ts`.
The deferral reason is the real-IdP blocker above, not incomplete implementation.

## ACTION-REGISTER linkage

ADR-ACT-0220 (Source ADR-0046), status **Blocked** — blocked on an external dependency
(real IdP configuration); mock-oidc cannot substitute. Mapping login-exercise + login
simulation remain open with the prerequisite above. Evidence: this file.
