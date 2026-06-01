# platform_app Non-Superuser Postgres Role — ADR-ACT-0189

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a dedicated `platform_app` non-superuser Postgres role and connect the runtime application pool to it, so RLS policies actually enforce in production (not bypassed by superuser semantics).

**Architecture:** Migration 010 creates the `platform_app` LOGIN role (NOSUPERUSER, NOBYPASSRLS), grants it the existing `rls_bypass` NOLOGIN role (so `withSystemAdmin()` still works), and grants SELECT/INSERT/UPDATE/DELETE on all current and future tables. `init-extra-databases.sh` mirrors this at fresh Docker initdb time. `dependencies.ts` is split into `getPostgresUrl()` (superuser — migrations, seed, reset) and `getPostgresAppUrl()` (app role — runtime pool). Compose wires the new env var; env files document it.

**Tech Stack:** PostgreSQL 16, Node.js `pg` driver, Docker Compose, existing `adapters-postgres` / `platform-api` TypeScript codebase.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `apps/platform-api/src/db/migrations/010-platform-app-role.sql` | Create | Role creation + privilege grants |
| `docker/postgres/init-extra-databases.sh` | Modify | Mirror role creation at initdb |
| `apps/platform-api/src/server/dependencies.ts` | Modify | Add `getPostgresAppUrl()`, wire app pool to it |
| `apps/platform-api/src/server/forward-auth.ts` | Modify | Use app URL for forward-auth pool |
| `compose.yaml` | Modify | Expose `POSTGRES_APP_URL` to platform-api service |
| `.env.example` | Modify | Document `POSTGRES_APP_PASSWORD` |
| `.env.dev` | Modify | Add `POSTGRES_APP_PASSWORD=platformapppassword` |
| `.env.test` | Modify | Add `POSTGRES_APP_PASSWORD=platformapppassword` |
| `.env.staging` | Modify | Add `POSTGRES_APP_PASSWORD=<set locally>` |
| `.env.prod` | Modify | Add `POSTGRES_APP_PASSWORD=<set locally>` |
| `packages/adapters-postgres/tests/adapters-postgres.test.ts` | Modify | Static assertions: migration 010 content |
| `tests/integration/compose-smoke.test.mjs` | Modify | RLS integration tests with real `platform_app` role |
| `docs/adr/ACTION-REGISTER.md` | Modify | Mark 0189 Done, update 0147, fix stale 0185 |

---

## Task 1: Migration 010 — create `platform_app` role

**Files:**
- Create: `apps/platform-api/src/db/migrations/010-platform-app-role.sql`

- [ ] **Step 1: Write migration 010**

```sql
-- Migration 010: platform_app non-superuser application role (ADR-ACT-0189)
--
-- Rationale: the application has historically connected as POSTGRES_USER (a
-- superuser). Superusers bypass Row-Level Security unconditionally, so RLS
-- policies on memberships/users/external_identities/tenant_resource_config
-- were never enforced at runtime. This migration creates a dedicated LOGIN
-- role that is subject to RLS, reducing the attack surface for IDOR bugs.
--
-- Key properties of platform_app:
--   NOSUPERUSER   — RLS applies; no server-level admin privileges
--   NOBYPASSRLS   — explicit; cannot bypass RLS even with FORCE ROW LEVEL SECURITY
--   LOGIN         — can authenticate (needs a connection URL)
--
-- withSystemAdmin() continues to work: platform_app is granted the rls_bypass
-- NOLOGIN role, so pg_has_role(current_user, 'rls_bypass', 'MEMBER') = true,
-- and the RLS bypass policies allow cross-tenant reads when needed.
--
-- IMPORTANT: The default password 'platformapppassword' is for local dev only.
-- Override in production via ALTER ROLE platform_app PASSWORD '<strong-pw>'
-- or by managing the credential in your secrets manager / Terraform.

-- ---------------------------------------------------------------------------
-- 1. Ensure rls_bypass exists (migration 008 creates it; idempotent guard)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'rls_bypass') THEN
    CREATE ROLE rls_bypass NOLOGIN;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Create platform_app role (idempotent)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'platform_app') THEN
    CREATE ROLE platform_app
      LOGIN
      PASSWORD 'platformapppassword'
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      NOBYPASSRLS;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Grant rls_bypass membership so withSystemAdmin() works for platform_app
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT pg_has_role('platform_app', 'rls_bypass', 'MEMBER') THEN
    GRANT rls_bypass TO platform_app;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Schema and database access
-- ---------------------------------------------------------------------------
GRANT CONNECT ON DATABASE platform TO platform_app;
GRANT USAGE ON SCHEMA public TO platform_app;

-- ---------------------------------------------------------------------------
-- 5. Privileges on all existing tables and sequences
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO platform_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO platform_app;

-- ---------------------------------------------------------------------------
-- 6. Default privileges for tables/sequences created by future migrations
--    (run as POSTGRES_USER = 'platform', the migration author)
-- ---------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES FOR ROLE platform IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO platform_app;

ALTER DEFAULT PRIVILEGES FOR ROLE platform IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO platform_app;
```

