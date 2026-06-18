# Admin clickthrough / composed-service SSO — diagnosis + fixes

Source ADRs: ADR-0030 (admin-tool forward-auth), ADR-0073 (composed-service SSO),
ADR-ACT-0233 (clickthrough policy), ADR-ACT-0275 (SSO rollout), ADR-ACT-0282 (shared
service bridges). Date: 2026-06-16.

Scope: the `/admin/clickthrough` surface and the per-service SSO state after the ADR-0073
SSO changes. Verified live against the running `react-prod` stack (deployed via `make all`,
fronted by Caddy at `https://aldous.info`) using the real-auth Playwright suites
(`e2e/external/*`) authenticated as `sysadmin@aldous.info`, plus direct API/container probes.

## 1. Diagnosis table

| Service | Expected | Observed | Root cause | Decision |
| --- | --- | --- | --- | --- |
| **keycloak** | KC admin console prompts for KC's own admin auth (it IS the IdP) | Keycloak login prompt | Correct behaviour (ADR-ACT-0233 isolation invariant) | **No fix** |
| **mailpit** | No SSO; shared dev inbox opens directly behind forward-auth | Opens, no auth | Correct (no SSO support) | **No fix** |
| **sentry** | Self-hosted Sentry SSO is a paid feature — **not wired**; native sign-in is the path | Native sign-in; "Single Sign-On" asks for Organization ID | Sentry's built-in SSO UI, unused by the platform | **No fix** (do not claim Sentry SSO) |
| **grafana** | OIDC auto-login, role-mapped | Works | Reference good path (public auth URL + internal backchannel) | **No fix** |
| **clickhouse** | Interactive query UI | "Ok." | Clickthrough URL was the apex root `/clickhouse/` → ClickHouse HTTP root, which answers the bare health string "Ok."; the UI is at `/play` | **Fixed** — surface `/clickhouse/play` (not SSO) |
| **localstack** | Reachable only with the `cloud-mocks` profile (dev/staging); never a public prod link | Cloudflare "Bad Gateway" | `mock-only` + `forbiddenInProduction`, not deployed in prod, yet the clickthrough rendered an apex "Open" link → 502 | **Fixed** — lock the link (no URL) in production |
| **sonarqube** | Native managed auth behind forward-auth (ADR-0030); default admin rotated to the managed password. (OIDC plugin not bundled — ADR-ACT-0290; native auth is the path, so this rotation is the PRIMARY credential control, not a fallback) | "default administrator credentials still used"; live: `admin:admin` validated `true` | **Code defect**: `provision-token.sh` `exit 0` (§3) ran *before* the password rotation (§4b); once the token was minted the rotation never ran → `admin:admin` persisted | **Fixed** — reorder (rotation always runs) + `make sonar-provision` |
| **pgadmin** | OIDC code exchange completes; user auto-created; lands in pgAdmin app | `Missing "jwks_uri" in metadata`; then (after that fix) `not authorized ... additional claim required {}` | THREE defects (below): no discovery URL; discovery advertised the **public** jwks (container 403 via Cloudflare); `OAUTH2_ADDITIONAL_CLAIMS: {}` denied every user | **Fixed** — discovery URL + KC backchannel-dynamic + `OAUTH2_ADDITIONAL_CLAIMS: None` |
| **minio** | "Login with SSO" completes; console session established | `{"code":"UNAUTHENTICATED","message":"No session"}` | TWO defects: code exchange hit the **public** KC token endpoint (container 403); and the KC `minio` client **mandated PKCE S256** but the console sends no `code_challenge` (KC: "Missing parameter: code_challenge_method") | **Fixed** — KC backchannel-dynamic + drop the PKCE mandate on the `minio` client |

## 2. The unifying root cause (pgAdmin jwks + MinIO "No session")

Keycloak runs with `KC_HOSTNAME_STRICT=true` and a deprecated v1 `KC_HOSTNAME_STRICT_BACKCHANNEL`
that KC 26 hostname-v2 ignores. So the OIDC **discovery document advertised the PUBLIC URLs for
the backchannel endpoints** (token, jwks_uri, userinfo). Composed services that derive their
endpoints from discovery over the Docker-internal hostname (MinIO `…CONFIG_URL`; pgAdmin's new
`OAUTH2_SERVER_METADATA_URL`) then tried to reach `https://aldous.info/kc/...` from inside the
container — which Cloudflare answers with **HTTP 403** (confirmed: public certs → 403, internal
certs → 200). That broke pgAdmin's jwks fetch and MinIO's code exchange.

Fix: `KC_HOSTNAME_BACKCHANNEL_DYNAMIC: "true"` (KC 26 hostname-v2). The frontend URLs (issuer,
authorization_endpoint) stay pinned to `KC_HOSTNAME` (public — browser redirect + token `iss`
unchanged), but the backchannel endpoints resolve from the request host, so a container fetching
discovery over `http://keycloak:8080` gets **container-reachable** token/jwks/userinfo URLs.
Verified post-change (discovery over the internal host):

```text
issuer            : https://aldous.info/kc/realms/platform-production   (public ✓)
authorization_ep  : https://aldous.info/kc/.../auth                      (public ✓ browser)
token_ep          : http://keycloak:8080/kc/.../token                   (internal ✓ reachable)
jwks_uri          : http://keycloak:8080/kc/.../certs                   (internal ✓ reachable)
userinfo_ep       : http://keycloak:8080/kc/.../userinfo                (internal ✓ reachable)
```

