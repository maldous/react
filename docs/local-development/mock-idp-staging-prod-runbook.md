# Runbook: mock IdP brokered login in staging / prod (per-env)

> **Purpose:** run the third-party login selector + brokered mock IdP flow
> (Google / Microsoft / Apple) in staging/prod **before** real providers are
> configured. **Temporary, explicit, noisy pre-real-provider bootstrap only.**
>
> ADR-ACT-0157 · ADR-0035. See `docs/local-development/mock-identity.md` for the
> architecture. This runbook does **not** implement real IdPs, change the brokered
> architecture, or remove any guardrail.

## Per-env mock-oidc (read first)

A single `node-oidc-provider` instance can emit only **one issuer**, so mock-oidc is a
**per-environment** service: it runs in each env's own Compose project (`react-dev` /
`react-test` / `react-staging` / `react-prod`) alongside that env's Keycloak, on its own
host port, emitting its own `MOCK_OIDC_PUBLIC_URL` issuer. All environments can therefore
run **concurrently** (the dev broker E2E and a live prod demo at the same time).

| Env     | `MOCK_OIDC_PORT` | `MOCK_OIDC_PUBLIC_URL` (browser issuer)         | `AUTH_PROVIDER_MODE` (default)  |
| ------- | ---------------- | ----------------------------------------------- | ------------------------------- |
| dev     | 9080             | `http://localhost:9080`                         | `mock`                          |
| test    | 9081             | `http://localhost:9081`                         | `mock`                          |
| staging | 9082             | `http://localhost:9082` (host-local; see below) | `real`                          |
| prod    | 9083             | `https://mock-idp.aldous.info`                  | `mock` (bootstrap, **enabled**) |

- Backchannel (Keycloak → token/jwks/userinfo) is the in-network service name
  `http://mock-oidc:8080` for every env (co-located with Keycloak; no host gateway).
- **Prod is permanently enabled** as a pre-real-provider bootstrap (`.env.prod`:
  `AUTH_PROVIDER_MODE=mock` + `ALLOW_MOCK_IDP_IN_PROD_UNTIL_REAL_PROVIDERS=true`).
- **Staging mock is host-local only for now.** The external host
  `mock-idp.staging.aldous.info` is a _second-level_ wildcard (`*.staging.aldous.info`)
  which Cloudflare Universal SSL does **not** cover — it needs a paid **Advanced
  Certificate** (ADR-ACT-0190). Until that exists, staging stays `real` (platform login
  only) externally; use host-local mode A to demo on staging.

## Safety & guardrails

- Mock IdPs are a **non-production fixture**. Do **not** present them as real
  Google/Microsoft/Apple. Do **not** put real provider credentials in `MOCK_OIDC_*`.
- In staging/prod the BFF **fails fast** unless the override is explicit
  (`apps/platform-api/src/server/auth-providers.ts → validateProviderModeAtStartup`):
  - `AUTH_PROVIDER_MODE=mock` **without** `ALLOW_MOCK_IDP_IN_PROD_UNTIL_REAL_PROVIDERS=true`
    → refuses to start.
  - `AUTH_PROVIDER_MODE=real` (explicit) with **no** real provider configured → refuses to start.
  - `AUTH_PROVIDER_MODE=mock` **with** the override → starts and logs a loud
    `⚠ TEMPORARY … mock identity providers are ENABLED` warning (the visible evidence).
- **Remove the override the moment real providers are configured** (see Rollback).

## Demo reachability modes

During the broker flow the browser is redirected to `MOCK_OIDC_PUBLIC_URL/<provider>/auth`,
so `MOCK_OIDC_PUBLIC_URL` must be reachable **by the stakeholder's browser** and must equal
the issuer Keycloak validates.

- **A. Host-local** — `MOCK_OIDC_PUBLIC_URL=http://localhost:<port>`. The browser must run
  **on the demo host** (where the apex resolves to loopback) or via an SSH local-forward
  (`ssh -L 8080:localhost:80 -L <port>:localhost:<port> <host>`). Works for any env now,
  including staging.
- **C. External prod** — `MOCK_OIDC_PUBLIC_URL=https://mock-idp.aldous.info`. External Caddy
  publishes a dedicated host that reverse-proxies prod's mock-oidc (`localhost:9083`) so a
  stakeholder completes the flow from **their own browser**. This is the **current live**
  prod configuration.
- **B. External staging** — `https://mock-idp.staging.aldous.info` → `localhost:9082`. The
  Caddy route is pre-wired but **inactive until** a Cloudflare Advanced Certificate covers
  `*.staging.aldous.info` (see above).

