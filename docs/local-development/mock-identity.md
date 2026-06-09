# Mock identity providers (brokered third-party login)

> ADR-ACT-0157 · ADR-0029 (per-tenant SSO) · ADR-0030 (tenant auth self-service)

This repo can develop and demo **"Continue with Google / Microsoft / Apple"** before
real provider tenants exist, without changing the production architecture. The flow is
identical in every environment:

```text
React /login → BFF /auth/login?provider=<id> → Keycloak (broker)
            → upstream IdP (mock or real) → Keycloak callback
            → BFF /auth/callback → app session
```

- The React app **never** talks to Google/Apple/Azure or the mock directly. It only
  renders provider choices (from `GET /api/auth/providers`) and links to the BFF handoff.
- **Keycloak is always the identity broker.** Only the upstream provider changes
  (mock now, real later).
- Switching mock → real is a **configuration change only** — the React contract, the
  `/api/auth/providers` shape, the `/auth/login?provider=` handoff, the BFF validation,
  and the product provider IDs (`google`, `azure`, `apple`, `platform`) never change.

## Why not WireMock?

WireMock stays a deterministic **external HTTP API** mock only. It is **not** an OIDC
provider: Keycloak performs a real authorization-code flow and validates a **signed ID
token whose `nonce` it generated dynamically**, which static stubs cannot satisfy. The
upstream IdP fixture is therefore a real OIDC server (`services/mock-oidc`, wrapping
`node-oidc-provider`).

## Components

| Piece                          | Where                                                                      |
| ------------------------------ | -------------------------------------------------------------------------- |
| mock-oidc fixture (3 issuers)  | `services/mock-oidc/` (compose profile `identity-mocks`)                   |
| Keycloak broker registration   | `npm run seed:idps` → `KeycloakRealmAdminAdapter.upsertIdentityProvider()` |
| Provider mode + mapping + list | `apps/platform-api/src/server/auth-providers.ts`                           |
| BFF handoff (`kc_idp_hint`)    | `apps/platform-api/src/server/auth.ts` (`/auth/login?provider=`)           |
| Provider list endpoint         | `GET /api/auth/providers`                                                  |
| React selector                 | `apps/react-enterprise-app/src/routes/login.tsx`                           |

### mock-oidc personas, ports, issuers

| Provider | Keycloak alias | Browser issuer (`MOCK_OIDC_PUBLIC_URL`) | Keycloak backchannel (`MOCK_OIDC_INTERNAL_URL`) |
| -------- | -------------- | --------------------------------------- | ----------------------------------------------- |
| google   | `mock-google`  | `http://localhost:9080/google`          | `http://mock-oidc:8080/google`                  |
| azure    | `mock-azure`   | `http://localhost:9080/azure`           | `http://mock-oidc:8080/azure`                   |
| apple    | `mock-apple`   | `http://localhost:9080/apple`           | `http://mock-oidc:8080/apple`                   |

The split-horizon (browser vs. Keycloak-container reachability) is handled with
**explicit Keycloak endpoint config**: `authorizationUrl` is the public issuer while
`token`/`jwks`/`userinfo`/`issuer` are the backchannel base. The ID-token `iss` equals
the public issuer and Keycloak validates it as a string, so no `/etc/hosts` entry is
needed. See `services/mock-oidc/README.md` for scenarios (verified / unverified / denied
/ provider-error / disabled).

## Environment / provider mode policy

`AUTH_PROVIDER_MODE = mock | real | disabled` (read by the BFF; see `.env.example`).

| Env     | Default | Mock providers                                                                         | Real providers |
| ------- | ------- | -------------------------------------------------------------------------------------- | -------------- |
| dev     | `mock`  | on by default                                                                          | —              |
| test    | `mock`  | on by default                                                                          | —              |
| staging | `real`  | **only** with `ALLOW_MOCK_IDP_IN_PROD_UNTIL_REAL_PROVIDERS=true` (temporary bootstrap) | preferred      |
| prod    | `real`  | **only** with `ALLOW_MOCK_IDP_IN_PROD_UNTIL_REAL_PROVIDERS=true` (temporary bootstrap) | preferred      |

Startup guardrails (BFF `validateProviderModeAtStartup`, fail-fast):

- `mock` in staging/prod **without** the override → the BFF **refuses to start**.
- `mock` in staging/prod **with** the override → starts but logs a loud `⚠ TEMPORARY` warning
  (the visible evidence that a non-production bootstrap is active). **Remove the override
  once real providers exist.**
- Explicit `AUTH_PROVIDER_MODE=real` with **no** real provider configured → **refuses to start**.
- `disabled` → `/login` shows only the platform (Keycloak) login.

## Run it locally

```bash
make compose-up-default            # redis (+ postgres)
make compose-up-identity           # Keycloak
make keycloak-provision ENV=dev    # platform realm + BFF client (Terraform)
make compose-up-identity-mocks     # mock-oidc fixture
make seed-idps ENV=dev             # register mock-google / mock-azure / mock-apple (idempotent)
tilt up                            # or run the BFF + SPA directly
```

Then open `http://localhost:5173/login`, click a provider, choose a scenario on the mock
picker, and you are brokered back into the app. `npm run test:e2e:identity` automates this.

## Switching to real providers

1. Configure the real provider on the Keycloak platform realm under the same alias
   (`google` / `azure` / `apple`) — via Terraform (`infra/modules/keycloak`) or the tenant
   Auth Settings API. Secrets stay in Keycloak / tenant settings; they are never exposed to
   React or `/api/auth/providers`.
2. Set `AUTH_PROVIDER_MODE=real` and provide `REAL_<PROVIDER>_ISSUER` / `_CLIENT_ID` /
   `_CLIENT_SECRET` for each provider you enable.
3. Remove `ALLOW_MOCK_IDP_IN_PROD_UNTIL_REAL_PROVIDERS` and stop the `identity-mocks` profile.

No React or contract changes are required — `/api/auth/providers` simply reports
`mode: "real"` and the same product IDs.
