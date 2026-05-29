# Real Keycloak Login E2E — Local Setup

This guide explains how to run the real browser login E2E tests against
`http://aldous.info` locally. These tests exercise the full auth flow:

```text
browser → React login page → Caddy → /auth/login → Keycloak realm
       → PKCE callback → platform-api session → Redis → HTTP-only cookie
       → React landing page
```

No `LOCAL_FIXTURE_SESSION` is used — every test performs a real login.

---

## Prerequisites

### 1. /etc/hosts entry

Add `aldous.info` to your local DNS so it resolves to `127.0.0.1` (Caddy on port 80):

```sh
echo "127.0.0.1 aldous.info" | sudo tee -a /etc/hosts
```

Verify:

```sh
curl -s http://aldous.info/healthz
# Expected: {"status":"ok"}
```

### 2. Start all required services

```sh
npm ci
make compose-up-default       # core services (Postgres, Redis, ClickHouse, MinIO, Mailpit, OTel)
make compose-up-identity      # Keycloak (binds port from $KEYCLOAK_PORT, default 8090)
```

> **Note:** If `make compose-up-identity` fails with "address already in use",
> set `KEYCLOAK_PORT=8090` (or another free port) in `.env`.

### 3. Provision Keycloak

```sh
make keycloak-provision
# Runs: cd infra/env/local && terraform apply -var-file=local.tfvars
```

This creates the `platform` realm with all fixture users including `sysadmin@aldous.info`.

If you don't have `local.tfvars`, copy the example and fill in the password:

```sh
cp infra/env/local/local.tfvars.example infra/env/local/local.tfvars
# Set fixture_user_password = "password" (or a value of your choice)
```

### 4. Start the web profile with aldous.info URLs

The auth callback URL and post-login redirect must use `http://aldous.info`:

```sh
PLATFORM_API_URL=http://aldous.info \
APP_BASE_URL=http://aldous.info \
make compose-up-web
```

This starts Caddy (port 80) + platform-api. Caddy serves `aldous.info` and
proxies `/auth/*` and `/api/*` to platform-api.

Verify the full stack:

```sh
make compose-ps
curl -s http://aldous.info/healthz       # {"status":"ok"}
curl -s http://aldous.info/readyz        # {"status":"ready",...}
curl -s http://aldous.info/api/session   # {"code":"UNAUTHENTICATED",...} (401)
```

### 5. Set test credentials

The default sysadmin fixture user uses the password from `local.tfvars`:

```sh
export KEYCLOAK_TEST_USERNAME=sysadmin@aldous.info
export KEYCLOAK_TEST_PASSWORD=password  # or whatever you set in local.tfvars
```

---

## Running the tests

```sh
npx playwright test --config playwright.real-auth.config.ts
```

Or with explicit env:

```sh
KEYCLOAK_TEST_USERNAME=sysadmin@aldous.info \
KEYCLOAK_TEST_PASSWORD=password \
npx playwright test --config playwright.real-auth.config.ts
```

View results:

```sh
npx playwright show-report playwright-report/real-auth
```

---

## Fixture users

| Email                  | Realm role     | Purpose                                              |
| ---------------------- | -------------- | ---------------------------------------------------- |
| `sysadmin@aldous.info` | `system-admin` | Real-auth E2E login; access to all Caddy tool routes |
| `admin@fixture.local`  | `tenant-admin` | Existing fixture; not used for real-auth E2E         |
| `viewer@fixture.local` | `viewer`       | Existing fixture                                     |

Password for all: value of `fixture_user_password` in `local.tfvars` (default: `password`).

---

## Test coverage

| Test file                      | What it covers                                                      |
| ------------------------------ | ------------------------------------------------------------------- |
| `aldous-login.spec.ts`         | Login flow, session, cookie, landing page, tool links               |
| `aldous-logout.spec.ts`        | Logout, session invalidation                                        |
| `aldous-caddy-links.spec.ts`   | Protected routes: unauthenticated denial + system-admin access      |
| `aldous-auth-negative.spec.ts` | Wrong password; deferred auth models (skipped with ACTION-REGISTER) |

---

## Deferred auth models

The following auth flows are not yet provisioned and have ACTION-REGISTER items:

| Model            | Action       |
| ---------------- | ------------ |
| OIDC broker      | ADR-ACT-0157 |
| SAML broker      | ADR-ACT-0157 |
| MFA-required     | ADR-ACT-0158 |
| Disabled user    | ADR-ACT-0159 |
| Unverified email | ADR-ACT-0159 |
| Expired session  | ADR-ACT-0160 |

---

## Keycloak theme

The Keycloak login page uses the default Keycloak theme in local dev.
The platform login _entry_ page (`/auth/login`) is themed with platform branding (Option B).
Full Keycloak theme customisation is tracked in ADR-ACT-0156.