> External Caddy (`network_mode: host`) reverse-proxies `mock-idp.aldous.info` →
> `localhost:9083` and `mock-idp.staging.aldous.info` → `localhost:9082`
> (`docker/caddy/Caddyfile.external`, `handle` blocks ordered before the
> `*.staging`/`*.` wildcards). These hosts are **NON-PRODUCTION** — remove their
> Cloudflare DNS + handle block once real providers exist.

## DNS / Cloudflare assumptions

- Add a proxied (orange-cloud) Cloudflare DNS record for the demo host so Cloudflare
  terminates TLS and forwards plain HTTP to external Caddy on `:80`.
- **TLS coverage:** Universal SSL covers `aldous.info` and **one** wildcard level
  (`*.aldous.info`) — so **`mock-idp.aldous.info` (prod) is covered**. A second-level name
  like `mock-idp.staging.aldous.info` is **not** covered and needs an Advanced Certificate
  for `*.staging.aldous.info`.

## Prerequisites

- Docker + the repo checkout on the host.
- `infra/env/<env>/<env>.tfvars` present (`make keycloak-provision` needs it).
- `/etc/hosts` (or DNS) maps the apex (and `*.`) appropriately.
- `.env.<env>` already defines the domains, `SESSION_COOKIE_SECURE=true`,
  `LOG_LEVEL=info`, and the `MOCK_OIDC_*` block above — **leave those as they are**.

---

## Production (currently enabled — this is the live config)

`.env.prod` already contains:

```bash
AUTH_PROVIDER_MODE=mock
ALLOW_MOCK_IDP_IN_PROD_UNTIL_REAL_PROVIDERS=true
MOCK_OIDC_PORT=9083
MOCK_OIDC_PUBLIC_URL=https://mock-idp.aldous.info
MOCK_OIDC_INTERNAL_URL=http://mock-oidc:8080
MOCK_OIDC_KC_BROKER_BASE=https://aldous.info/kc/realms/platform-production/broker
# LOG_LEVEL=info, SESSION_COOKIE_SECURE=true already set — no change.
# MOCK_OIDC_REALM auto-derives from KEYCLOAK_REALM (platform-production).
```

Bring up / refresh:

```bash
make compose-up-default ENV=prod
make compose-up-identity ENV=prod          # Keycloak (host port 8093)
make keycloak-provision ENV=prod           # realm platform-production (needs tfvars)
make compose-up-identity-mocks ENV=prod    # PER-ENV mock-oidc in react-prod (:9083)
make seed-idps ENV=prod                    # mock-google/azure/apple on platform-production
make compose-up-web ENV=prod               # platform-api + web Caddy (:83)
make external-caddy-up                      # apex router on :80 (aldous.info → :83, mock-idp → :9083)
```

> **After changing `MOCK_OIDC_PUBLIC_URL`** rerun **both** `make compose-up-identity-mocks ENV=prod`
> and `make seed-idps ENV=prod` so the fixture issuer and the Keycloak IdP `issuer` match.

### Verify prod

```bash
# mock-oidc through external Caddy (mode C):
curl -fsS https://mock-idp.aldous.info/healthz
curl -fsS https://mock-idp.aldous.info/google/.well-known/openid-configuration | jq .
# app + broker:
curl -fsS https://aldous.info/api/auth/providers | jq .
curl -I "https://aldous.info/auth/login?provider=google"
# local route smoke without public DNS (Host header → external Caddy → prod mock-oidc):
curl -fsS -H "Host: mock-idp.aldous.info" http://localhost/google/.well-known/openid-configuration | jq .issuer
```

Expected:

- discovery `issuer` = `https://mock-idp.aldous.info/google`.
- `/api/auth/providers` lists `platform`, `google`, `azure`, `apple`; the three
  third-party entries show `"mode":"mock"`; **no secrets** in the payload.
- `/auth/login?provider=google` → `302` to
  `…/realms/platform-production/protocol/openid-connect/auth?…&kc_idp_hint=mock-google`.
- `/auth/login?provider=evil` → `400` (no injection / open redirect).
- the prod BFF logs the loud `⚠ TEMPORARY … mock identity providers are ENABLED` warning.

---

## Staging (host-local now; external when the cert lands)

Staging defaults to `AUTH_PROVIDER_MODE=real` (platform login only). To demo the mock
brokered flow **on the staging host** (mode A), temporarily set in `.env.staging`:

```bash
AUTH_PROVIDER_MODE=mock
ALLOW_MOCK_IDP_IN_PROD_UNTIL_REAL_PROVIDERS=true
# host-local issuer (already the default MOCK_OIDC_PUBLIC_URL in .env.staging):
MOCK_OIDC_PUBLIC_URL=http://localhost:9082
```

Then:

```bash
make compose-up-identity ENV=staging
make keycloak-provision ENV=staging
make compose-up-identity-mocks ENV=staging   # PER-ENV mock-oidc in react-staging (:9082)
make seed-idps ENV=staging
make compose-up-web ENV=staging
# verify from the staging host / SSH-forward:
curl -fsS http://localhost:9082/google/.well-known/openid-configuration | jq .issuer
curl -fsS -H "Host: staging.aldous.info" http://localhost/api/auth/providers | jq .
```

