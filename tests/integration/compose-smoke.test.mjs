/**
 * Compose service integration smoke tests.
 *
 * Prerequisites: `docker compose up -d` must be running.
 * Run with: npm run test:compose
 *
 * Uses npm clients for all data operations (pg, redis, @aws-sdk/client-s3,
 * nodemailer). Only Docker CLI is used for container health checks ? there is
 * no npm equivalent for inspecting Docker container state.
 *
 * Each test performs a full read/write roundtrip and cleans up after itself
 * so reruns are idempotent.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

// npm clients
import pg from "pg";
import { createClient as createRedisClient } from "redis";

// DB substrate ? TypeScript modules (Node 25.8 strips types natively)
import { runMigrations, isMigrated } from "../../apps/platform-api/src/db/migrate.ts";
import { seedFixtures, FIXTURE } from "../../apps/platform-api/src/db/seed.ts";
import { resetDatabase } from "../../apps/platform-api/src/db/reset.ts";
import {
  getOrganisationProfile,
  updateOrganisationDisplayName,
} from "../../apps/platform-api/src/usecases/organisation.ts";
import { PostgresOrganisationRepository } from "../../packages/adapters-postgres/src/index.ts";
import {
  S3Client,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteBucketCommand,
  ListBucketsCommand,
} from "@aws-sdk/client-s3";
import nodemailer from "nodemailer";

// ---------------------------------------------------------------------------
// Constants — read from env when available (supports per-stage overrides)
// ---------------------------------------------------------------------------

const POSTGRES_URL =
  process.env["POSTGRES_URL"] ?? "postgresql://platform:platformpassword@localhost:5433/platform";
// Non-superuser app role URL used for RLS enforcement tests (ADR-ACT-0189)
const POSTGRES_APP_URL =
  process.env["POSTGRES_APP_URL"] ??
  "postgresql://platform_app:platformapppassword@localhost:5433/platform";
const REDIS_URL = process.env["REDIS_URL"] ?? "redis://localhost:6379";
const COMPOSE_PROJECT = process.env["COMPOSE_PROJECT"] ?? "react-platform";
const MINIO_ENDPOINT = process.env["MINIO_ENDPOINT"] ?? "http://localhost:9000";
const CLICKHOUSE_HTTP = process.env["CLICKHOUSE_HTTP"] ?? "http://localhost:8124";
const MAILPIT_API = process.env["MAILPIT_API"] ?? "http://localhost:8025";
const MAILPIT_SMTP_PORT = parseInt(process.env["MAILPIT_SMTP_PORT"] || "1025", 10);
const OTEL_HTTP = process.env["OTEL_HTTP"] ?? "http://localhost:4318";

// DATA_POLICY=preserve means staging/prod — never truncate real data.
// Only destructive-mode runs (dev/test) may call resetDatabase().
const ALLOW_RESET = process.env["DATA_POLICY"] !== "preserve";

const smokeKey = `platform-smoke-${Date.now()}`;
const smokeBucket = `smoke-${Date.now()}`;

// ---------------------------------------------------------------------------
// Docker helper ? only used for container health state checks
// ---------------------------------------------------------------------------

function dockerInspect(container, format) {
  const result = spawnSync("docker", ["inspect", container, "--format", format], {
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  return result.stdout.trim();
}

// ---------------------------------------------------------------------------
// Clients ? declared here, connected in before()
// ---------------------------------------------------------------------------

const pgClient = new pg.Client(POSTGRES_URL);
const organisationRepo = new PostgresOrganisationRepository(POSTGRES_URL);
const redisClient = createRedisClient({ url: REDIS_URL });
const s3 = new S3Client({
  endpoint: MINIO_ENDPOINT,
  region: "us-east-1",
  credentials: { accessKeyId: "minioadmin", secretAccessKey: "miniopassword" },
  forcePathStyle: true,
});
const smtp = nodemailer.createTransport({
  host: process.env["MAILPIT_SMTP_HOST"] ?? "localhost",
  port: MAILPIT_SMTP_PORT,
  secure: false,
  ignoreTLS: true,
});

before(async () => {
  await pgClient.connect();
  await redisClient.connect();
});

after(async () => {
  // Best-effort cleanup ? individual tests clean up; this is a final safety net
  try {
    await pgClient.query("DROP TABLE IF EXISTS _smoke_test");
  } catch {}
  try {
    await redisClient.del(smokeKey);
  } catch {}
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: smokeBucket, Key: "smoke.txt" }));
    await s3.send(new DeleteBucketCommand({ Bucket: smokeBucket }));
  } catch {}
  await pgClient.end();
  await redisClient.quit();
  smtp.close();
});

// ---------------------------------------------------------------------------
// PostgreSQL (pg client ? localhost:5433)
// ---------------------------------------------------------------------------

test("postgres: container is healthy", () => {
  const status = dockerInspect(`${COMPOSE_PROJECT}-postgres-1`, "{{.State.Health.Status}}");
  assert.equal(status, "healthy");
});

test("postgres: pg client can connect", async () => {
  const { rows } = await pgClient.query("SELECT 1 AS result");
  assert.equal(rows[0]?.result, 1);
});

test("postgres: write/read/delete roundtrip", async () => {
  await pgClient.query("CREATE TABLE IF NOT EXISTS _smoke_test (k text PRIMARY KEY, v text)");
  await pgClient.query(
    "INSERT INTO _smoke_test VALUES ($1, $2) ON CONFLICT(k) DO UPDATE SET v = EXCLUDED.v",
    [smokeKey, "ok"]
  );
  const { rows } = await pgClient.query("SELECT v FROM _smoke_test WHERE k = $1", [smokeKey]);
  assert.equal(rows[0]?.v, "ok");
  await pgClient.query("DELETE FROM _smoke_test WHERE k = $1", [smokeKey]);
  await pgClient.query("DROP TABLE IF EXISTS _smoke_test");
});

// ---------------------------------------------------------------------------
// Database substrate ? migration and seed
// ---------------------------------------------------------------------------

test("database: migration creates identity schema tables", async () => {
  await runMigrations();
  const { rows } = await pgClient.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('users','organisations','memberships','external_identities')
    ORDER BY table_name
  `);
  const names = rows.map((r) => r.table_name);
  assert.ok(names.includes("users"), "users table created");
  assert.ok(names.includes("organisations"), "organisations table created");
  assert.ok(names.includes("memberships"), "memberships table created");
  assert.ok(names.includes("external_identities"), "external_identities table created");
});

test("database: seed creates fixture actors and organisation", async () => {
  if (ALLOW_RESET) await resetDatabase();
  await runMigrations();
  await seedFixtures();

  const orgResult = await pgClient.query("SELECT id, slug FROM organisations WHERE id = $1", [
    FIXTURE.ORG_ID,
  ]);
  assert.equal(orgResult.rows.length, 1, "fixture org exists");
  assert.equal(orgResult.rows[0].slug, FIXTURE.ORG_SLUG);

  const adminResult = await pgClient.query(
    "SELECT role FROM memberships WHERE user_id = $1 AND organisation_id = $2",
    [FIXTURE.ADMIN_ID, FIXTURE.ORG_ID]
  );
  assert.equal(adminResult.rows[0]?.role, "tenant-admin", "admin has correct role");

  const viewerResult = await pgClient.query(
    "SELECT role FROM memberships WHERE user_id = $1 AND organisation_id = $2",
    [FIXTURE.VIEWER_ID, FIXTURE.ORG_ID]
  );
  assert.equal(viewerResult.rows[0]?.role, "viewer", "viewer has correct role");

  const forbiddenResult = await pgClient.query("SELECT id FROM memberships WHERE user_id = $1", [
    FIXTURE.FORBIDDEN_ID,
  ]);
  assert.equal(forbiddenResult.rows.length, 0, "forbidden actor has no membership");
});

test("database: migration runner creates schema_migrations table", async () => {
  if (ALLOW_RESET) await resetDatabase();
  await runMigrations();
  const { rows } = await pgClient.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'schema_migrations'"
  );
  assert.equal(rows.length, 1, "schema_migrations table created");
});

test("database: migration is idempotent (skips already applied)", async (t) => {
  if (!ALLOW_RESET) {
    t.skip("preserve mode — requires clean DB state from resetDatabase()");
    return;
  }
  await resetDatabase();
  const first = await runMigrations();
  const second = await runMigrations();
  assert.ok(first.applied.length > 0, "first run applies migrations");
  assert.equal(second.applied.length, 0, "second run skips all");
  assert.ok(second.skipped.length > 0, "second run reports skipped");
});

test("database: seed requires migrated schema", async (t) => {
  if (!ALLOW_RESET) {
    t.skip("preserve mode — requires clean DB state from resetDatabase()");
    return;
  }
  await resetDatabase();
  await assert.rejects(
    () => seedFixtures(),
    (err) => {
      assert.ok(err.message.includes("not migrated"), `Expected 'not migrated' in: ${err.message}`);
      return true;
    },
    "seed should fail on unmigrated DB"
  );
});

test("database: migration fails if committed file has changed checksum", async (t) => {
  if (!ALLOW_RESET) {
    t.skip("preserve mode — requires clean DB state from resetDatabase()");
    return;
  }
  await resetDatabase();
  await runMigrations();

  // Corrupt the stored checksum for the first migration file
  await pgClient.query(
    "UPDATE schema_migrations SET checksum = 'different_value' WHERE name = '001-identity-schema.sql'"
  );

  // Re-running migrations must now throw due to the mismatch
  await assert.rejects(
    () => runMigrations(),
    (err) => {
      assert.ok(
        err.message.includes("checksum mismatch"),
        `Expected 'checksum mismatch' in: ${err.message}`
      );
      return true;
    },
    "migration should fail on checksum mismatch"
  );

  // Leave schema clean for subsequent tests
  if (ALLOW_RESET) await resetDatabase();
});

// ---------------------------------------------------------------------------
// Redis (redis npm client ? localhost:6379)
// ---------------------------------------------------------------------------

test("redis: container is healthy", () => {
  const status = dockerInspect(`${COMPOSE_PROJECT}-redis-1`, "{{.State.Health.Status}}");
  assert.equal(status, "healthy");
});

test("redis: client can PING", async () => {
  const result = await redisClient.ping();
  assert.equal(result, "PONG");
});

test("redis: SET/GET/DEL roundtrip", async () => {
  await redisClient.set(smokeKey, "ok");
  const val = await redisClient.get(smokeKey);
  assert.equal(val, "ok");
  await redisClient.del(smokeKey);
  const exists = await redisClient.exists(smokeKey);
  assert.equal(exists, 0);
});

// ---------------------------------------------------------------------------
// ClickHouse (fetch ? localhost:8124)
// ---------------------------------------------------------------------------

async function chQuery(query) {
  // ClickHouse: SELECT via GET; DDL/DML via POST (GET is read-only per HTTP spec)
  const isWrite = /^\s*(CREATE|DROP|INSERT|ALTER|RENAME|TRUNCATE)/i.test(query);
  const authParams = "user=platform&password=clickhousepassword";
  if (isWrite) {
    const res = await fetch(`${CLICKHOUSE_HTTP}/?${authParams}`, {
      method: "POST",
      body: query,
    });
    if (!res.ok) throw new Error(`ClickHouse ${res.status}: ${await res.text()}`);
    return res.text();
  }
  const url = new URL(CLICKHOUSE_HTTP);
  url.searchParams.set("query", query);
  url.searchParams.set("user", "platform");
  url.searchParams.set("password", "clickhousepassword");
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`ClickHouse ${res.status}: ${await res.text()}`);
  return res.text();
}

test("clickhouse: container is healthy", () => {
  const status = dockerInspect(`${COMPOSE_PROJECT}-clickhouse-1`, "{{.State.Health.Status}}");
  assert.equal(status, "healthy");
});

test("clickhouse: /ping returns Ok.", async () => {
  const res = await fetch(`${CLICKHOUSE_HTTP}/ping`);
  assert.equal(res.status, 200);
  assert.equal((await res.text()).trim(), "Ok.");
});

test("clickhouse: SELECT 1 returns 1", async () => {
  const text = await chQuery("SELECT 1");
  assert.equal(text.trim(), "1");
});

test("clickhouse: CREATE/INSERT/SELECT/DROP roundtrip", async () => {
  const table = `default._smoke_${Date.now()}`;
  await chQuery(`CREATE TABLE IF NOT EXISTS ${table} (k String, v String) ENGINE = Memory`);
  await chQuery(`INSERT INTO ${table} VALUES ('${smokeKey}', 'ok')`);
  const text = await chQuery(`SELECT v FROM ${table} WHERE k = '${smokeKey}'`);
  assert.equal(text.trim(), "ok");
  await chQuery(`DROP TABLE IF EXISTS ${table}`);
});

// ---------------------------------------------------------------------------
// MinIO (@aws-sdk/client-s3 ? localhost:9000)
// ---------------------------------------------------------------------------

test("minio: health/live endpoint returns 200", async () => {
  const res = await fetch(`${MINIO_ENDPOINT}/minio/health/live`);
  assert.equal(res.status, 200);
});

test("minio: S3 client can list buckets", async () => {
  const result = await s3.send(new ListBucketsCommand({}));
  assert.ok(Array.isArray(result.Buckets));
});

test("minio: create bucket / PUT / GET / DELETE roundtrip", async () => {
  await s3.send(new CreateBucketCommand({ Bucket: smokeBucket }));

  await s3.send(
    new PutObjectCommand({
      Bucket: smokeBucket,
      Key: "smoke.txt",
      Body: `smoke-content-${smokeKey}`,
      ContentType: "text/plain",
    })
  );

  const response = await s3.send(new GetObjectCommand({ Bucket: smokeBucket, Key: "smoke.txt" }));
  const body = await response.Body.transformToString();
  assert.match(body, /smoke-content/);

  await s3.send(new DeleteObjectCommand({ Bucket: smokeBucket, Key: "smoke.txt" }));
  await s3.send(new DeleteBucketCommand({ Bucket: smokeBucket }));
});

// ---------------------------------------------------------------------------
// Mailpit (nodemailer SMTP + fetch API ? localhost:1025 / localhost:8025)
// ---------------------------------------------------------------------------

test("mailpit: /api/v1/info returns version", async () => {
  const res = await fetch(`${MAILPIT_API}/api/v1/info`);
  assert.equal(res.status, 200);
  const info = await res.json();
  assert.match(info.Version, /^v\d+/);
});

test("mailpit: nodemailer SMTP send and retrieve via API", async () => {
  const subject = `Smoke-${smokeKey}`;

  await smtp.sendMail({
    from: "noreply@platform.local",
    to: "smoke@platform.local",
    subject,
    text: "compose smoke test",
  });

  // Give mailpit a moment to ingest before querying
  await new Promise((r) => setTimeout(r, 400));

  const res = await fetch(`${MAILPIT_API}/api/v1/search?query=${encodeURIComponent(subject)}`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.total >= 1, `Expected ?1 message for subject "${subject}", got ${data.total}`);
});

// ---------------------------------------------------------------------------
// OpenTelemetry Collector (fetch ? localhost:4318)
// ---------------------------------------------------------------------------

test("otel-collector: container is running", () => {
  const status = dockerInspect(`${COMPOSE_PROJECT}-otel-collector-1`, "{{.State.Status}}");
  assert.equal(status, "running");
});

// ---------------------------------------------------------------------------
// Organisation use cases (getOrganisationProfile, updateOrganisationDisplayName)
// ---------------------------------------------------------------------------

test("organisation: getOrganisationProfile returns fixture org", async () => {
  if (ALLOW_RESET) await resetDatabase();
  await runMigrations();
  await seedFixtures();
  const profile = await getOrganisationProfile(
    { organisationId: FIXTURE.ORG_ID },
    { organisations: organisationRepo }
  );
  assert.equal(profile.slug, FIXTURE.ORG_SLUG);
  assert.equal(profile.id, FIXTURE.ORG_ID);
  assert.equal(typeof profile.displayName, "string");
  assert.ok(profile.displayName.length > 0);
});

test("organisation: updateOrganisationDisplayName updates and returns updated record", async () => {
  if (ALLOW_RESET) await resetDatabase();
  await runMigrations();
  await seedFixtures();
  const updated = await updateOrganisationDisplayName(
    { organisationId: FIXTURE.ORG_ID, displayName: "Test Display Name" },
    { organisations: organisationRepo }
  );
  assert.equal(updated.displayName, "Test Display Name");
  assert.equal(updated.id, FIXTURE.ORG_ID);
  // Restore original display name
  await updateOrganisationDisplayName(
    { organisationId: FIXTURE.ORG_ID, displayName: "Fixture Organisation" },
    { organisations: organisationRepo }
  );
});

test("otel-collector: OTLP/HTTP POST /v1/traces returns 200", async () => {
  const res = await fetch(`${OTEL_HTTP}/v1/traces`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      resourceSpans: [
        {
          resource: {
            attributes: [{ key: "service.name", value: { stringValue: "platform-smoke-test" } }],
          },
          scopeSpans: [
            {
              scope: { name: "compose-smoke" },
              spans: [
                {
                  traceId: "01020304050607080102030405060708",
                  spanId: "0102030405060708",
                  name: `smoke-span-${smokeKey}`,
                  kind: 1,
                  startTimeUnixNano: "1700000000000000000",
                  endTimeUnixNano: "1700000001000000000",
                  status: {},
                },
              ],
            },
          ],
        },
      ],
    }),
  });
  assert.equal(res.status, 200);
});

// ---------------------------------------------------------------------------
// RLS enforcement with platform_app role (ADR-ACT-0189)
//
// These tests verify that RLS actually enforces on the non-superuser app role.
// Setup uses the superuser client (pgClient) for INSERT; assertions use a
// separate platform_app client so the non-superuser behaviour is observed.
//
// Test UUIDs use a distinct prefix (aaaa/bbbb) to avoid FIXTURE collisions.
// ---------------------------------------------------------------------------

const RLS_ORG_A = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const RLS_ORG_B = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const RLS_USER_A = "cccccccc-cccc-4ccc-cccc-cccccccccccc";
const RLS_USER_B = "dddddddd-dddd-4ddd-dddd-dddddddddddd";

test("platform_app: not superuser, no BYPASSRLS, has rls_bypass membership", async () => {
  const { rows } = await pgClient.query(`
    SELECT rolsuper, rolbypassrls, rolcanlogin,
           pg_has_role('platform_app', 'rls_bypass', 'MEMBER') AS has_rls_bypass
    FROM pg_roles WHERE rolname = 'platform_app'
  `);
  assert.equal(rows.length, 1, "platform_app role must exist");
  assert.equal(rows[0].rolsuper, false, "platform_app must NOT be superuser");
  assert.equal(rows[0].rolbypassrls, false, "platform_app must NOT have BYPASSRLS");
  assert.equal(rows[0].rolcanlogin, true, "platform_app must have LOGIN");
  assert.equal(
    rows[0].has_rls_bypass,
    true,
    "platform_app must have rls_bypass membership for withSystemAdmin()"
  );
});

test("pgadmin_sysadmin retains rls_bypass membership (regression guard)", async () => {
  const { rows } = await pgClient.query(`
    SELECT pg_has_role('pgadmin_sysadmin', 'rls_bypass', 'MEMBER') AS has_rls_bypass
    FROM pg_roles WHERE rolname = 'pgadmin_sysadmin'
  `);
  assert.equal(rows.length, 1, "pgadmin_sysadmin must still exist");
  assert.equal(rows[0].has_rls_bypass, true, "pgadmin_sysadmin must retain rls_bypass");
});

test("RLS: platform_app sees only own-tenant memberships", async (t) => {
  if (!ALLOW_RESET) {
    t.skip("preserve mode — RLS isolation tests require clean DB state");
    return;
  }
  await resetDatabase();
  await runMigrations();

  await pgClient.query(
    "INSERT INTO organisations(id, slug, display_name) VALUES ($1,'rls-org-a','RLS Org A'),($2,'rls-org-b','RLS Org B')",
    [RLS_ORG_A, RLS_ORG_B]
  );
  await pgClient.query(
    "INSERT INTO users(id, email, display_name) VALUES ($1,'rls-a@test.local','RLS User A'),($2,'rls-b@test.local','RLS User B')",
    [RLS_USER_A, RLS_USER_B]
  );
  await pgClient.query(
    "INSERT INTO memberships(user_id, organisation_id, role) VALUES ($1,$2,'tenant-admin'),($3,$4,'tenant-admin')",
    [RLS_USER_A, RLS_ORG_A, RLS_USER_B, RLS_ORG_B]
  );

  const appClient = new pg.Client(POSTGRES_APP_URL);
  await appClient.connect();
  try {
    // Tenant A context: should see only Org A's membership
    await appClient.query("BEGIN");
    await appClient.query("SELECT set_config('app.current_tenant_id', $1, true)", [RLS_ORG_A]);
    const { rows: ownRows } = await appClient.query("SELECT organisation_id FROM memberships");
    assert.equal(ownRows.length, 1, "Should see exactly 1 row (own tenant)");
    assert.equal(ownRows[0].organisation_id, RLS_ORG_A, "Should see only Org A's row");
    await appClient.query("COMMIT");

    // Tenant B context: should see only Org B's membership
    await appClient.query("BEGIN");
    await appClient.query("SELECT set_config('app.current_tenant_id', $1, true)", [RLS_ORG_B]);
    const { rows: bRows } = await appClient.query("SELECT organisation_id FROM memberships");
    assert.equal(bRows.length, 1, "Should see exactly 1 row (Org B context)");
    assert.equal(bRows[0].organisation_id, RLS_ORG_B, "Should see only Org B's row");
    await appClient.query("COMMIT");

    // No tenant context: should see no rows
    await appClient.query("BEGIN");
    await appClient.query("SELECT set_config('app.current_tenant_id', '', true)", []);
    const { rows: noRows } = await appClient.query("SELECT 1 FROM memberships LIMIT 1");
    assert.equal(noRows.length, 0, "Without tenant context, RLS must hide all rows");
    await appClient.query("COMMIT");
  } finally {
    await appClient.end();
  }
});

test("RLS: platform_app cannot see another tenant's rows via forged current_tenant_id", async (t) => {
  if (!ALLOW_RESET) {
    t.skip("preserve mode — RLS isolation tests require clean DB state");
    return;
  }
  // Data from previous test still present (no resetDatabase between these tests).
  // Connect as platform_app, set tenant A context, attempt to read Org B rows.
  const appClient = new pg.Client(POSTGRES_APP_URL);
  await appClient.connect();
  try {
    await appClient.query("BEGIN");
    await appClient.query("SELECT set_config('app.current_tenant_id', $1, true)", [RLS_ORG_A]);
    const { rows } = await appClient.query(
      "SELECT organisation_id FROM memberships WHERE organisation_id = $1",
      [RLS_ORG_B]
    );
    assert.equal(rows.length, 0, "RLS must prevent seeing Org B rows when tenant context is Org A");
    await appClient.query("COMMIT");
  } finally {
    await appClient.end();
  }
});

test("RLS: SET LOCAL ROLE rls_bypass (withSystemAdmin path) sees all tenants", async (t) => {
  if (!ALLOW_RESET) {
    t.skip("preserve mode — RLS isolation tests require clean DB state (exactly 2 rows)");
    return;
  }
  // withSystemAdmin() uses SET LOCAL ROLE rls_bypass inside a transaction.
  // This changes current_user to 'rls_bypass' for the transaction lifetime,
  // satisfying the RLS policy's current_user = 'rls_bypass' bypass check.
  // After COMMIT/ROLLBACK, current_user reverts to platform_app automatically.
  const appClient = new pg.Client(POSTGRES_APP_URL);
  await appClient.connect();
  try {
    // Confirm platform_app is a member of rls_bypass (required for SET LOCAL ROLE)
    const { rows: memberCheck } = await appClient.query(
      "SELECT pg_has_role(current_user, 'rls_bypass', 'MEMBER') AS can_set_role"
    );
    assert.equal(
      memberCheck[0].can_set_role,
      true,
      "platform_app must be a rls_bypass member so SET LOCAL ROLE rls_bypass works"
    );

    // Simulate withSystemAdmin(): BEGIN; SET LOCAL ROLE rls_bypass; <work>; COMMIT
    await appClient.query("BEGIN");
    await appClient.query("SET LOCAL ROLE rls_bypass");
    assert.equal(
      (await appClient.query("SELECT current_user")).rows[0].current_user,
      "rls_bypass",
      "current_user must be rls_bypass after SET LOCAL ROLE"
    );
    const { rows: allRows } = await appClient.query(
      "SELECT organisation_id FROM memberships ORDER BY organisation_id"
    );
    assert.equal(allRows.length, 2, "withSystemAdmin path must see all tenant rows");
    await appClient.query("COMMIT");

    // After COMMIT, current_user reverts to platform_app (SET LOCAL is transaction-scoped)
    const { rows: afterCommit } = await appClient.query("SELECT current_user");
    assert.equal(
      afterCommit[0].current_user,
      "platform_app",
      "current_user must revert to platform_app after COMMIT"
    );
  } finally {
    await appClient.end();
  }
});
