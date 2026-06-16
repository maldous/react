# Composed-service SSO capability matrix

Source ADR: ADR-0073 · Action: ADR-ACT-0275

App-login (Keycloak realm) SSO for the composed Compose GUI services — **ON by default**
(`COMPOSE_SSO_ENABLED` + `enable_composed_sso` both default true) for every service that
supports it; each keeps native-auth fallback so it stays healthy if OIDC is unreachable.
The wiring below is statically validated (`make infra-check`, `npm run compose:config:all`,
`make env-validate-all`) and was additionally verified live against the running prod stack
(client-secret parity, redirect-URI registration, issuer reachability, and login-init
redirects — see "Live verification" below).

## Matrix

| Service | SSO support | Keycloak client | Service-side wiring | Admin mapping | Status |
| --- | --- | --- | --- | --- | --- |
| **Grafana** | Native generic OAuth (OIDC) | confidential `grafana` (+ realm-role mapper) | `GF_AUTH_GENERIC_OAUTH_*` in compose (gated); `auto_login`; `ROOT_URL` from `APP_BASE_URL` | `roles` claim → `system-admin`=GrafanaAdmin, else Admin (`role_attribute_strict=false`) | **Wired + verified** |
| **MinIO** | Native console OIDC | public `minio` (ADR-0030), **PKCE mandate removed** + hardcoded `policy` mapper | `MINIO_IDENTITY_OPENID_*`; `MINIO_IDENTITY_OPENID_CLAIM_NAME=policy` | client emits `policy=consoleAdmin` for all client users → console admin | **Wired + verified live** (SSO completes → /minio/browser, session 200; 2026-06-16) |
| **pgAdmin** | Native OAuth2 | **confidential** `pgadmin` (+ realm-role mapper) | `config_local.py` `OAUTH2_CONFIG`: `OAUTH2_CLIENT_SECRET` + **`OAUTH2_SERVER_METADATA_URL`** (discovery → `jwks_uri`) + **`OAUTH2_ADDITIONAL_CLAIMS: None`**; `OAUTH2_AUTO_CREATE_USER` | auto-created users manage their own server connections | **Wired + verified live** (lands on /pgadmin/browser/; 2026-06-16) |
| **SonarQube** | Via `sonar-auth-oidc` plugin (no native OIDC in community) | confidential `sonarqube` (+ realm-role mapper) | plugin jar via init service **+ settings written by `scripts/sonar/provision-oidc.sh`** (NOT env vars — see gotcha) | `roles` claim → group sync → `system-admin` Sonar group with global admin | **Wired + verified** |
| **Keycloak** | N/A (it IS the IdP) | — | admin console uses Keycloak's own auth | — | N/A |
| **Sentry** (self-hosted) | SSO is a business/paid feature; community self-hosted is limited | — | — | — | **Not wired** (documented) |
| **Mailpit / ClickHouse / WireMock / LocalStack / Tilt** | No SSO support | — | — | — | **N/A** |

## Critical gotchas (discovered + fixed)

1. **Grafana `ROOT_URL` must be the public base, no internal port.** Grafana builds
   the OIDC `redirect_uri` from `GF_SERVER_ROOT_URL`. Using `%(http_port)s` (the
   internal 3000) produced `https://host:3000/grafana/login/generic_oauth`, which is
   neither registered nor reachable, so Keycloak rejected the callback and SSO never
   completed. Fixed by deriving `ROOT_URL` from `APP_BASE_URL`.
2. **SonarQube cannot configure the OIDC plugin via env vars.** SonarQube maps `SONAR_*`
   env vars to properties by lowercasing, so it cannot produce the plugin's camelCase
   property names (`sonar.auth.oidc.issuerUri`, `clientId.secured`,
   `groupsSync.claimName`, `sonar.core.serverBaseURL`). Those settings are written
   through the web API by `scripts/sonar/provision-oidc.sh` (run from `make
   sonar-provision`), where they persist in the SonarQube DB volume — reproduced from
   scratch exactly like the analysis token.
3. **The shared SonarQube binds to ONE realm (prod).** It is a single instance, so its
   OIDC client lives in exactly one realm. Its `SONAR_OIDC_CLIENT_SECRET` must equal the
   **prod** environment's value; the generator derives it with the prod target
   (`SHARED_REALM_BOUND_SECRETS` in `generate-runtime-env.mjs`) so `.env/sonar.env`,
   `.env/prod.env`, and the provisioned Keycloak client all agree.
4. **SonarQube admin via SSO needs a group + permission.** Group sync alone creates a
   non-admin user. `provision-oidc.sh` creates a `system-admin` Sonar group with global
   administration; group sync (claim `roles`) maps the Keycloak realm role `system-admin`
   to it, so the platform system administrator gets full Sonar access. Forward-auth
   (ADR-0030) already restricts `/sonar` to system administrators. **Ordering bug (fixed 2026-06-16):**
   `provision-token.sh` did `exit 0` at the token-validity check BEFORE the admin-password
   rotation, so once the analysis token was minted (the steady state) `admin/admin` was never
   rotated — the live shared instance still validated `admin:admin` even with OIDC enabled. The
   token early-exit is now §4c (after the §4b rotation), so the managed `SONAR_ADMIN_PASSWORD` is
   ensured on every run. Verified live: post-fix `admin:admin` → `{"valid":false}`, managed
   password → `{"valid":true}`, `autoLogin=true`, `system-admin` group holds
   `admin/gateadmin/profileadmin/provisioning/scan`.