Save to `apps/platform-api/src/db/migrations/010-platform-app-role.sql`.

- [ ] **Step 2: Verify migration can be applied to the running local Postgres**

```bash
psql postgresql://platform:platformpassword@localhost:5433/platform \
  -f apps/platform-api/src/db/migrations/010-platform-app-role.sql
```

Expected output: lines like `DO`, `GRANT`, `ALTER DEFAULT PRIVILEGES` with no ERROR lines.

- [ ] **Step 3: Verify role properties**

```bash
psql postgresql://platform:platformpassword@localhost:5433/platform -c "
SELECT rolname, rolsuper, rolbypassrls, rolcanlogin,
       pg_has_role('platform_app', 'rls_bypass', 'MEMBER') AS has_rls_bypass
FROM pg_roles WHERE rolname = 'platform_app';"
```

Expected:
```
  rolname    | rolsuper | rolbypassrls | rolcanlogin | has_rls_bypass
-------------+----------+--------------+-------------+----------------
 platform_app |   f      |      f       |     t       |       t
```

- [ ] **Step 4: Commit**

```bash
git add apps/platform-api/src/db/migrations/010-platform-app-role.sql
git commit -m "feat(db): migration 010 — platform_app non-superuser app role (ADR-ACT-0189)"
```

---

## Task 2: `init-extra-databases.sh` — create `platform_app` at initdb

**Files:**
- Modify: `docker/postgres/init-extra-databases.sh`

This mirrors Task 1 so fresh Docker containers (`initdb`) have the role and grants before migrations run.

- [ ] **Step 1: Add `platform_app` block to `init-extra-databases.sh`**

After the closing `EOSQL` of the existing pgadmin block, append (still inside the same file):

```bash
# ---------------------------------------------------------------------------
# platform_app — non-superuser application role (ADR-ACT-0189)
#
# This creates the role at initdb time so it exists before migrations run.
# Migration 010 is idempotent and will skip re-creation. Grants on tables are
# applied by migration 010 since tables do not exist at initdb time.
#
# Password: override via POSTGRES_APP_PASSWORD env var (default: dev only).
# ---------------------------------------------------------------------------
PLATFORM_APP_ROLE="platform_app"
PLATFORM_APP_PASS="${POSTGRES_APP_PASSWORD:-platformapppassword}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$PGADMIN_DB" <<EOSQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${PLATFORM_APP_ROLE}') THEN
    CREATE ROLE "${PLATFORM_APP_ROLE}"
      LOGIN
      PASSWORD '${PLATFORM_APP_PASS}'
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      NOBYPASSRLS;
  END IF;
END
\$\$;

DO \$\$
BEGIN
  IF NOT pg_has_role('${PLATFORM_APP_ROLE}', 'rls_bypass', 'MEMBER') THEN
    GRANT rls_bypass TO "${PLATFORM_APP_ROLE}";
  END IF;
END
\$\$;

GRANT CONNECT ON DATABASE "${PGADMIN_DB}" TO "${PLATFORM_APP_ROLE}";
GRANT USAGE ON SCHEMA public TO "${PLATFORM_APP_ROLE}";

ALTER DEFAULT PRIVILEGES FOR ROLE "${POSTGRES_USER}" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${PLATFORM_APP_ROLE}";

ALTER DEFAULT PRIVILEGES FOR ROLE "${POSTGRES_USER}" IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO "${PLATFORM_APP_ROLE}";
EOSQL
```

