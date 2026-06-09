# Runbook: temporary mock IdP brokered login in staging / prod

> **Purpose:** demonstrate the third-party login selector + brokered mock IdP flow
> (Google / Microsoft / Apple) to stakeholders in staging/prod **before** real
> providers are configured. **Temporary, explicit, noisy bootstrap only.**
>
> ADR-ACT-0157 · ADR-0035. See `docs/local-development/mock-identity.md` for the
> architecture. This runbook does **not** implement real IdPs, change the brokered
> architecture, or remove any guardrail.

## Read first — safety & guardrails

- Mock IdPs are a **non-production fixture**. Do **not** present them as real
  Google/Microsoft/Apple authentication. Do **not** put real provider credentials
  into the `MOCK_OIDC_*` settings.
- In staging/prod the BFF **fails fast** unless the override is explicit
  (`apps/platform-api/src/server/auth-providers.ts → validateProviderModeAtStartup`):
  - `AUTH_PROVIDER_MODE=mock` **without** `ALLOW_MOCK_IDP_IN_PROD_UNTIL_REAL_PROVIDERS=true`
    → refuses to start.
  - `AUTH_PROVIDER_MODE=real` (explicit) with **no** real provider configured → refuses to start.
  - `AUTH_PROVIDER_MODE=mock` **with** the override → starts and logs a loud
    `⚠ TEMPORARY … mock identity providers are ENABLED` warning (the visible evidence).
- **Remove the override the moment real providers are configured** (see Rollback).

## Reachability constraint (important — read before promising a remote demo)

The mock-oidc fixture is published on the **host** at `localhost:9080` and is **not**
exposed through Caddy/Cloudflare/TLS. The browser is redirected to
`MOCK_OIDC_PUBLIC_URL/<provider>/auth` during the broker flow, so:

