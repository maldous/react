# Composed-service SSO capability matrix

Source ADR: ADR-0073 · Action: ADR-ACT-0275

App-login (Keycloak realm) SSO for the composed Compose GUI services. Opt-in via
`COMPOSE_SSO_ENABLED` (compose) + `enable_composed_sso` (Keycloak provisioning), both
default false. Live OIDC click-through is proven on a running stack (deferred — not
browser-verifiable in CI/sandbox); the wiring below is statically validated
(`make infra-check`, `npm run compose:config:all`, `make env-validate-all`).

## Matrix

| Service | SSO support | Keycloak client | Service-side wiring | Role mapping | Status |
| --- | --- | --- | --- | --- | --- |
| **Grafana** | Native generic OAuth (OIDC) | confidential `grafana` (+ realm-role mapper) | `GF_AUTH_GENERIC_OAUTH_*` in compose (gated) | `roles` claim → system-admin=Admin, tenant-admin=Editor, else Viewer | **Wired** (live proof deferred) |
| **MinIO** | Native console OIDC | public PKCE `minio` (ADR-0030) + realm-role mapper | `MINIO_IDENTITY_OPENID_*` in compose (ADR-0030) | claim-based → MinIO policy (policy names must match) | **Wired** (policy mapping documented; live proof deferred) |
| **pgAdmin** | Native OAuth2 | public PKCE `pgadmin` (ADR-0030) + realm-role mapper | needs `config_local.py` / `OAUTH2_CONFIG` (not env-only) | claim → pgAdmin role | **Client-ready** — service config file is the remaining step |
| **SonarQube** | Via `sonar-auth-oidc` plugin (no native OIDC in community) | confidential `sonarqube` (+ realm-role mapper) | needs the plugin jar in `extensions/plugins` + `sonar.auth.oidc.*` props | `roles` claim → Sonar group/permission | **Client-ready** — plugin install + props is the remaining step |
| **Keycloak** | N/A (it IS the IdP) | — | admin console uses Keycloak's own auth | — | N/A |
| **Sentry** (self-hosted) | SSO is a business/paid feature; community self-hosted is limited | — | — | — | **Not wired** (documented) |
| **Mailpit / ClickHouse / WireMock / LocalStack / Tilt** | No SSO support | — | — | — | **N/A** |

## Wiring summary (delivered)

- Keycloak module: confidential `grafana` + `sonarqube` clients; realm-role token
  mappers (claim `roles`, ID token + userinfo) for grafana/sonarqube/minio/pgadmin;
  all gated by `enable_composed_sso`. Per-env redirect URIs. `make infra-check` green.
- Generated env: `GRAFANA_OIDC_CLIENT_SECRET` + `SONAR_OIDC_CLIENT_SECRET` (per-env
  derived secrets, ADR-0072); `COMPOSE_SSO_ENABLED` (common.json, false).
- `keycloak-provision` exports `TF_VAR_enable_composed_sso` + the two client secrets.
- compose: Grafana `GF_AUTH_GENERIC_OAUTH_*` (gated); MinIO already wired (ADR-0030).

## How to enable (on a running stack)

1. `COMPOSE_SSO_ENABLED=true` in the env (or set it in the manifest/seeded material) +
   regenerate; bring the env up.
2. Provision the clients: `make keycloak-provision ENV=<env>` with `enable_composed_sso=true`.
3. Click through from `/admin/clickthrough` → Grafana/MinIO → land authenticated via the
   platform Keycloak login with the mapped role. ← live acceptance proof.

## Not delivered

pgAdmin OAuth2 service config file; SonarQube `sonar-auth-oidc` plugin install + props;
live per-service OIDC click-through proof; staging/prod env wiring of the SSO vars (dev
is the validated reference).

## Linkage

ADR-0073 · ADR-ACT-0275 · builds on ADR-0030 (admin-tool clients), ADR-0072 (env),
ADR-ACT-0233 (click-through).
