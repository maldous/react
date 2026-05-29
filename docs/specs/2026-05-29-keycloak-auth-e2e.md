# Keycloak Auth + E2E Login Tests — Design Spec

**Date:** 2026-05-29
**Status:** Approved
**ADRs:** ADR-0021 (identity model), ADR-0022 (auth boundary), ADR-0025 (E2E strategy)

---

## Goal

Wire the existing Keycloak auth implementation into a fully testable end-to-end login flow supporting five roles (system-admin, tenant-admin, manager, viewer, no-membership), with Playwright E2E tests that run automatically in development and manually by a human on aldous.info production. Tiltfile provides real-time feedback during development.

---

## Architecture overview

```
Dev:        Playwright → Vite:5173 → (proxy /auth/*, /api/*) → platform-api:3001
                                    ↘ redirect to Keycloak:8090/realms/platform
                                    ↙ callback via Vite proxy → session cookie on :5173

Production: Browser → Cloudflare → Caddy:80
                                  /kc/*  → keycloak:8080  (KC_HTTP_RELATIVE_PATH=/kc)
                                  /api/* → platform-api:3001
                                  /auth/* → platform-api:3001
                                  /* → React SPA
```

The BFF auth flow (PKCE) is already implemented in `apps/platform-api/src/server/auth.ts`. The missing pieces are: login page UI, Vite `/auth` proxy, Caddy `/kc` proxy, Keycloak compose path config, Terraform completions, Tiltfile provisioning, and E2E test suites.

---

## 1. Login page UI

**File:** `apps/react-enterprise-app/src/routes/auth/login.tsx`

Replace the placeholder heading with a real "Sign in" button. The button navigates the browser to `/auth/login` (proxied by Vite to platform-api), which generates the PKCE challenge, sets the pre-auth cookie, and redirects to Keycloak.

```tsx
function LoginPage() {
  const t = useTranslation();
  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <div className="max-w-md w-full text-center space-y-6">
        <h1 className="text-2xl font-semibold text-gray-900">{t("auth.login.title")}</h1>
        <p className="text-gray-500">{t("auth.login.body")}</p>
        <a
          href="/auth/login"
          className="block w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          {t("auth.login.signInButton")}
        </a>
      </div>
    </div>
  );
}
```

**i18n keys to add** (`packages/i18n-runtime/locales/en-GB.json`):
- `auth.login.signInButton` → `"Sign in with your account"`
- `auth.login.body` → `"Use your aldous.info account to continue."` (replaces placeholder)

The button is an `<a href>` not a `<button>` because it triggers a full-page navigation (required for the OAuth redirect chain). No React state needed.

---

## 2. Vite proxy — add `/auth`

**File:** `apps/react-enterprise-app/vite.config.ts`

Add `/auth` and `/kc` to the proxy config alongside existing `/api`, `/healthz`, etc.:

```ts
"/auth": {
  target: `http://localhost:${process.env["PLATFORM_API_PORT"] ?? 3001}`,
  changeOrigin: true,
},
```

**Why this matters for cookies:** The OAuth callback URL registered in Keycloak must be `http://localhost:5173/auth/callback` (not `localhost:3001/auth/callback`). When the browser follows the Keycloak redirect to `http://localhost:5173/auth/callback`, Vite proxies it to `localhost:3001/auth/callback`. The `Set-Cookie: platform_session=...` response header is seen by the browser as coming from `localhost:5173`, so the session cookie is set for `localhost:5173`. Subsequent `/api/*` requests from the React app carry this cookie correctly.

`preview.proxy` must also include `/auth` for the prod-build E2E suite.

---

## 3. Compose — Keycloak path prefix

**File:** `compose.yaml`, `keycloak` service

Add one environment variable, controlled by `.env`:

```yaml
KC_HTTP_RELATIVE_PATH: ${KC_HTTP_RELATIVE_PATH:-}
```

**`.env.example`** — add:
```
# Keycloak root context path. Empty for local dev (direct port access).
# Set to /kc for production (path-prefixed behind Caddy).
KC_HTTP_RELATIVE_PATH=
```

Production `.env` on the aldous.info host sets `KC_HTTP_RELATIVE_PATH=/kc`.