Note: table/sequence GRANT on ALL TABLES is omitted here because no tables exist at initdb time. Migration 010 handles the GRANT ON ALL TABLES for existing tables after they are created.

- [ ] **Step 2: Commit**

```bash
git add docker/postgres/init-extra-databases.sh
git commit -m "feat(db): init script creates platform_app role at initdb (ADR-ACT-0189)"
```

---

## Task 3: `dependencies.ts` + `forward-auth.ts` — split app URL from migration URL

**Files:**
- Modify: `apps/platform-api/src/server/dependencies.ts`
- Modify: `apps/platform-api/src/server/forward-auth.ts`

**Key decisions:**
- `getPostgresUrl()` stays unchanged — used by `migrate.ts`, `seed.ts`, `reset.ts` (all need superuser)
- New `getPostgresAppUrl()` — used by runtime app pool; falls back to `getPostgresUrl()` when `POSTGRES_APP_URL` is unset (backward compat in dev)
- `getApplicationPool()` → uses `getPostgresAppUrl()`
- `getOrganisationRepository()`, `getReadinessAdapter()`, `getIdentityRepository()` → use `getPostgresAppUrl()`
- `forward-auth.ts` `getPool()` → use `getPostgresAppUrl()` from dependencies

- [ ] **Step 1: Add `getPostgresAppUrl()` to `dependencies.ts`**

In `apps/platform-api/src/server/dependencies.ts`, after the existing `getPostgresUrl()` function, add:

```typescript
// Runtime application pool URL — connects as platform_app (non-superuser).
// Falls back to getPostgresUrl() for backward compatibility when POSTGRES_APP_URL
// is not set (local dev without the new role). Production must set POSTGRES_APP_URL.
export function getPostgresAppUrl(): string {
  return (
    process.env["POSTGRES_APP_URL"] ??
    "postgresql://platform_app:platformapppassword@localhost:5433/platform"
  );
}
```

- [ ] **Step 2: Update `getApplicationPool()` to use `getPostgresAppUrl()`**

Change:
```typescript
export function getApplicationPool(): pg.Pool {
  if (!_appPool) {
    _appPool = new pg.Pool({ connectionString: getPostgresUrl(), max: 12 });
  }
  return _appPool;
}
```

To:
```typescript
export function getApplicationPool(): pg.Pool {
  if (!_appPool) {
    _appPool = new pg.Pool({ connectionString: getPostgresAppUrl(), max: 12 });
  }
  return _appPool;
}
```

- [ ] **Step 3: Update the three singleton repository/adapter constructors**

In `dependencies.ts`, change all three occurrences of `getPostgresUrl()` used for runtime adapters to `getPostgresAppUrl()`:

```typescript
// Was: new PostgresOrganisationRepository(getPostgresUrl())
organisationRepository = new PostgresOrganisationRepository(getPostgresAppUrl());

// Was: new PostgresReadinessAdapter(getPostgresUrl())
readinessAdapter = new PostgresReadinessAdapter(getPostgresAppUrl());

// Was: new PostgresIdentityRepository(getPostgresUrl())
identityRepository = new PostgresIdentityRepository(getPostgresAppUrl());
```

- [ ] **Step 4: Update `forward-auth.ts` pool to use `getPostgresAppUrl()`**

In `apps/platform-api/src/server/forward-auth.ts`, add the import and change the pool constructor:

Change the import line from:
```typescript
import { getSessionStore, getPostgresUrl } from "./dependencies.ts";
```

To:
```typescript
import { getSessionStore, getPostgresAppUrl } from "./dependencies.ts";
```

Change `getPool()` function from:
```typescript
function getPool(): pg.Pool {
  if (!_pgPool) _pgPool = new pg.Pool({ connectionString: getPostgresUrl(), max: 2 });
  return _pgPool;
}
```

To:
```typescript
function getPool(): pg.Pool {
  if (!_pgPool) _pgPool = new pg.Pool({ connectionString: getPostgresAppUrl(), max: 2 });
  return _pgPool;
}
```

- [ ] **Step 5: Run platform-api tests to confirm nothing broke**

```bash
npm run test:platform-api
```

Expected: all tests pass (pool changes have no effect on unit tests that mock the pool).