**External staging** (stakeholder's own browser) is only possible once a Cloudflare
Advanced Certificate covers `*.staging.aldous.info`. Then switch
`MOCK_OIDC_PUBLIC_URL=https://mock-idp.staging.aldous.info`, add the Cloudflare DNS for
that host, rerun `compose-up-identity-mocks` + `seed-idps` for staging, and the pre-wired
`mock-idp.staging.aldous.info` Caddy route (→ `:9082`) goes live.

---

## Rollback / flip-back (the eventual mock → real migration)

```bash
# edit .env.<env>:
AUTH_PROVIDER_MODE=real
ALLOW_MOCK_IDP_IN_PROD_UNTIL_REAL_PROVIDERS=false
make compose-up-web ENV=<env>          # restart the BFF with real mode
make identity-mocks-down ENV=<env>     # remove ONLY this env's mock-oidc (rm -sf, not down)
```

Then, for external (prod / future staging):

- **Remove the Cloudflare DNS** for `mock-idp.aldous.info` (and `mock-idp.staging.aldous.info`)
  so the demo hosts are no longer publicly resolvable.
- Optionally delete the `mock-idp` `handle` block(s) in `docker/caddy/Caddyfile.external`
  and `make external-caddy-up` to reload.
- Confirm `/api/auth/providers` no longer lists the mock third-party providers.

With `AUTH_PROVIDER_MODE=real` and no real provider configured yet, `/api/auth/providers`
returns **platform only** — the correct interim state until `REAL_<PROVIDER>_*` is added.

Platform-account-only login (hide third-party entirely without `real`):

```bash
AUTH_PROVIDER_MODE=disabled
ALLOW_MOCK_IDP_IN_PROD_UNTIL_REAL_PROVIDERS=false
make compose-up-web ENV=<env>
```

---

## Troubleshooting

| Symptom                                                     | Check / fix                                                                                                                                                                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Third-party providers don't appear in `/api/auth/providers` | `AUTH_PROVIDER_MODE=mock` **and** `ALLOW_MOCK_IDP_IN_PROD_UNTIL_REAL_PROVIDERS=true` in `.env.<env>`; recreate the BFF: `make compose-up-web ENV=<env>` (the container env must carry the vars — see `compose.yaml`).    |
| BFF won't start (exits immediately)                         | Guardrail: mock in prod-like without the override, or explicit `real` with no real config. Check the startup log line.                                                                                                   |
| `/auth/login?provider=google` → `400`                       | IdP not registered or provider disabled: `make seed-idps ENV=<env>` and confirm mock mode.                                                                                                                               |
| Keycloak rejects `redirect_uri` after the picker            | `MOCK_OIDC_KC_BROKER_BASE` must equal `<KC_HOSTNAME>/realms/<realm>/broker`; rerun `make compose-up-identity-mocks ENV=<env>` (+ `keycloak-provision` if `KC_HOSTNAME` is wrong).                                        |
| Mock picker / discovery doesn't load                        | `make compose-up-identity-mocks ENV=<env>`; confirm the env's `MOCK_OIDC_PORT` is reachable from the browser; for external, check `make external-caddy-up` + `curl -H "Host: mock-idp.<host>" http://localhost/healthz`. |
| Keycloak token exchange fails                               | mock-oidc is co-located with Keycloak; the backchannel `MOCK_OIDC_INTERNAL_URL=http://mock-oidc:8080` must resolve on the project network (it's the same `react-<env>` project).                                         |
| `iss` / signature validation fails                          | `MOCK_OIDC_PUBLIC_URL` must match what the seed wrote as the IdP `issuer` (re-run `make seed-idps ENV=<env>` after changing it).                                                                                         |
| Wrong env's issuer served on a port                         | Each env has its OWN port now (dev 9080 / test 9081 / staging 9082 / prod 9083) — no shared instance to re-point. Confirm the container is `react-<env>-mock-oidc-1`.                                                    |

## Verification scope

The make targets, env-var names, and guardrail behaviour were verified against the repo
(`make/compose.mk`, `scripts/compose/up.sh`, `compose.yaml`, `.env.example`,
`apps/platform-api/src/server/auth-providers.ts`, `services/mock-oidc/src/config.ts`).
The dev broker E2E (`npm run test:e2e:identity`, 8/8) runs against the per-env dev
mock-oidc **while the prod instance is live**, proving env isolation. The live prod
flow (`https://mock-idp.aldous.info` issuer, `platform-production` realm,
`kc_idp_hint=mock-google`, injection guard) was verified end-to-end at the HTTP layer.