**Healthcheck** — the current healthcheck targets `http://localhost:8080/health/ready`. When `KC_HTTP_RELATIVE_PATH=/kc` is set, the health endpoint moves to `http://localhost:8080/kc/health/ready`. Update the healthcheck to use the env var:

```yaml
healthcheck:
  test: ["CMD-SHELL", "curl -f http://localhost:8080${KC_HTTP_RELATIVE_PATH:-}/health/ready || exit 1"]
```

---

## 4. Caddy — Keycloak reverse proxy

**File:** `docker/caddy/Caddyfile`

Add before the SPA catch-all:

```caddy
handle /kc/* {
  reverse_proxy keycloak:8080
}
```

This proxies all Keycloak traffic (admin console, OIDC endpoints, token endpoint) through Caddy. Only used in production (the `web` profile). Local dev accesses Keycloak directly on `KEYCLOAK_PORT`.

---

## 5. Terraform

### 5a. Keycloak module — new fixture users

**File:** `infra/modules/keycloak/main.tf`

Add `sysadmin` and `manager` fixture users alongside the existing three. Rename all fixture user emails from `@fixture.local` to `@aldous.info`.

New fixture users (all gated by `provision_fixture_users`):

| Resource | Email | Role |
|---|---|---|
| `keycloak_user.sysadmin` | `sysadmin@aldous.info` | `system-admin` |
| `keycloak_user.manager` | `manager@aldous.info` | `manager` |

Existing users renamed:
- `admin@fixture.local` → `admin@aldous.info`
- `viewer@fixture.local` → `viewer@aldous.info`
- `forbidden@fixture.local` → `forbidden@aldous.info`

Also update `keycloak_user_roles` resources to assign the new users their roles.

### 5b. Local env — updated redirect URIs

**File:** `infra/env/local/main.tf`

Change `bff_redirect_uris` to route the callback through the Vite proxy:

```hcl
bff_redirect_uris = [
  "http://localhost:5173/auth/callback",
  "http://localhost:5173/*",
]
```

Update `local.tfvars.example` to reflect that `PLATFORM_API_URL` should be `http://localhost:5173` for dev auth E2E (so platform-api constructs the correct `redirect_uri` for code exchange).

### 5c. Production env

**File:** `infra/env/production/main.tf` — replace scaffold:

```hcl
module "keycloak" {
  source = "../../modules/keycloak"

  keycloak_url       = "https://aldous.info/kc"
  realm_name         = "platform"
  realm_display_name = "Enterprise Platform"

  spa_client_id     = "platform-spa"
  spa_redirect_uris = ["https://aldous.info/*"]
  spa_web_origins   = ["https://aldous.info"]

  bff_client_id     = "platform-api"
  bff_client_secret = var.bff_client_secret
  bff_redirect_uris = ["https://aldous.info/auth/callback"]

  provision_fixture_users = false
}
```

**File:** `infra/env/production/production.tfvars.example` — document required variables:
```
keycloak_url            = "https://aldous.info/kc"
keycloak_admin_user     = "admin"
keycloak_admin_password = "<aldous.info host env — never commit>"
bff_client_secret       = "<strong random secret — never commit>"
```

---

## 6. Database seed — update fixture emails

**File:** `apps/platform-api/src/db/seed.ts`

Update `FIXTURE` constants and SQL to use `@aldous.info` emails. Add `sysadmin` and `manager` users with appropriate memberships:

```ts
export const FIXTURE = {
  ORG_ID:        "00000000-0000-0000-0000-000000000001",
  ORG_SLUG:      "fixture-org",
  ADMIN_ID:      "00000000-0000-0000-0000-000000000002",
  VIEWER_ID:     "00000000-0000-0000-0000-000000000003",
  FORBIDDEN_ID:  "00000000-0000-0000-0000-000000000004",
  SYSADMIN_ID:   "00000000-0000-0000-0000-000000000005",
  MANAGER_ID:    "00000000-0000-0000-0000-000000000006",
} as const;
```

Users:
```sql
INSERT INTO users (id, email, display_name) VALUES
  ($1, 'admin@aldous.info',     'Fixture Admin'),
  ($2, 'viewer@aldous.info',    'Fixture Viewer'),
  ($3, 'forbidden@aldous.info', 'Fixture Forbidden'),
  ($4, 'sysadmin@aldous.info',  'Fixture SysAdmin'),
  ($5, 'manager@aldous.info',   'Fixture Manager')
ON CONFLICT (id) DO NOTHING
```