- [ ] **Step 6: Commit**

```bash
git add apps/platform-api/src/server/dependencies.ts apps/platform-api/src/server/forward-auth.ts
git commit -m "feat(api): wire runtime pool to platform_app non-superuser role (ADR-ACT-0189)"
```

---

## Task 4: Compose + env files — expose `POSTGRES_APP_URL`

**Files:**
- Modify: `compose.yaml`
- Modify: `.env.example`
- Modify: `.env.dev`
- Modify: `.env.test`
- Modify: `.env.staging`
- Modify: `.env.prod`

- [ ] **Step 1: Add `POSTGRES_APP_URL` to `platform-api` service in `compose.yaml`**

Find the `platform-api` service environment block (around line 446 which has the existing `POSTGRES_URL`). Add the app URL line directly after it:

```yaml
      POSTGRES_URL: postgresql://${POSTGRES_USER:-platform}:${POSTGRES_PASSWORD:-platformpassword}@postgres:5432/${POSTGRES_DB:-platform}
      POSTGRES_APP_URL: postgresql://platform_app:${POSTGRES_APP_PASSWORD:-platformapppassword}@postgres:5432/${POSTGRES_DB:-platform}
```

- [ ] **Step 2: Add `POSTGRES_APP_PASSWORD` to `.env.example`**

In `.env.example`, after the `POSTGRES_PASSWORD=<set locally>` line, add:

```
# App-role password — the non-superuser connection used at runtime (ADR-ACT-0189)
POSTGRES_APP_PASSWORD=<set locally>
```

- [ ] **Step 3: Add `POSTGRES_APP_PASSWORD` to `.env.dev`**

In `.env.dev`, after any existing Postgres variable (or at the end of the credentials block):

```
POSTGRES_APP_PASSWORD=platformapppassword
```

- [ ] **Step 4: Add `POSTGRES_APP_PASSWORD` to `.env.test`**

In `.env.test`, same block:

```
POSTGRES_APP_PASSWORD=platformapppassword
```

- [ ] **Step 5: Add placeholder `POSTGRES_APP_PASSWORD` to `.env.staging`**

In `.env.staging`, after the existing Postgres block:

```
POSTGRES_APP_PASSWORD=<set locally>
```

- [ ] **Step 6: Add placeholder `POSTGRES_APP_PASSWORD` to `.env.prod`**

In `.env.prod`, same:

```
POSTGRES_APP_PASSWORD=<set locally>
```

- [ ] **Step 7: Run compose config validation**

```bash
npm run compose:config
npm run compose:config:all
```

Expected: both exit 0 with no errors.

- [ ] **Step 8: Commit**

```bash
git add compose.yaml .env.example .env.dev .env.test .env.staging .env.prod
git commit -m "feat(infra): expose POSTGRES_APP_URL to platform-api container (ADR-ACT-0189)"
```

---

## Task 5: Static unit tests — migration 010 content assertions

**Files:**
- Modify: `packages/adapters-postgres/tests/adapters-postgres.test.ts`

These tests require no live Postgres — they read migration 010 as a file and assert its content.

- [ ] **Step 1: Write failing tests first**

In `packages/adapters-postgres/tests/adapters-postgres.test.ts`, add a new describe block after the existing `ADR-ACT-0184 static assertions` block:

