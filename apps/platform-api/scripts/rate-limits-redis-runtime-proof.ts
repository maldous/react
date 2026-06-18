/**
 * Redis rate-limit provider LIVE proof (ADR-0065 / ADR-ACT-0263 — Phase 3.5).
 *
 * Proves the RedisRateLimitRepository against the local Compose Redis + Postgres:
 *  - policy definitions stay durable in Postgres (delegate); counting is in Redis;
 *  - allow below the limit, deny above it within the fixed window (Redis counter);
 *  - per-tenant isolation: orgA and orgB use distinct Redis keys, counts independent;
 *  - the fixed window resets in a new bucket and Redis sets a self-expiring TTL;
 *  - no secret-bearing Redis keys or values (counts are integers);
 *  - readiness reports `ready` when Redis answers PING;
 *  - Redis unavailable reports `degraded` AND the Postgres fallback still counts
 *    (the limiter degrades, never fails open, never fakes readiness).
 *
 * Requires BOTH Postgres and Redis. SKIPs honestly (exit 0) if either is
 * unavailable; never fake-PASSes.
 *
 * Usage: npm run proof:rate-limits-redis   (requires `make compose-up-default`)
 */

import pg from "pg";
import { loadLocalEnv, requireEnv } from "./lib/local-env.ts";
import { createRedisClient } from "@platform/adapters-redis";
import type { AuditEvent, AuditEventPort } from "@platform/audit-events";
import { PostgresRateLimitRepository } from "../src/adapters/postgres-rate-limit-repository.ts";
import { PostgresEntitlementRepository } from "../src/adapters/postgres-entitlement-repository.ts";
import { RedisRateLimitRepository } from "../src/adapters/redis-rate-limit-repository.ts";
import { evaluateRateLimit, setRateLimit } from "../src/usecases/rate-limits.ts";