Memberships:
```sql
INSERT INTO memberships (user_id, organisation_id, role) VALUES
  ($1, $org, 'tenant-admin'),
  ($2, $org, 'viewer'),
  ($3, $org, 'manager')
ON CONFLICT (user_id, organisation_id) DO NOTHING
-- sysadmin@aldous.info: no membership (system-admin is a realm role, not org-scoped)
-- forbidden@aldous.info: no membership (tests the no-access case)
```

The existing fixture session actors in `session.ts` also reference these emails — update to match.

---

## 7. Tiltfile

**File:** `Tiltfile`

Add two resources after `identity-profile`:

```python
local_resource(
  'keycloak-provision',
  cmd='cd infra/env/local && terraform init -input=false -upgrade && terraform apply -auto-approve -var-file=local.tfvars',
  resource_deps=['identity-profile'],
  labels=['auth'],
  trigger_mode=TRIGGER_MODE_MANUAL,
  deps=[
    'infra/modules/keycloak',
    'infra/env/local/main.tf',
  ],
)

local_resource(
  'keycloak-ui',
  cmd='echo "Keycloak ready"',
  resource_deps=['keycloak-provision'],
  labels=['auth'],
  links=[
    link('http://localhost:{}/kc/admin'.format(os.environ.get('KEYCLOAK_PORT', '8080')), 'Keycloak admin'),
    link('http://localhost:{}/kc/realms/platform/.well-known/openid-configuration'.format(os.environ.get('KEYCLOAK_PORT', '8080')), 'OIDC discovery'),
  ],
)
```

`keycloak-provision` is `TRIGGER_MODE_MANUAL` — you trigger it once after starting the identity profile. Tilt re-runs it automatically when Terraform files change (e.g. adding a fixture user).

Add a `make` target:
```makefile
keycloak-provision:
	cd infra/env/local && terraform init -input=false && terraform apply -auto-approve -var-file=local.tfvars
```

---

## 8. E2E test strategy

### Three Playwright configs

| Config | Tests | Auth | Trigger |
|---|---|---|---|
| `playwright.config.ts` | `e2e/substrate/` | `LOCAL_FIXTURE_SESSION` | `npm run test:e2e` (always) |
| `playwright.auth.config.ts` | `e2e/auth/` | real Keycloak UI login | `npm run test:e2e:auth` (when Keycloak running) |
| `playwright.aldous.config.ts` | `e2e/aldous/` | real Keycloak UI login | `npx playwright test --config playwright.aldous.config.ts` |

### `playwright.auth.config.ts` (new)

```ts
export default defineConfig({
  testDir: './e2e/auth',
  globalSetup: './e2e/auth/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      // platform-api WITHOUT fixture session
      command: `node --loader ./apps/platform-api/loader.mjs ./apps/platform-api/src/server/http.ts`,
      url: `http://localhost:3001/healthz`,
      timeout: 20000,
      reuseExistingServer: true,
      env: { PLATFORM_API_URL: 'http://localhost:5173' },  // redirect_uri via Vite proxy
    },
    {
      command: `cd apps/react-enterprise-app && npx vite --port 5173`,
      url: 'http://localhost:5173',
      timeout: 30000,
      reuseExistingServer: true,
    },
  ],
});
```

### `e2e/auth/` structure

```
e2e/auth/
  global-setup.ts         ← logs in as each role once, saves .auth/<role>.json
  login-ui.spec.ts        ← validates login button, redirect chain, HTTP-only cookie
  role-sysadmin.spec.ts   ← global admin access (all orgs visible)
  role-admin.spec.ts      ← tenant-admin: read + write org profile
  role-manager.spec.ts    ← manager: read org profile, no update
  role-viewer.spec.ts     ← viewer: read-only, no edit form
  role-forbidden.spec.ts  ← no-membership: redirected to /auth/login