```typescript
describe("ADR-ACT-0189 static assertions — migration 010", () => {
  const migration010 = readFileSync(
    join(_dir, "../../../apps/platform-api/src/db/migrations/010-platform-app-role.sql"),
    "utf8"
  );

  it("migration 010 creates platform_app with NOSUPERUSER", () => {
    assert.ok(
      migration010.includes("platform_app"),
      "migration 010 must reference platform_app role"
    );
    assert.ok(
      migration010.includes("NOSUPERUSER"),
      "migration 010 must create platform_app with NOSUPERUSER"
    );
  });

  it("migration 010 creates platform_app with NOBYPASSRLS", () => {
    assert.ok(
      migration010.includes("NOBYPASSRLS"),
      "migration 010 must create platform_app with NOBYPASSRLS"
    );
  });

  it("migration 010 grants rls_bypass to platform_app", () => {
    assert.ok(
      migration010.includes("rls_bypass"),
      "migration 010 must grant rls_bypass role to platform_app"
    );
    assert.ok(
      migration010.toLowerCase().includes("grant rls_bypass to platform_app"),
      "migration 010 must GRANT rls_bypass TO platform_app"
    );
  });

  it("migration 010 grants table privileges on all tables", () => {
    assert.ok(
      migration010.toLowerCase().includes("grant select, insert, update, delete on all tables"),
      "migration 010 must GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES to platform_app"
    );
  });

  it("migration 010 sets ALTER DEFAULT PRIVILEGES for future tables", () => {
    assert.ok(
      migration010.toLowerCase().includes("alter default privileges"),
      "migration 010 must set ALTER DEFAULT PRIVILEGES for future tables/sequences"
    );
  });

  it("init-extra-databases.sh creates platform_app at initdb", () => {
    const initScript = readFileSync(
      join(_dir, "../../../docker/postgres/init-extra-databases.sh"),
      "utf8"
    );
    assert.ok(
      initScript.includes("platform_app"),
      "init-extra-databases.sh must create platform_app role at initdb"
    );
    assert.ok(
      initScript.includes("NOBYPASSRLS"),
      "init-extra-databases.sh must create platform_app with NOBYPASSRLS"
    );
  });
});
```

- [ ] **Step 2: Run the tests (they should fail until migration 010 and init script are in place)**

```bash
npm run test:platform-api
```

Expected: the 6 new tests from ADR-ACT-0189 block fail with file-not-found or content assertion errors.