5. **pgAdmin authlib needs `jwks_uri` — supply OIDC discovery.** pgAdmin's authlib validates
   the ID-token signature on the code exchange and fails with `Missing "jwks_uri" in metadata`
   if only the explicit token/auth/userinfo endpoints are configured. Fixed by adding
   `OAUTH2_SERVER_METADATA_URL` (the `.well-known/openid-configuration` discovery doc) on the
   **internal** KC URL so the container can fetch it; the explicit public authorization URL and
   internal token/userinfo URLs still take precedence (split-horizon), so only `jwks_uri`/`issuer`
   come from discovery (2026-06-16). The discovered backchannel URLs are made container-reachable
   by gotcha #6.
6. **KC must use `hostname-backchannel-dynamic` so discovery advertises INTERNAL backchannel URLs.**
   With `KC_HOSTNAME_STRICT=true` and the deprecated v1 `KC_HOSTNAME_STRICT_BACKCHANNEL` (ignored
   under KC 26 hostname-v2), the OIDC discovery doc returned the **public** token/jwks/userinfo URLs.
   A container deriving its endpoints from discovery (MinIO `…CONFIG_URL`, pgAdmin
   `OAUTH2_SERVER_METADATA_URL`) then hit `https://aldous.info/kc/...` and got **HTTP 403** from
   Cloudflare (public certs → 403; internal certs → 200). Fixed with
   `KC_HOSTNAME_BACKCHANNEL_DYNAMIC: "true"` (`compose.yaml`): issuer + authorization_endpoint stay
   public (browser + token `iss` unchanged), backchannel endpoints resolve internal. Verified live:
   discovery over `http://keycloak:8080` now returns internal token/jwks/userinfo, and the real-auth
   login suite still passes (no regression).
7. **MinIO console sends no PKCE — the KC `minio` client must not mandate it.** With
   `pkce_code_challenge_method = "S256"` the client required PKCE, but the MinIO console
   (RELEASE.2024-12-18) sends no `code_challenge`, so KC rejected the login with
   `Missing parameter: code_challenge_method` (surfaced as the "No session" error). Fixed by
   removing the mandate (`main.tf`); the redirect-URI allowlist + forward-auth gate are the controls.
8. **pgAdmin `OAUTH2_ADDITIONAL_CLAIMS` must be `None`, not `{}`.** A non-None value (even an empty
   dict) makes pgAdmin enforce its additional-claim authorisation check, and `{}` matches nothing →
   every SSO'd user is denied ("not authorized … additional claim required {}") after an otherwise
   successful token exchange. `None` disables the check; forward-auth already restricts `/pgadmin` to
   system-admins. Verified live: pgAdmin now lands on `/pgadmin/browser/`.

## Wiring summary (delivered)

- Keycloak module: confidential `grafana` + `sonarqube` + `pgadmin` clients; realm-role
  token mappers (claim `roles`) for grafana/sonarqube/minio/pgadmin; MinIO hardcoded
  `policy=consoleAdmin` mapper; all gated by `enable_composed_sso` (default true).
- Generated env: per-env `GRAFANA_OIDC_CLIENT_SECRET` / `PGADMIN_OIDC_CLIENT_SECRET`;
  realm-bound `SONAR_OIDC_CLIENT_SECRET` (derived as prod for the shared instance);
  `COMPOSE_SSO_ENABLED=true` (common.json + shared.json sonar).
- `keycloak-provision` exports `TF_VAR_enable_composed_sso` + all three client secrets.
- compose: Grafana `GF_AUTH_GENERIC_OAUTH_*` (gated, auto-login, role mapping); MinIO
  OpenID; pgAdmin `PGADMIN_OIDC_CLIENT_SECRET`; SonarQube plugin init service.
- `scripts/sonar/provision-oidc.sh` writes the Sonar OIDC settings + admin group.

## Live verification (prod stack, this session)

- Keycloak client-secret parity: grafana / sonarqube / pgadmin secrets MATCH the
  generated env (`.env/prod.env`, `.env/sonar.env`).
- Registered redirect URIs match each service's runtime callback (grafana
  `…/grafana/login/generic_oauth`, sonar `…/sonar/oauth2/callback/oidc`, pgadmin
  `…/pgadmin/oauth2/authorize`, minio `…/minio/oauth_callback`).
- Grafana login-init redirect now carries the correct `redirect_uri` (no `:3000`).
- SonarQube: plugin `authoidc 2.1.1` loaded; container reaches the issuer discovery
  doc; login-init redirects to Keycloak with the registered callback; `system-admin`
  group holds `admin`/`gateadmin`/`profileadmin`/`provisioning`/`scan`.
- Realm roles confirmed: `sysadmin@aldous.info` carries `system-admin`.

Browser-driven end-to-end click-through (actual cookie + role landing) remains a
human/Playwright step on a stack with the prod realm reachable.

## Linkage

ADR-0073 · ADR-ACT-0275 · builds on ADR-0030 (admin-tool clients), ADR-0072 (env),
ADR-ACT-0233 (click-through).