```

### `global-setup.ts`

Authenticates each fixture user once via the Keycloak login form, saves Playwright storage state (browser cookies) to `.auth/<role>.json`. All role-specific tests load the saved state — no repeated browser login.

```ts
const FIXTURES = [
  { role: 'admin',     email: 'admin@aldous.info',     path: '.auth/admin.json' },
  { role: 'viewer',    email: 'viewer@aldous.info',    path: '.auth/viewer.json' },
  { role: 'manager',   email: 'manager@aldous.info',   path: '.auth/manager.json' },
  { role: 'sysadmin',  email: 'sysadmin@aldous.info',  path: '.auth/sysadmin.json' },
  { role: 'forbidden', email: 'forbidden@aldous.info', path: '.auth/forbidden.json' },
];

for (const fixture of FIXTURES) {
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/auth/login');
  await page.click('a[href="/auth/login"]');           // Sign in button
  // Keycloak login form (on localhost:KEYCLOAK_PORT)
  await page.fill('#username', fixture.email);
  await page.fill('#password', process.env.FIXTURE_USER_PASSWORD ?? 'password');
  await page.click('[type=submit]');
  // Wait for redirect back to React app
  await page.waitForURL('http://localhost:5173/**');
  await page.context().storageState({ path: fixture.path });
  await page.close();
}
```

### `login-ui.spec.ts`

Tests the login button and full redirect chain:
- Page at `/auth/login` renders a "Sign in" button
- Clicking it redirects to Keycloak login form (different origin)
- After login, browser is at `http://localhost:5173` with a session
- `document.cookie` does not contain `platform_session` (HTTP-only verified)
- `GET /api/session` returns 200 with a valid actor

### Role spec pattern

Each role spec loads its storage state and asserts correct access:

```ts
test.use({ storageState: '.auth/admin.json' });

test('tenant-admin can view and edit org profile', async ({ page }) => {
  await page.goto('/organisation/profile');
  await expect(page.getByTestId('organisation-profile')).toBeVisible();
  await expect(page.getByTestId('profile-edit-form')).toBeVisible();
});
```

`role-forbidden.spec.ts` uses `.auth/forbidden.json` and asserts redirect to `/auth/login`.

### `e2e/aldous/auth.test.ts` (new)

Human-runnable real auth test on production. Reads credentials from env:

```ts
const ADMIN_EMAIL    = process.env['E2E_ADMIN_EMAIL']    ?? '';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'] ?? '';

test.skip(!ADMIN_EMAIL, 'Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD to run auth tests');

test('admin can log in and reach org profile on aldous.info', async ({ page }) => {
  await page.goto('/auth/login');
  await page.click('a[href="/auth/login"]');
  await page.fill('#username', ADMIN_EMAIL);
  await page.fill('#password', ADMIN_PASSWORD);
  await page.click('[type=submit]');
  await page.waitForURL('https://aldous.info/**');
  await page.goto('/organisation/profile');
  await expect(page.getByTestId('organisation-profile')).toBeVisible();
});
```

---

## 9. npm scripts and make targets

**`package.json`** — add:
```json
"test:e2e:auth": "playwright test --config playwright.auth.config.ts"
```

**`Makefile`** — add:
```makefile
keycloak-provision:
	cd infra/env/local && terraform init -input=false && terraform apply -auto-approve -var-file=local.tfvars
```

---

## 10. `.gitignore` additions

```
.auth/           # Playwright storage state — contains session cookies
infra/env/local/local.tfvars
infra/env/production/production.tfvars
infra/env/**/.terraform/
infra/env/**/terraform.tfstate*
```

---

## Completion criteria

A change is complete when:

- [ ] Login page renders "Sign in" button that initiates Keycloak PKCE flow
- [ ] Vite proxies `/auth/*` correctly — session cookie set for `localhost:5173` origin
- [ ] `terraform apply` in `infra/env/local` provisions realm, 5 roles, 5 fixture users
- [ ] `infra/env/production/main.tf` complete and `terraform validate` passes
- [ ] Tiltfile `keycloak-provision` resource runs without error when triggered
- [ ] `npm run test:e2e:auth` passes all 6 spec files with real Keycloak
- [ ] `make check` gates all pass
- [ ] `npm run test:e2e` (fixture-session substrate suite) still passes unchanged
- [ ] Aldous smoke suite (`playwright.aldous.config.ts`) still passes
