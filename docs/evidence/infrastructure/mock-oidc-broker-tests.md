# Evidence: ADR-ACT-0157 — Brokered third-party IdP mock slice

**Date:** 2026-06-09
**Status:** In Progress
**Action:** ADR-ACT-0157
**ADR Ref:** ADR-0029, ADR-0030

## Scope

Deliver the brokered third-party identity-provider login (Google / Microsoft / Apple)
against a mock upstream OIDC provider, preserving the production architecture
(React → BFF → Keycloak broker → upstream IdP → callback → session). Replaces the
deferred "mock OIDC server fixture" requirement and un-skips the broker login coverage
(previously skipped in `e2e/external/auth-negative.spec.ts`).

## Delivered

- **mock-oidc fixture** (`services/mock-oidc/`, wrapping `node-oidc-provider`): three
  issuers (mock-google/azure/apple), discovery/authorize/token/jwks/userinfo, signed ID
  tokens, dynamic nonce echo, PKCE, redirect_uri validation, deterministic users, and a
  scenario picker (verified / unverified / denied / provider-error / disabled).
- **Runtime Keycloak broker seed** (`apps/platform-api/scripts/seed-idps.ts` →
  `KeycloakRealmAdminAdapter.upsertIdentityProvider`, `npm run seed:idps`): idempotent,
  no `terraform apply` required, admin-cli password grant.
- **BFF**: provider mode/guardrails + product→alias mapping
  (`apps/platform-api/src/server/auth-providers.ts`), `GET /api/auth/providers`,
  `/auth/login?provider=` → validated `kc_idp_hint` (`buildAuthorizationUrl`).
- **React** `/login` selector rendering the provider list, linking only to the BFF handoff.
- **Compose/Tilt**: `identity-mocks` profile + `mock-oidc` service + `seed-idps` resource.
- **Docs**: `docs/local-development/mock-identity.md` (incl. the WireMock-is-not-OIDC note).

## Verified live (2026-06-09, dev stack)

mock-oidc full auth-code flow (standalone):

- `verified`: signed RS256 `id_token`, `iss=http://localhost:9080/google`, **`nonce` echoed**,
  `email_verified=true`; matching `/userinfo`.
- `unverified`: `email_verified=false`. `denied` → `access_denied`. `provider-error` →
  `temporarily_unavailable`. `state` preserved on all error redirects.

Keycloak brokering (real Keycloak `platform` realm):

- `npm run seed:idps` created mock-google/azure/apple; re-run reported "updated" (idempotent);
  admin API lists all three with `validateSignature=true` and split front/back endpoints.
- `GET /kc/realms/platform/.../auth?...&kc_idp_hint=mock-google` (+PKCE) → 303 broker login →
  **landed on the mock-oidc picker** `http://localhost:9080/google/interaction/<uid>`.

BFF (dev, real-auth):

- `GET /api/auth/providers` → the four providers, `mode:"mock"`, **no secrets** in the payload.
- `GET /auth/login?provider=google` → 302 to Keycloak with `kc_idp_hint=mock-google`, PKCE preserved.
- `GET /auth/login?provider=evil` → **400** (no arbitrary `kc_idp_hint` injection / open redirect).

## Automated coverage

- `npm run test:mock-oidc` — mock-oidc flow tests (verified/unverified/denied/provider-error).
- `apps/platform-api/tests/unit/auth-providers.test.ts` — mode defaults, guardrails (mock-in-prod
  refusal, real-without-config refusal), mapping, provider list, secret-leak, `kc_idp_hint`.
- `apps/react-enterprise-app/src/routes/__tests__/login.test.tsx` — selector renders providers,
  BFF-only links, loading/empty/error states, no Keycloak/mock-oidc URL leak, axe.
- `npm run test:e2e:identity` (`e2e/identity/broker-login.spec.ts`) — full Playwright broker
  flow against the live stack (success per provider, unverified/denied/provider-error rejected,
  injection guard, secret-leak). Requires the local identity stack (see mock-identity.md).

## Remaining for Done

Execute `npm run test:e2e:identity` green in CI against the provisioned local stack, then flip
ADR-ACT-0157 to Done. The HTTP-level brokering chain and all unit/component/service tests are
green today; the Playwright click-through is wired and pending a CI stack run.