loadLocalEnv();
const SU_URL = requireEnv("POSTGRES_URL");
const APP_URL = requireEnv("POSTGRES_APP_URL");
const REDIS_URL = process.env["REDIS_URL"] ?? "redis://localhost:6379";
const SECRET_FIELD = /secret|password|token|credential|api[_-]?key|private[_-]?key/i;
const ACTOR = { actorId: "00000000-0000-0000-0000-000000000000", actorRoles: ["system-admin"] };

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}` + (detail ? ` — ${detail}` : ""));
  if (!ok) failures++;
}
function capturingAudit(): { port: AuditEventPort; events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  return {
    events,
    port: {
      emit: async (e) => {
        events.push(e);
      },
      query: async () => events,
    },
  };
}
async function pgReachable(url: string): Promise<boolean> {
  const p = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 2000, max: 1 });
  try {
    await p.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await p.end().catch(() => {});
  }
}
async function redisReachable(url: string): Promise<boolean> {
  const c = createRedisClient(url);
  try {
    await c.connect();
    await c.ping();
    return true;
  } catch {
    return false;
  } finally {
    await c.quit().catch(() => {});
  }
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  console.log("# Redis rate-limit provider LIVE proof\n");
  const [pgOk, redisOk] = await Promise.all([pgReachable(APP_URL), redisReachable(REDIS_URL)]);
  if (!pgOk || !redisOk) {
    const missing = [!pgOk ? "Postgres" : null, !redisOk ? "Redis" : null]
      .filter(Boolean)
      .join(" + ");
    console.log(
      `SKIP  rate-limits-redis proof — ${missing} not reachable (run \`make compose-up-default\`)`
    );
    console.log("\n# SKIPPED (no live backend) — not counted as pass or fail");
    process.exit(0);
  }

  const su = new pg.Pool({ connectionString: SU_URL });
  const app = new pg.Pool({ connectionString: APP_URL });
  const redis = createRedisClient(REDIS_URL);
  await redis.connect();

  const durable = new PostgresRateLimitRepository(app);
  const entitlements = new PostgresEntitlementRepository(app);
  const audit = capturingAudit();
  const redisRepo = new RedisRateLimitRepository(redis, durable, { warn: () => {} });
  const deps = { rateLimits: redisRepo, entitlements, audit: audit.port };

  let orgA: string | null = null;
  let orgB: string | null = null;
  const keyTouched: string[] = [];

  try {
    // Fresh orgs so prior runs never pollute the Redis counter buckets.
    orgA = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        ["proof-rlr-a-" + Date.now().toString(36), "Proof RLR A"]
      )
    ).rows[0]!.id;
    orgB = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        ["proof-rlr-b-" + Date.now().toString(36), "Proof RLR B"]
      )
    ).rows[0]!.id;

    for (const org of [orgA, orgB]) {
      await entitlements.upsert({
        organisationId: org,
        entitlementKey: "api_access",
        state: "granted",
        source: "system",
        updatedBy: "op",
      });
      await setRateLimit(
        {
          organisationId: org,
          policyKey: "api.requests",
          entitlementKey: "api_access",
          limit: 2,
          windowSeconds: 3600,
          actor: ACTOR,
        },
        deps
      );
    }

    // readiness: ready when Redis answers PING
    const ready = await redisRepo.readiness();
    check(
      "readiness reports ready when Redis is reachable",
      ready.status === "ready",
      ready.detail
    );

    // allow / allow / deny via the Redis counter (limit = 2)
    const a1 = await evaluateRateLimit(orgA, "api.requests", deps);
    const a2 = await evaluateRateLimit(orgA, "api.requests", deps);
    const a3 = await evaluateRateLimit(orgA, "api.requests", deps);
    check("first request allowed (below limit, Redis counter)", a1.allowed && a1.used === 1);
    check("second request allowed (at limit, Redis counter)", a2.allowed && a2.used === 2);
    check(
      "third request denied (above limit, Redis counter)",
      !a3.allowed && a3.state === "exceeded" && a3.used === 3
    );

    // tenant isolation: orgB counts independently from orgA
    const b1 = await evaluateRateLimit(orgB, "api.requests", deps);
    check(
      "orgB counter is independent of orgA (tenant-isolated Redis keys)",
      b1.allowed && b1.used === 1
    );

    // counter keys are tenant-prefixed and carry no secrets / non-integer values
    const aKeys = await redis.keys(`rl:${orgA}:*`);
    const bKeys = await redis.keys(`rl:${orgB}:*`);
    keyTouched.push(...aKeys, ...bKeys);
    check(
      "orgA Redis counter key exists and is tenant-prefixed",
      aKeys.length >= 1 && aKeys.every((k) => k.startsWith(`rl:${orgA}:`))
    );
    check("no orgA key leaks into orgB's namespace", !bKeys.some((k) => k.includes(orgA!)));
    check(
      "no secret-bearing Redis keys",
      !aKeys.some((k) => SECRET_FIELD.test(k)) && !bKeys.some((k) => SECRET_FIELD.test(k))
    );
    let valuesAreIntegers = true;
    for (const k of aKeys) {
      const v = await redis.get(k);
      if (v == null || !/^\d+$/.test(v)) valuesAreIntegers = false;
    }
    check("Redis counter values are plain integers (no secrets)", valuesAreIntegers);

    // self-expiring TTL applied to the counter bucket
    const ttl = aKeys.length ? await redis.ttl(aKeys[0]!) : -2;
    check("counter bucket has a self-expiring TTL", ttl > 0, `ttl=${ttl}s`);

    // fixed-window reset: short window, count resets in the next bucket
    const winKey = "api.window-test";
    await durable.upsert({
      organisationId: orgA,
      policyKey: winKey,
      entitlementKey: "api_access",
      limit: 100,
      windowSeconds: 1,
      action: "deny",
      updatedBy: "op",
    });
    const w1 = await redisRepo.incrementAndCount(orgA, winKey, 1);
    await sleep(1200); // cross at least one 1-second window boundary
    const w2 = await redisRepo.incrementAndCount(orgA, winKey, 1);
    keyTouched.push(...(await redis.keys(`rl:${orgA}:count:${winKey}:*`)));
    check("fixed window resets in the next bucket", w1 === 1 && w2 === 1, `w1=${w1} w2=${w2}`);

    // ── degraded path: Redis unavailable → degraded readiness + Postgres fallback ──
    const failing = {
      eval: async () => {
        throw new Error("redis down");
      },
      get: async () => {
        throw new Error("redis down");
      },
      ping: async () => {
        throw new Error("redis down");
      },
    } as never;
    const downRepo = new RedisRateLimitRepository(failing, durable, { warn: () => {} });
    const downReady = await downRepo.readiness();
    check(
      "Redis-unavailable readiness reports degraded",
      downReady.status === "degraded",
      downReady.detail
    );

    const fb1 = await downRepo.incrementAndCount(orgB, "api.fallback", 3600);
    const durableCount = await durable.currentCount(orgB, "api.fallback", 3600);
    check(
      "Postgres fallback remains valid when Redis is down",
      fb1 === 1 && durableCount === 1,
      `fallback=${fb1} durable=${durableCount}`
    );
  } catch (err) {
    check("live redis rate-limit proof", false, err instanceof Error ? err.message : String(err));
  } finally {
    if (keyTouched.length) await redis.del(keyTouched).catch(() => {});
    if (orgA)
      await su.query("DELETE FROM public.organisations WHERE id=$1", [orgA]).catch(() => {});
    if (orgB)
      await su.query("DELETE FROM public.organisations WHERE id=$1", [orgB]).catch(() => {});
    await redis.quit().catch(() => {});
    await app.end().catch(() => {});
    await su.end().catch(() => {});
  }

  console.log(
    failures === 0
      ? "\n# ALL CHECKS PASSED (live Redis + Postgres)"
      : `\n# ${failures} CHECK(S) FAILED`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("proof failed:", err);
  process.exit(1);
});
