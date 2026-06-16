# Admin clickthrough / composed-service SSO — diagnosis + fixes

Source ADRs: ADR-0030 (admin-tool forward-auth), ADR-0073 (composed-service SSO),
ADR-ACT-0233 (clickthrough policy), ADR-ACT-0275 (SSO rollout), ADR-ACT-0282 (shared
service bridges). Date: 2026-06-16.

Scope: the `/admin/clickthrough` surface and the per-service SSO state after the ADR-0073
SSO changes. The browser observations below were taken against the Cloudflare-fronted
(`web`/prod) stack. This sandbox runs the `dev` Compose project only (no Caddy container,
no provisioned `platform` Keycloak realm — only `master` exists, and SonarQube / Sentry /
LocalStack are not running here), so live browser re-verification of the SSO flows is not
possible in-sandbox; it is called out per service below.

## 1. Diagnosis table

| Service | Expected | Observed | Likely root cause | Decision |
| --- | --- | --- | --- | --- |
| **keycloak** | KC admin console prompts for KC's own admin auth (it IS the IdP; a platform session never grants realm admin) | Keycloak login prompt | Correct behaviour (ADR-ACT-0233 isolation invariant) | **No fix** |
| **mailpit** | No SSO; shared dev inbox opens directly behind forward-auth | Opens, no auth | Correct (no SSO support) | **No fix** |
| **sentry** | Self-hosted Sentry SSO is a paid/business feature — **not wired**; native sign-in is the documented path | Native sign-in; "Single Sign-On" asks for Organization ID | Sentry's built-in SSO UI, which the platform does not use; matrix records "Not wired" | **No fix** (do not claim Sentry SSO) |
| **grafana** | OIDC auto-login, role-mapped | Works | Reference good path (public auth URL + internal backchannel; `ROOT_URL` from `APP_BASE_URL`) | **No fix** |
| **pgadmin** | OIDC code exchange completes; user auto-created | `{"success":0,"errormsg":"Missing \"jwks_uri\" in metadata"}` | authlib (pgAdmin's OAuth2 backend) validates the ID-token signature and needs `jwks_uri`; `config_local.py` set token/auth/userinfo endpoints but **no discovery URL**, so authlib had no `jwks_uri` | **Fix** — add `OAUTH2_SERVER_METADATA_URL` (OIDC discovery) |
| **clickhouse** | Interactive query UI | "Ok." | The clickthrough URL was the apex root `/clickhouse/` → ClickHouse HTTP root, which answers the bare health string "Ok."; the UI is at `/play` | **Fix** — surface `/clickhouse/play` (not SSO; ClickHouse has none) |
| **localstack** | Only reachable when the `cloud-mocks` profile is up (dev/staging); never a public prod link | Cloudflare "Bad Gateway" | LocalStack is `mock-only` + `forbiddenInProduction` (service-catalog) and not deployed in prod, but the clickthrough still rendered an apex "Open" link → 502 | **Fix** — lock the link (no URL) in production |
| **sonarqube** | OIDC auto-login (`autoLogin`); default admin rotated to the managed password | "default administrator credentials still used — change password" prompt; live: `admin:admin` validated `true` even though OIDC was already enabled | **Code defect** in `provision-token.sh`: the token-validity check did `exit 0` (§3) *before* the admin-password rotation (§4b), so once the analysis token was minted (the steady state) the password was NEVER rotated → `admin:admin` persisted | **Fix** — reorder so rotation runs every invocation + run `make sonar-provision` (**verified live**) |

## 2. Fixes applied (in-repo)

- **pgAdmin** — `docker/pgadmin/config_local.py`: added
  `OAUTH2_SERVER_METADATA_URL` = `{_kc_internal}/realms/{_realm}/.well-known/openid-configuration`.
  authlib now discovers `jwks_uri` (and `issuer`) and can validate the ID token. The explicit
  `OAUTH2_AUTHORIZATION_URL` (public, browser) and `OAUTH2_TOKEN_URL` / `OAUTH2_USERINFO_ENDPOINT`
  (internal, backchannel) still take precedence — only the missing `jwks_uri`/`issuer` come from
  discovery, preserving the split-horizon design. Discovery is fetched on the internal KC URL so
  the container can always reach it; `KC_HOSTNAME_STRICT` pins the issuer to the public URL so it
  matches the browser-minted token.
- **ClickHouse** — `apps/platform-api/src/usecases/service-clickthrough.ts` gains an optional
  `landingPath`; ClickHouse sets `/clickhouse/play`. The BFF clickthrough URL now uses it
  (`clickthroughUrlFor` in `clickthrough-services.ts`). The `apexPath` (`/clickhouse/*`) is
  unchanged — the Caddy route + forward-auth reconciliation test still governs it.
- **LocalStack** — same module gains an optional `devOnly`; LocalStack sets it `true`.
  `clickthroughUrlFor` returns `null` for a `devOnly` service in a production environment
  (`PLATFORM_ENV`), so the page shows "locked" instead of a dead 502 link. Dev/staging still link it.
- **Keycloak Terraform** — `infra/modules/keycloak/main.tf`: corrected a stale comment that said
  `enable_composed_sso` defaults `false`; it defaults `true` (matches `variables.tf` and ADR-0073).
- **SonarQube** — `scripts/sonar/provision-token.sh`: moved the token-validity early-exit (§3) to
  run AFTER the admin-password rotation (§4b → new §4c). The early `exit 0` on a valid token meant
  the rotation never ran in the steady state, leaving `admin:admin` active indefinitely. Now the
  managed password is ensured on every invocation; only token *generation* is skipped when the
  token is already valid. Then ran `make sonar-provision` against the shared instance.

## 3. No-change-but-documented

- **Sentry** — SSO intentionally **not wired** (paid feature on self-hosted). Native admin login is
  the expected behaviour; the "Organization ID" prompt is Sentry's own unused SSO UI.

## 4. Verification run (this session, in-sandbox)

- `npm run tsc:check` — pass (full API + packages + app).
- `node --test apps/platform-api/tests/unit/service-clickthrough.test.ts` — 24/24 pass
  (incl. new `clickthroughUrlFor` + pgAdmin-config static guards).
- `npm run format:check`, `npm run lint`, architecture orchestrator (`--strict`) — pass.
- `npm run compose:config` + `npm run compose:config:all` — valid (default + all profiles).
- `make infra-check` — terraform fmt clean; `infra/env/dev` init + validate ok.
- `python3 -m ast` parse of `config_local.py` — ok.
- `make check` — passes every gate **except** the pre-existing `npm audit` advisories
  (markdown-it / tar / vite transitive deps); no dependency was touched by this work.

## 4b. Live verification run (2026-06-16, prod-adjacent — what this environment CAN reach)

This environment reaches the prod **edge** read-only (`https://aldous.info/healthz` → ok;
`/version` → `environment: production`, `commit: "unknown"` because `GIT_SHA` is unset there)
and the **shared SonarQube** at `http://localhost:9064/sonar` (the `react-sonar` instance,
prod-realm-bound). It has **no prod deploy tooling, no prod system-admin session, and no
container/host access**, so authenticated clickthrough flows cannot be driven from here:
every `/clickhouse|/localstack|/pgadmin|/minio|/sonar|/grafana|/kc|/sentry|/mailpit` route and
`/api/admin/clickthrough` return **HTTP 401** at forward-auth (expected; no session).

SonarQube (shared instance) — **fully verified after the fix**:

- Before: `admin:admin` → `{"valid":true}` (default still active) despite OIDC already enabled.
- Root cause: `provision-token.sh` early-exit ordering bug (above).
- After fix + `make sonar-provision`:
  - `admin:admin` → `{"valid":false}` (default rejected).
  - managed `SONAR_ADMIN_PASSWORD` → `{"valid":true}`.
  - `sonar.auth.oidc.enabled=true`, `sonar.auth.oidc.autoLogin=true`,
    `issuerUri=https://aldous.info/kc/realms/platform-production`.
  - `system-admin` group permissions = `admin, gateadmin, profileadmin, provisioning, scan`.

## 5. Live verification still required (operator-gated — needs prod deploy + a system-admin session)

Blocked here: no prod deploy/reload tooling in the repo, `commit: "unknown"` so the live commit
of `react-app`/Caddy/platform-api cannot be confirmed, and no prod system-admin credentials.
On a stack with the latest commit deployed + a system-admin session:

- **pgAdmin** — click through `/pgadmin/`; the Keycloak code exchange completes (no
  "Missing jwks_uri"); confirm the pgAdmin container can reach the discovered `jwks_uri`
  (public KC URL via the edge).
- **ClickHouse** — `/clickhouse/play` renders the query console.
- **LocalStack** — link is "locked" in prod; reachable in dev/staging with the `cloud-mocks`
  profile up.
- **SonarQube** — re-check `/sonar/` in a browser auto-logs-in via OIDC and the default-admin
  prompt is gone (the API-level state above is already confirmed).
- **MinIO** — see "Open question" below.

## 6. Open question — MinIO "No session"

MinIO console "Login with SSO" returned `{"code":"UNAUTHENTICATED","message":"No session"}`.
The in-repo config is statically correct: public PKCE `minio` client; redirect URIs registered
(`…/minio/oauth_callback`, plus `MINIO_IDENTITY_OPENID_REDIRECT_URI_DYNAMIC_ALL=on`);
`MINIO_BROWSER_REDIRECT_URL` is the public HTTPS base per env; the hardcoded `policy=consoleAdmin`
mapper authorises the SSO'd operator; `MINIO_IDENTITY_OPENID_CONFIG_URL` is the internal KC
discovery. No clearly-wrong value was found, so **no speculative change was made** (per the
"don't hack around" rule). Most likely live cause to check first: MinIO derives **all** OIDC
endpoints from the discovery document, and with `KC_HOSTNAME_STRICT=true` +
non-dynamic-backchannel, KC advertises the **public** token/jwks endpoints — so the MinIO
container must reach the public KC URL for the backchannel code exchange (the same constraint
pgAdmin's `jwks_uri` fetch now has). Live diagnosis: capture the `/minio/oauth_callback`
round-trip and the MinIO container's outbound token request; verify the `policy` claim is present
in the ID token and that the code-exchange to the (public) token endpoint succeeds from inside the
container. Tracked as the MinIO live-verification item.

## 7. Linkage

ADR-0030 · ADR-0073 · ADR-ACT-0233 · ADR-ACT-0275 · ADR-ACT-0282. Phase 5.5 / ADR-ACT-0285
(self-hosted Sentry-API event assertion) is **not affected** by this work — that is the error-
monitoring assertion harness, separate from clickthrough/SSO.