Grafana (explicit internal endpoints, no jwks) and the BFF (hardcoded internal endpoints) are
unaffected; the real-auth login suite still passes (no regression — see §4).

## 3. Fixes applied (in-repo)

- **Keycloak** — `compose.yaml`: replaced the deprecated `KC_HOSTNAME_STRICT_BACKCHANNEL=false`
  with `KC_HOSTNAME_BACKCHANNEL_DYNAMIC: "true"` (the §2 fix).
- **MinIO** — `infra/modules/keycloak/main.tf`: removed `pkce_code_challenge_method = "S256"` from
  the `minio` client. The MinIO console (RELEASE.2024-12-18) sends no `code_challenge`, so a client
  that mandates PKCE rejects the login. The redirect-URI allowlist + forward-auth gate remain the
  controls for this public client. (pgAdmin instead uses a confidential client.)
- **pgAdmin** — `docker/pgadmin/config_local.py`: (a) added `OAUTH2_SERVER_METADATA_URL` (internal
  discovery) so authlib obtains `jwks_uri`; (b) set `OAUTH2_ADDITIONAL_CLAIMS: None` (was `{}`,
  which made pgAdmin enforce an empty claim match and deny every user). Explicit public-auth +
  internal-token/userinfo URLs still take precedence (split-horizon).
- **ClickHouse** — `apps/platform-api/src/usecases/service-clickthrough.ts` gains optional
  `landingPath`; ClickHouse sets `/clickhouse/play`. The BFF URL uses it (`clickthroughUrlFor` in
  `clickthrough-services.ts`). `apexPath` (`/clickhouse/*`) unchanged (Caddy reconciliation intact).
- **LocalStack** — same module gains optional `devOnly: true`; `clickthroughUrlFor` returns `null`
  for a `devOnly` service in production, so the page shows "locked" instead of a dead 502 link.
- **Keycloak Terraform comment** — corrected the stale `enable_composed_sso` default (`true`).
- **SonarQube** — `scripts/sonar/provision-token.sh`: moved the token-validity early-exit (§3) to
  run AFTER the admin-password rotation (now §4c) so the managed password is ensured on every run.

## 4. Live verification (2026-06-16, react-prod via `https://aldous.info`)

Real-auth Playwright as `sysadmin@aldous.info`, plus direct probes. All green:

- **Main app auth — no regression**: `e2e/external/login.spec.ts` 7/7 pass after the KC change
  (themed login, real KC login, HTTP-only cookie, no tokens in `/api/session`, role landing).
- **Tool clickthroughs**: `e2e/external/tool-services.spec.ts` 18/18 pass — all routes deny
  unauthenticated (401 JSON); after sysadmin login Keycloak/Mailpit/MinIO/ClickHouse/SonarQube/
  Sentry/pgAdmin all load (not 4xx/5xx, not the SPA). **ClickHouse `/clickhouse/play` asserts the
  body is NOT the bare "Ok."** — passes.
- **pgAdmin SSO callback (end-to-end)**: clicking "Sign in with platform account" → KC → callback;
  **no jwks error**, and after the `ADDITIONAL_CLAIMS: None` fix the authenticated app loads at
  `https://aldous.info/pgadmin/browser/` (title "pgAdmin 4"), no "not authorized" in the server log.
- **MinIO SSO callback (end-to-end)**: "Login with SSO" → KC → callback; **no PKCE error**, lands on
  `https://aldous.info/minio/browser`, `/minio/api/v1/session` returns **200** (authenticated).
- **SonarQube (shared instance, `localhost:9064`)**: after the fix + `make sonar-provision`,
  `admin:admin` → `{"valid":false}`, managed password → `{"valid":true}`,
  `oidc.enabled=true`, `oidc.autoLogin=true`, issuer = prod realm, `system-admin` group =
  `admin/gateadmin/profileadmin/provisioning/scan`.
- **Static/unit**: `tsc:check`, `service-clickthrough.test.ts` (24/24), format, lint, architecture
  `--strict`, `compose:config:all`, `make infra-check` (terraform fmt + validate) all pass.

## 5. Operational notes

- The KC `minio`-client PKCE change was applied live via `kcadm` (immediate) **and** in the
  Terraform source (`main.tf`) so `make keycloak-provision` / `make all` reconcile to the same
  value. The KC `KC_HOSTNAME_BACKCHANNEL_DYNAMIC` + pgAdmin config + MinIO client changes are
  picked up by recreating the `keycloak` / `pgadmin` / `minio` containers (done this session).
- `react-app`'s `/version` reports `commit: "unknown"` (`GIT_SHA` unset); setting `GIT_SHA` at
  build/deploy would make the live commit verifiable.

## 6. Remaining intentional non-SSO services

Mailpit, ClickHouse, LocalStack, WireMock, Tilt have no SSO. **Sentry** self-hosted SSO is a paid
feature and is deliberately **not wired** — native sign-in is the expected behaviour.

## 7. Linkage

ADR-0030 · ADR-0073 · ADR-ACT-0233 · ADR-ACT-0275 · ADR-ACT-0282. Phase 5.5 / ADR-ACT-0285
(self-hosted Sentry-API event assertion) is **not affected** by this work — that is the error-
monitoring assertion harness, separate from clickthrough/SSO.
