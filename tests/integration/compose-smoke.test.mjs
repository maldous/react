/**
 * Compose service integration smoke tests.
 *
 * Prerequisites: `docker compose up -d` must be running.
 * Run with: npm run test:compose
 *
 * Uses npm clients for all data operations (pg, redis, @aws-sdk/client-s3,
 * nodemailer). Only Docker CLI is used for container health checks — there is
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
// Constants
// ---------------------------------------------------------------------------

const POSTGRES_URL = "postgresql://platform:platformpassword@localhost:5433/platform";
const REDIS_URL = "redis://localhost:6379";
const MINIO_ENDPOINT = "http://localhost:9000";
const CLICKHOUSE_HTTP = "http://localhost:8124";
const MAILPIT_API = "http://localhost:8025";
const OTEL_HTTP = "http://localhost:4318";

const smokeKey = `platform-smoke-${Date.now()}`;
const smokeBucket = `smoke-${Date.now()}`;

// ---------------------------------------------------------------------------
// Docker helper — only used for container health state checks
// ---------------------------------------------------------------------------

function dockerInspect(container, format) {
  const result = spawnSync("docker", ["inspect", container, "--format", format], {
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  return result.stdout.trim();
}

// ---------------------------------------------------------------------------
// Clients — declared here, connected in before()
// ---------------------------------------------------------------------------

const pgClient = new pg.Client(POSTGRES_URL);
const redisClient = createRedisClient({ url: REDIS_URL });
const s3 = new S3Client({
  endpoint: MINIO_ENDPOINT,
  region: "us-east-1",
  credentials: { accessKeyId: "minioadmin", secretAccessKey: "miniopassword" },
  forcePathStyle: true,
});
const smtp = nodemailer.createTransport({
  host: "localhost",
  port: 1025,
  secure: false,
  ignoreTLS: true,
});

before(async () => {
  await pgClient.connect();
  await redisClient.connect();
});

after(async () => {
  // Best-effort cleanup — individual tests clean up; this is a final safety net
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
// PostgreSQL (pg client → localhost:5433)
// ---------------------------------------------------------------------------

test("postgres: container is healthy", () => {
  const status = dockerInspect("react-platform-postgres-1", "{{.State.Health.Status}}");
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
// Redis (redis npm client → localhost:6379)
// ---------------------------------------------------------------------------

test("redis: container is healthy", () => {
  const status = dockerInspect("react-platform-redis-1", "{{.State.Health.Status}}");
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
// ClickHouse (fetch → localhost:8124)
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
  const status = dockerInspect("react-platform-clickhouse-1", "{{.State.Health.Status}}");
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
// MinIO (@aws-sdk/client-s3 → localhost:9000)
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
// Mailpit (nodemailer SMTP + fetch API → localhost:1025 / localhost:8025)
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
  assert.ok(data.total >= 1, `Expected ≥1 message for subject "${subject}", got ${data.total}`);
});

// ---------------------------------------------------------------------------
// OpenTelemetry Collector (fetch → localhost:4318)
// ---------------------------------------------------------------------------

test("otel-collector: container is running", () => {
  const status = dockerInspect("react-platform-otel-collector-1", "{{.State.Status}}");
  assert.equal(status, "running");
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
