# OIDC Mapping Proof / Login-Simulation Closure — Evidence (ADR-0046 / ADR-ACT-0220)

Date: 2026-06-12. Owner: Architecture owner / technical lead.
AI assistance: Claude Opus 4.8 (analysis + this note), human-reviewed.

## Purpose

Honestly assess whether the remaining OIDC enterprise gap from ADR-0046 / ADR-ACT-0215
can be closed in this pass:

- `oidc_claim_mapping` — **partial** (configured, not login-exercised)
- `oidc_group_role_mapping` — **partial** (configured, not login-exercised)
- `oidc_login_simulation` — **deferred** (no honest repeatable proof)

**Outcome of this pass: the gap is NARROWED and documented, NOT closed.** No status is
upgraded; `oidc_login_simulation` stays `deferred` and the two mapping capabilities stay
`partial`. ADR-ACT-0220 is recorded as **Deferred** (not Done) — readiness is never faked.

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
- `oidc_login_simulation` remains **deferred** — there is no honest, repeatable
  browser/auth proof of the tenant-OIDC mapping outcome. Unit/MSW evidence must not be used
  to claim login simulation.

## Why it is not closed in this pass

A faithful proof requires standing up, repeatably and with teardown:

1. a fixture tenant OIDC IdP registered through the ADR-0046 discovery flow, pointed at the
   `mock-oidc` fixture as the upstream;
2. claim mappers (e.g. `email`, a custom attribute) and group/role mappers (group → an
   allowlisted tenant role) applied via `PATCH .../idps/:alias/mapping`;
3. mock-oidc fixture users whose tokens carry those claims/groups;
4. a browser-driven brokered login through Keycloak (extending the
   `playwright.identity.config.ts` real-auth harness used by `broker-login.spec.ts`);
5. assertions that the resulting BFF session/actor carries the mapped claims and the mapped
   tenant role — then full IdP/user/mapper teardown.

This is a multi-component, fixture-heavy harness (Keycloak broker + mock-oidc fixture
identities + tenant-IdP mapper provisioning + browser assertions) whose correctness is
security-sensitive. Standing it up reliably is its own focused slice; doing it hastily would
risk a flaky or misleading "proof", which would violate the honesty rule. It is therefore
deferred with the prerequisites above rather than faked.

## Exact next step to close it

Add `npm run proof:auth-oidc-login-simulation` (or an `e2e/identity/oidc-tenant-mapping.spec.ts`
under the identity harness) implementing steps 1–5 above. Only when that proof is repeatable:

- upgrade `oidc_claim_mapping` → implemented (login-proven),
- upgrade `oidc_group_role_mapping` → implemented (login-proven),
- upgrade `oidc_login_simulation` → implemented,

and mark a new ACTION-REGISTER row Done with this evidence file updated to show the executed
proof output. Not before.

## Capability map

Unchanged — already honest: `oidc_claim_mapping` / `oidc_group_role_mapping` = `partial`
(readiness `deferred`); `oidc_login_simulation` = `deferred` (readiness `deferred`). Pinned by
the never-fake-readiness guard in `apps/platform-api/tests/unit/capability-registry.test.ts`.

## ACTION-REGISTER linkage

ADR-ACT-0220 (Source ADR-0046), status **Deferred** — mapping login-exercise + login
simulation remain open with the prerequisites above. Evidence: this file.