- **Drive the demo from a browser on the demo host** (where `staging.aldous.info` /
  `aldous.info` resolve to `127.0.0.1` and `localhost:9080` is the host's mock-oidc), **or**
- SSH local-forward **both** the app origin and the mock port to your laptop, e.g.
  `ssh -L 8080:localhost:80 -L 9080:localhost:9080 <host>` and demo via the forwarded ports.

A purely remote browser hitting the public apex **cannot** reach `localhost:9080` and the
provider step will fail. (Real Google/Apple/Microsoft do not have this constraint — this is
only because the mock is a local fixture.)

## Prerequisites

- Docker + the repo checkout on the demo host.
- `infra/env/<env>/<env>.tfvars` present (Terraform realm provisioning is operator-supplied;
  `make keycloak-provision` fails without it).
- `/etc/hosts` on the demo host maps the apex (and `*.`) to loopback, e.g.
  `127.0.0.1 staging.aldous.info` / `127.0.0.1 aldous.info`.
- `.env.staging` / `.env.prod` already define the correct domains
  (`APEX_DOMAIN`, `APP_BASE_URL`, `KC_HOSTNAME`, `PLATFORM_API_URL`),
  `SESSION_COOKIE_SECURE=true`, and `LOG_LEVEL=info` — **leave those as they are**.

---

## Staging

### 1. Edit `.env.staging` (append the mock-IdP block; keep existing domain values)

```bash
AUTH_PROVIDER_MODE=mock
ALLOW_MOCK_IDP_IN_PROD_UNTIL_REAL_PROVIDERS=true
MOCK_OIDC_PORT=9080
MOCK_OIDC_PUBLIC_URL=http://localhost:9080
MOCK_OIDC_INTERNAL_URL=http://host.docker.internal:9080
MOCK_OIDC_CLIENT_SECRET=mock-oidc-shared-secret
# REQUIRED for staging — the mock must accept the staging realm's broker callback.
# (Default is a dev value; without this, Keycloak's redirect_uri is rejected.)
MOCK_OIDC_KC_BROKER_BASE=https://staging.aldous.info/kc/realms/platform-staging/broker
# LOG_LEVEL=info and SESSION_COOKIE_SECURE=true are already set in .env.staging — no change.
# MOCK_OIDC_REALM is auto-derived from KEYCLOAK_REALM (platform-staging) — no need to set.
```

### 2. Start / refresh staging

```bash
make compose-up-default ENV=staging        # postgres, redis, etc.
make compose-up-identity ENV=staging       # Keycloak (host port 8092)
make keycloak-provision ENV=staging        # realm platform-staging + BFF client (needs tfvars)
make compose-up-identity-mocks ENV=staging # shared mock-oidc (react-shared) on :9080
make seed-idps ENV=staging                 # registers mock-google/azure/apple on platform-staging
make compose-up-observability ENV=staging  # Loki/Grafana/Alloy (optional)
make compose-up-web ENV=staging            # platform-api container + web Caddy (:82)
make external-caddy-up                      # apex router on :80 (staging.aldous.info → :82)
make env-status                             # sanity: list running containers
```

### 3. Verify staging

```bash
# From the demo host (external-caddy on :80; Cloudflare adds TLS in real prod):
curl -fsS http://staging.aldous.info/api/auth/providers | jq .
curl -I "http://staging.aldous.info/auth/login?provider=google"
bash scripts/smoke/loki-smoke.sh staging      # ingestion + label-cardinality (optional)
```

Expected:

- `/api/auth/providers` lists `platform`, `google`, `azure`, `apple`; the three
  third-party entries show `"mode":"mock"`; **no secrets** in the payload.
- `/auth/login?provider=google` → `302` with `Location:`
  `https://staging.aldous.info/kc/realms/platform-staging/protocol/openid-connect/auth?…&kc_idp_hint=mock-google`.
- `https://staging.aldous.info/login` shows the provider selector with a **Mock provider** badge.
- Clicking Google/Microsoft/Apple reaches the mock-oidc scenario picker at
  `http://localhost:9080/<provider>/interaction/…` (host browser only — see reachability note).

---

## Production

### 1. Edit `.env.prod` (append the mock-IdP block; keep existing domain values)

```bash
AUTH_PROVIDER_MODE=mock
ALLOW_MOCK_IDP_IN_PROD_UNTIL_REAL_PROVIDERS=true
MOCK_OIDC_PORT=9080
MOCK_OIDC_PUBLIC_URL=http://localhost:9080
MOCK_OIDC_INTERNAL_URL=http://host.docker.internal:9080
MOCK_OIDC_CLIENT_SECRET=mock-oidc-shared-secret
MOCK_OIDC_KC_BROKER_BASE=https://aldous.info/kc/realms/platform-production/broker
# LOG_LEVEL=info and SESSION_COOKIE_SECURE=true are already set in .env.prod — no change.
```

### 2. Start / refresh prod

```bash
make compose-up-default ENV=prod
make compose-up-identity ENV=prod          # Keycloak (host port 8093)
make keycloak-provision ENV=prod           # realm platform-production (needs tfvars)
make compose-up-identity-mocks ENV=prod    # shared mock-oidc (react-shared) on :9080
make seed-idps ENV=prod                    # registers mock-* on platform-production
make compose-up-observability ENV=prod     # optional
make compose-up-web ENV=prod               # platform-api + web Caddy (:83)
make external-caddy-up                      # apex router on :80 (aldous.info → :83)
make env-status
```

### 3. Verify prod

```bash
curl -fsS https://aldous.info/api/auth/providers | jq .   # http://aldous.info from host w/o Cloudflare
curl -I "https://aldous.info/auth/login?provider=google"
bash scripts/smoke/loki-smoke.sh prod                     # optional
```

Expected: same as staging, with realm `platform-production` and
`kc_idp_hint=mock-google` in the `/auth/login` redirect.

> **Note — single shared mock-oidc.** mock-oidc runs once in the `react-shared`
> project. `make compose-up-identity-mocks ENV=<env>` (re)starts it with **that env's**
> `MOCK_OIDC_KC_BROKER_BASE`, so its allowed redirect_uris reflect the **last** env you
> started it for. To demo more than one env concurrently, list the others in
> `MOCK_OIDC_EXTRA_REDIRECT_URIS` (comma-separated full broker-endpoint URLs).

---

## Rollback / flip-back (do this after the demo)

```bash
# staging — edit .env.staging:
AUTH_PROVIDER_MODE=real
ALLOW_MOCK_IDP_IN_PROD_UNTIL_REAL_PROVIDERS=false
make compose-up-web ENV=staging        # restart the BFF with real mode
make identity-mocks-down               # stop the shared mock-oidc fixture

# prod — edit .env.prod:
AUTH_PROVIDER_MODE=real
ALLOW_MOCK_IDP_IN_PROD_UNTIL_REAL_PROVIDERS=false
make compose-up-web ENV=prod
make identity-mocks-down
```

With `AUTH_PROVIDER_MODE=real` and no real provider configured yet,
`/api/auth/providers` returns **platform only** (the third-party rows disappear) — this is
the correct interim state until real `REAL_<PROVIDER>_*` config is added.

Platform-account-only login (hide third-party entirely without `real`):

```bash
AUTH_PROVIDER_MODE=disabled
ALLOW_MOCK_IDP_IN_PROD_UNTIL_REAL_PROVIDERS=false
make compose-up-web ENV=<env>
```

---

## Troubleshooting

| Symptom                                                     | Check / fix                                                                                                                                                                                                            |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Third-party providers don't appear in `/api/auth/providers` | `AUTH_PROVIDER_MODE=mock` **and** `ALLOW_MOCK_IDP_IN_PROD_UNTIL_REAL_PROVIDERS=true`; restart `make compose-up-web ENV=<env>`.                                                                                         |
| BFF won't start (exits immediately)                         | Guardrail: mock in prod-like without the override, or explicit `real` with no real config. Check the startup log line.                                                                                                 |
| `/auth/login?provider=google` → `400`                       | IdP not registered or provider disabled: `make seed-idps ENV=<env>` and confirm mock mode.                                                                                                                             |
| Keycloak rejects `redirect_uri` after the picker            | `MOCK_OIDC_KC_BROKER_BASE` must equal `<KC_HOSTNAME>/realms/<realm>/broker`; restart `make compose-up-identity-mocks ENV=<env>`. Re-run `make keycloak-provision ENV=<env>` if `APP_BASE_URL`/`KC_HOSTNAME` are wrong. |
| Mock picker doesn't load                                    | `make compose-up-identity-mocks ENV=<env>`; confirm `MOCK_OIDC_PUBLIC_URL` and that `localhost:9080` is reachable **from the browser** (host/tunnel).                                                                  |
| Keycloak token exchange fails                               | From the Keycloak container, `MOCK_OIDC_INTERNAL_URL` (`host.docker.internal:9080`) must be reachable (Keycloak's compose `extra_hosts: host.docker.internal:host-gateway`).                                           |
| `iss` / signature validation fails                          | `MOCK_OIDC_PUBLIC_URL` must match what the seed wrote as the IdP `issuer` (re-run `make seed-idps ENV=<env>` after changing it).                                                                                       |
| No platform-api logs in Loki                                | `LOG_LEVEL=info` (already default in staging/prod); run `scripts/smoke/loki-smoke.sh <env>`.                                                                                                                           |

## Verification scope of this runbook

The make targets, env-var names, and guardrail behaviour were verified against the repo
(`make/compose.mk`, `scripts/compose/up.sh`, `compose.yaml`, `.env.example`,
`apps/platform-api/src/server/auth-providers.ts`, `services/mock-oidc/src/config.ts`), and the
full flow is verified end-to-end in **dev/test** (`npm run test:e2e:identity`). The
staging/prod commands are statically correct but assume operator-supplied Terraform tfvars,
Cloudflare/TLS, and `/etc/hosts` — exercise them on the demo host before the stakeholder session.
