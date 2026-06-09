# Evidence: ADR-ACT-0157 — Brokered third-party IdP mock slice

**Date:** 2026-06-09
**Status:** Done
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
  flow against the live stack, with a dedicated real-auth BFF (no LOCAL_FIXTURE_SESSION) and Vite
  on isolated ports (3099/5180) so the result reflects the genuine brokered session.

## Full browser E2E — GREEN (2026-06-09)

Command: `npm run test:e2e:identity` → **8 passed** (Playwright/chromium, ~8s).

Covered through the complete real browser redirect chain
(React /login → BFF /auth/login?provider= → Keycloak kc_idp_hint → mock-oidc picker →
Keycloak broker callback → BFF /auth/callback → authenticated app session, /api/session=200):

- `/login` renders the configured providers.
- **google / azure / apple — verified user authenticates and returns to the app** (3 full success flows).
- denied/cancelled login → safe app-facing error, no session (`/api/session=401`), no internal leak.
- provider-error → safe app-facing error, no session.
- invalid provider hint (`provider=evil&kc_idp_hint=attacker`) → BFF `400`, no session (no broker injection / open redirect).
- provider list exposes no secrets.

## Root-cause notes / honest limitations

- **Callback-host alignment (fixed):** the broker chain must stay on one origin. The Vite dev proxy
  now uses `changeOrigin:false` for `/auth` + `/api` (so the BFF derives its Keycloak public URL and
  OAuth `redirect_uri` from the browser origin) and `changeOrigin:true` for `/kc` (so Keycloak keeps
  its strict `KC_HOSTNAME`). The E2E runs its own real-auth BFF on a dedicated port — reusing the
  Tilt dev BFF (which runs `LOCAL_FIXTURE_SESSION`) would make `/api/session` always 200 and mask the
  real result.
- **Unverified-email rejection is unit-level, by design.** Keycloak's brokered `emailVerified` is
  governed by the IdP's top-level `trustEmail` flag, **not** the per-token `email_verified` claim
  (confirmed empirically: with `trustEmail=false` even a token carrying `email_verified=true` yields a
  Keycloak user with `emailVerified=false`). The mock IdPs use `trustEmail=true` — the production-correct
  setting for trusted upstreams (Google/Microsoft/Apple only release verified emails) — so brokered
  logins succeed and the broker never surfaces an unverified email to the BFF. The BFF callback gate
  (`mapKeycloakClaims` rejects `email_verified !== true` / missing email) is therefore exercised by
  `packages/adapters-keycloak/tests/adapters-keycloak.test.ts`, and the real-path rejection of failed
  broker logins is covered end-to-end by the denied + provider-error E2E tests.