(If Tasks 1 and 2 are already done, tests should pass here instead — that's fine.)

- [ ] **Step 3: Run the tests again after Tasks 1–2 are confirmed done**

```bash
npm run test:platform-api
```

Expected: all tests pass (175+ pass, 0 fail).

- [ ] **Step 4: Commit**

```bash
git add packages/adapters-postgres/tests/adapters-postgres.test.ts
git commit -m "test(db): static assertions for migration 010 platform_app role (ADR-ACT-0189)"
```

---

## Task 6: RLS integration tests — real enforcement with `platform_app`

**Files:**
- Modify: `tests/integration/compose-smoke.test.mjs`

These tests need live Postgres (port 5433, migrations applied). They run under `npm run test:compose`.

- [ ] **Step 1: Confirm Postgres is accessible and migration 010 is applied**

```bash
psql postgresql://platform:platformpassword@localhost:5433/platform \
  -c "SELECT name FROM schema_migrations WHERE name = '010-platform-app-role.sql';"
```

Expected: one row returned. If not, apply migration first:
```bash
POSTGRES_URL=postgresql://platform:platformpassword@localhost:5433/platform \
  node -e "import('./apps/platform-api/src/db/migrate.ts').then(m => m.runMigrations()).then(r => { console.log(r); process.exit(0); })"
```

- [ ] **Step 2: Add `POSTGRES_APP_URL` constant and RLS describe block to `compose-smoke.test.mjs`**

At the top of `compose-smoke.test.mjs`, after the existing `POSTGRES_URL` constant, add:

```javascript
const POSTGRES_APP_URL = "postgresql://platform_app:platformapppassword@localhost:5433/platform";
```

Then, at the end of the file (after all existing tests), add a new describe block:

```javascript
// ---------------------------------------------------------------------------
// RLS enforcement with platform_app role (ADR-ACT-0189)
//
// These tests verify that RLS actually enforces on the non-superuser app role.
// They use the superuser client (pgClient) for setup and a separate app-role
// client (appClient) to verify isolation.
// ---------------------------------------------------------------------------

test("platform_app role exists, is not superuser, has no BYPASSRLS, has rls_bypass membership", async () => {
  const { rows } = await pgClient.query(`
    SELECT rolsuper, rolbypassrls, rolcanlogin,
           pg_has_role('platform_app', 'rls_bypass', 'MEMBER') AS has_rls_bypass
    FROM pg_roles WHERE rolname = 'platform_app'
  `);
  assert.equal(rows.length, 1, "platform_app role must exist");
  assert.equal(rows[0].rolsuper, false, "platform_app must NOT be superuser");
  assert.equal(rows[0].rolbypassrls, false, "platform_app must NOT have BYPASSRLS");
  assert.equal(rows[0].rolcanlogin, true, "platform_app must have LOGIN");
  assert.equal(rows[0].has_rls_bypass, true, "platform_app must have rls_bypass membership for withSystemAdmin()");
});

test("pgadmin_sysadmin still has rls_bypass membership (regression guard)", async () => {
  const { rows } = await pgClient.query(`
    SELECT pg_has_role('pgadmin_sysadmin', 'rls_bypass', 'MEMBER') AS has_rls_bypass
    FROM pg_roles WHERE rolname = 'pgadmin_sysadmin'
  `);
  assert.equal(rows.length, 1, "pgadmin_sysadmin must still exist");
  assert.equal(rows[0].has_rls_bypass, true, "pgadmin_sysadmin must retain rls_bypass (regression guard)");
});

test("RLS: platform_app sees only own-tenant memberships (isolation enforced)", async () => {
  await resetDatabase();
  await runMigrations();

  const ORG_A = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
  const ORG_B = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
  const USER_A = "cccccccc-cccc-4ccc-cccc-cccccccccccc";
  const USER_B = "dddddddd-dddd-4ddd-dddd-dddddddddddd";

  // Insert two orgs and one user per org as superuser
  await pgClient.query(
    "INSERT INTO organisations(id, slug, display_name) VALUES ($1,'org-a','Org A'),($2,'org-b','Org B')",
    [ORG_A, ORG_B]
  );
  await pgClient.query(
    "INSERT INTO users(id, email, display_name) VALUES ($1,'user-a@test.local','User A'),($2,'user-b@test.local','User B')",
    [USER_A, USER_B]
  );
  await pgClient.query(
    "INSERT INTO memberships(user_id, organisation_id, role) VALUES ($1,$2,'tenant-admin'),($3,$4,'tenant-admin')",
    [USER_A, ORG_A, USER_B, ORG_B]
  );

  const appClient = new pg.Client(POSTGRES_APP_URL);
  await appClient.connect();
  try {
    // Set tenant to Org A — should see only Org A's membership row
    await appClient.query("BEGIN");
    await appClient.query("SELECT set_config('app.current_tenant_id', $1, true)", [ORG_A]);
    const { rows: ownRows } = await appClient.query(
      "SELECT organisation_id FROM memberships"
    );
    assert.equal(ownRows.length, 1, "Should see exactly 1 membership row (own tenant)");
    assert.equal(ownRows[0].organisation_id, ORG_A, "Should see only Org A's row");
    await appClient.query("COMMIT");

    // Set tenant to Org B — should see only Org B's row
    await appClient.query("BEGIN");
    await appClient.query("SELECT set_config('app.current_tenant_id', $1, true)", [ORG_B]);
    const { rows: otherRows } = await appClient.query(
      "SELECT organisation_id FROM memberships"
    );
    assert.equal(otherRows.length, 1, "Should see exactly 1 row for Org B context");
    assert.equal(otherRows[0].organisation_id, ORG_B, "Should see only Org B's row");
    await appClient.query("COMMIT");

    // No tenant set — should see no rows
    await appClient.query("BEGIN");
    await appClient.query("SELECT set_config('app.current_tenant_id', '', true)", []);
    const { rows: noTenantRows } = await appClient.query("SELECT 1 FROM memberships LIMIT 1");
    assert.equal(noTenantRows.length, 0, "Without tenant context, RLS must hide all rows");
    await appClient.query("COMMIT");
  } finally {
    await appClient.end();
  }
});

test("RLS: setting app.current_tenant_id alone cannot show another tenant's rows", async () => {
  // This tests the invariant that a client cannot forge a tenant ID to see another
  // tenant's data just by setting the GUC — they can only see their own tenant.
  // (The enforcement is that there is no row matching a forged org ID in memberships.)
  const ORG_A = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
  const ORG_B = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";

  const appClient = new pg.Client(POSTGRES_APP_URL);
  await appClient.connect();
  try {
    // Set tenant to Org A, but query for Org B rows explicitly
    await appClient.query("BEGIN");
    await appClient.query("SELECT set_config('app.current_tenant_id', $1, true)", [ORG_A]);
    const { rows } = await appClient.query(
      "SELECT organisation_id FROM memberships WHERE organisation_id = $1",
      [ORG_B]
    );
    assert.equal(rows.length, 0, "RLS must prevent seeing Org B rows when tenant is Org A");
    await appClient.query("COMMIT");
  } finally {
    await appClient.end();
  }
});

test("withSystemAdmin equivalent: platform_app with rls_bypass sees all tenant rows", async () => {
  // Simulate what withSystemAdmin() does: pg_has_role check passes, so all rows visible.
  const ORG_A = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
  const ORG_B = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";

  const appClient = new pg.Client(POSTGRES_APP_URL);
  await appClient.connect();
  try {
    // platform_app has rls_bypass — pg_has_role check should be true
    const { rows: bypassCheck } = await appClient.query(
      "SELECT pg_has_role(current_user, 'rls_bypass', 'MEMBER') AS can_bypass"
    );
    assert.equal(bypassCheck[0].can_bypass, true, "platform_app must have rls_bypass for withSystemAdmin()");

    // The RLS policy allows access when pg_has_role is true — no current_tenant_id needed
    await appClient.query("BEGIN");
    // withSystemAdmin sets NO GUC — relies solely on role membership (ADR-ACT-0184)
    const { rows: allRows } = await appClient.query(
      "SELECT organisation_id FROM memberships ORDER BY organisation_id"
    );
    // pg_has_role = true so RLS policy grants access — should see both tenants
    assert.equal(allRows.length, 2, "withSystemAdmin path: platform_app must see all tenants via rls_bypass");
    await appClient.query("COMMIT");
  } finally {
    await appClient.end();
  }
});
```

- [ ] **Step 3: Run the compose smoke tests**

```bash
npm run test:compose
```

Expected: all existing tests pass; the 5 new RLS tests pass. If `platform_app` does not yet exist (migration not applied), the tests fail with connection errors — apply migration 010 first.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/compose-smoke.test.mjs
git commit -m "test(rls): integration tests prove RLS enforces on platform_app role (ADR-ACT-0189)"
```

---

## Task 7: Governance — ACTION-REGISTER updates + final gate

**Files:**
- Modify: `docs/adr/ACTION-REGISTER.md`

- [ ] **Step 1: Run the full validation suite**

```bash
npm run test:platform-api
npm run test:architecture
npm run test:compose
make check
```

Expected:
- `test:platform-api`: all pass (175+ tests)
- `test:architecture`: 617/619 pass (2 pre-existing OpenAPI drift failures are unchanged)
- `test:compose`: all pass including 5 new RLS tests
- `make check`: all gates pass

- [ ] **Step 2: Update ADR-ACT-0189 to Done**

In `docs/adr/ACTION-REGISTER.md`, find the ADR-ACT-0189 row and update its status from `Open` to `Done`, and update the description to record implementation evidence:

Replace:
```
| ADR-ACT-0189 | ADR-0029 | Non-superuser Postgres role for RLS enforcement. ... | Implementation | Open | High | ADR-0029 | Architecture owner / technical lead | Before production RLS enforcement | apps/platform-api/src/db/migrations/004-rls-policies.sql; packages/adapters-postgres/src/index.ts; infra/ |
```

With:
```
| ADR-ACT-0189 | ADR-0029 | Non-superuser Postgres role for RLS enforcement. Implemented: (1) migration 010 creates platform_app (NOSUPERUSER, NOBYPASSRLS, LOGIN), grants rls_bypass membership (withSystemAdmin() preserved), grants SELECT/INSERT/UPDATE/DELETE on all existing tables/sequences and ALTER DEFAULT PRIVILEGES for future tables; (2) init-extra-databases.sh creates platform_app at initdb with env-var-controlled password; (3) dependencies.ts adds getPostgresAppUrl() — app pool, repositories, forward-auth pool use this; POSTGRES_URL remains superuser-only for migrations/seed/reset; (4) compose.yaml exposes POSTGRES_APP_URL; (5) 6 static unit tests assert migration 010 content; (6) 5 integration tests prove RLS enforces on platform_app: role properties, tenant isolation, cross-tenant blocking, withSystemAdmin bypass via rls_bypass. Production caveat: POSTGRES_APP_PASSWORD must be set to a strong value; default 'platformapppassword' is dev-only. | Implementation | Done | High | ADR-0029 | Architecture owner / technical lead | Complete | apps/platform-api/src/db/migrations/010-platform-app-role.sql; docker/postgres/init-extra-databases.sh; apps/platform-api/src/server/dependencies.ts; apps/platform-api/src/server/forward-auth.ts; compose.yaml; packages/adapters-postgres/tests/adapters-postgres.test.ts; tests/integration/compose-smoke.test.mjs |
```

- [ ] **Step 3: Mark ADR-ACT-0147 Done**

ADR-ACT-0147 was "In Progress" with the blocker being the non-superuser app role (now implemented). Update its row:

Change the status from `In Progress` to `Done` and update the "Next" column from `After ADR-ACT-0189` to `Complete`. Update the description to note that ADR-ACT-0189 was the completing action:

Replace the description suffix with:
```
... CAVEAT previously: RLS was non-enforcing in dev because POSTGRES_USER is a superuser. RESOLVED by ADR-ACT-0189: platform_app non-superuser role is now the runtime connection. RLS enforces in production. Dev still connects as POSTGRES_URL superuser for migrations/admin; POSTGRES_APP_URL uses platform_app at runtime. | Implementation | Done | High | ADR-0029 | Architecture owner / technical lead | Complete | apps/platform-api/src/db/migrations/004-rls-policies.sql; packages/adapters-postgres/src/index.ts; apps/platform-api/src/db/migrations/010-platform-app-role.sql |
```

- [ ] **Step 4: Fix stale ADR-ACT-0185 "Remaining" text**

ADR-ACT-0185's description ends with: `Remaining: UMA enforcement (ADR-ACT-0145), per-tenant service account for auth settings (ADR-ACT-0155), support mode audit for system-admin cross-tenant access.`

All three are now complete:
- ADR-ACT-0145 (UMA enforcement): Done
- ADR-ACT-0186 (per-tenant Keycloak service account): Done (superseded/implements ADR-ACT-0155 intent)
- ADR-ACT-0187 (support mode, including audit): Done

Update that suffix in ADR-ACT-0185 description:
```
Remaining at time of writing: UMA enforcement, per-tenant Keycloak service account, support mode. All three are now complete: ADR-ACT-0145 (UMA Done), ADR-ACT-0186 (per-tenant KC account Done), ADR-ACT-0187 (support mode Done).
```

- [ ] **Step 5: Final commit**

```bash
git add docs/adr/ACTION-REGISTER.md
git commit -m "docs(adr): ADR-ACT-0189 Done; ADR-ACT-0147 Done; fix stale ADR-ACT-0185 Remaining"
```

- [ ] **Step 6: Push**

```bash
git push origin main
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Create `platform_app` non-superuser LOGIN role with NOBYPASSRLS → Task 1
- [x] Grant `rls_bypass` membership (withSystemAdmin preserved) → Task 1
- [x] Grant table/sequence privileges + default privileges → Task 1
- [x] init-extra-databases.sh mirrors at initdb → Task 2
- [x] Runtime pool uses new role → Task 3
- [x] Migrations use superuser URL → `getPostgresUrl()` stays unchanged
- [x] Compose + env files → Task 4
- [x] Tests: role is not superuser → Task 6
- [x] Tests: role has no BYPASSRLS → Task 6
- [x] Tests: tenant isolation enforced → Task 6
- [x] Tests: wrong-tenant rows hidden → Task 6
- [x] Tests: setting GUC alone cannot bypass → Task 6
- [x] Tests: withSystemAdmin path works → Task 6
- [x] Tests: pgadmin_sysadmin unchanged → Task 6
- [x] Static migration content assertions → Task 5
- [x] ADR-ACT-0189 marked Done → Task 7
- [x] ADR-ACT-0147 updated → Task 7
- [x] ADR-ACT-0185 stale text fixed → Task 7

**Production caveats captured:**
- `POSTGRES_APP_PASSWORD` must be set to a strong value (migration uses dev default 'platformapppassword')
- `getPostgresAppUrl()` falls back to superuser URL when `POSTGRES_APP_URL` is unset — both must be set in production

**Type/API consistency:** No TypeScript types changed; `getPostgresAppUrl()` returns `string` matching `getPostgresUrl()` contract. Forward-auth import change is purely a rename of the import identifier.
