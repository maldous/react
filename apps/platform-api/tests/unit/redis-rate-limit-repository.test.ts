import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { RedisClientType } from "redis";
import { RedisRateLimitRepository } from "../../src/adapters/redis-rate-limit-repository.ts";
import type {
  RateLimitPolicyRecord,
  RateLimitRepository,
  UpsertRateLimitInput,
} from "../../src/ports/rate-limit-repository.ts";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";

// In-memory durable delegate that records its own counter state separately from
// Redis, so we can prove the Redis path increments in Redis and the fallback path
// increments in the delegate.
function fakeDelegate(initial?: RateLimitPolicyRecord): RateLimitRepository & {
  delegateCounters: Map<string, number>;
} {
  let row = initial ?? null;
  const delegateCounters = new Map<string, number>();
  return {
    delegateCounters,
    getByKey: async (_o, k) => (row && row.policyKey === k ? row : null),
    listForTenant: async () => (row ? [row] : []),
    listForTenantAsOperator: async () => (row ? [row] : []),
    upsert: async (i: UpsertRateLimitInput) => {
      row = {
        policyKey: i.policyKey,
        entitlementKey: i.entitlementKey,
        limit: i.limit,
        windowSeconds: i.windowSeconds,
        action: i.action,
        updatedAt: null,
        updatedBy: i.updatedBy,
      };
    },
    incrementAndCount: async (o, k) => {
      const key = `${o}:${k}`;
      const c = (delegateCounters.get(key) ?? 0) + 1;
      delegateCounters.set(key, c);
      return c;
    },
    currentCount: async (o, k) => delegateCounters.get(`${o}:${k}`) ?? 0,
  };
}

// Fake redis client implementing just the surface the adapter uses, with a
// `down` switch to simulate an unreachable backend.
function fakeRedis(): {
  client: RedisClientType;
  store: Map<string, number>;
  ttls: Map<string, number>;
  setDown: (d: boolean) => void;
} {
  const store = new Map<string, number>();
  const ttls = new Map<string, number>();
  let down = false;
  const client = {
    eval: async (_script: string, opts: { keys: string[]; arguments: string[] }) => {
      if (down) throw new Error("redis down");
      const key = opts.keys[0]!;
      const c = (store.get(key) ?? 0) + 1;
      store.set(key, c);
      if (c === 1) ttls.set(key, Number(opts.arguments[0]));
      return c;
    },
    get: async (key: string) => {
      if (down) throw new Error("redis down");
      return store.has(key) ? String(store.get(key)) : null;
    },
    ping: async () => {
      if (down) throw new Error("redis down");
      return "PONG";
    },
  } as unknown as RedisClientType;
  return { client, store, ttls, setDown: (d: boolean) => (down = d) };
}

const POLICY: RateLimitPolicyRecord = {
  policyKey: "api.requests",
  entitlementKey: "api_access",
  limit: 2,
  windowSeconds: 60,
  action: "deny",
  updatedAt: null,
  updatedBy: "op",
};

describe("RedisRateLimitRepository", () => {
  it("delegates policy CRUD to the durable store of record", async () => {
    const delegate = fakeDelegate(POLICY);
    const { client } = fakeRedis();
    const repo = new RedisRateLimitRepository(client, delegate);

    assert.deepEqual(await repo.getByKey(ORG_A, "api.requests"), POLICY);
    assert.equal((await repo.listForTenant(ORG_A)).length, 1);
    assert.equal((await repo.listForTenantAsOperator(ORG_A)).length, 1);
    await repo.upsert({
      organisationId: ORG_A,
      policyKey: POLICY.policyKey,
      entitlementKey: POLICY.entitlementKey,
      limit: POLICY.limit,
      windowSeconds: POLICY.windowSeconds,
      action: POLICY.action,
      updatedBy: "op",
    });
    assert.equal((await repo.getByKey(ORG_A, "api.requests"))?.limit, 2);
  });

  it("increments the counter in Redis under a tenant-prefixed key", async () => {
    const delegate = fakeDelegate(POLICY);
    const fr = fakeRedis();
    const repo = new RedisRateLimitRepository(fr.client, delegate);

    assert.equal(await repo.incrementAndCount(ORG_A, "api.requests", 60), 1);
    assert.equal(await repo.incrementAndCount(ORG_A, "api.requests", 60), 2);
    // count lives in Redis, NOT in the durable delegate
    assert.equal(delegate.delegateCounters.size, 0);
    const keys = [...fr.store.keys()];
    assert.equal(keys.length, 1);
    assert.match(keys[0]!, new RegExp(`^rl:${ORG_A}:count:api\\.requests:\\d+$`));
  });

  it("isolates tenants in distinct Redis keys", async () => {
    const fr = fakeRedis();
    const repo = new RedisRateLimitRepository(fr.client, fakeDelegate(POLICY));
    await repo.incrementAndCount(ORG_A, "api.requests", 60);
    await repo.incrementAndCount(ORG_A, "api.requests", 60);
    assert.equal(await repo.incrementAndCount(ORG_B, "api.requests", 60), 1);
    const keys = [...fr.store.keys()];
    assert.ok(keys.some((k) => k.startsWith(`rl:${ORG_A}:`)));
    assert.ok(keys.some((k) => k.startsWith(`rl:${ORG_B}:`)));
    assert.ok(!keys.some((k) => k.startsWith(`rl:${ORG_A}:`) && k.includes(ORG_B)));
  });

  it("sets a self-expiring TTL only on the first hit of a window", async () => {
    const fr = fakeRedis();
    const repo = new RedisRateLimitRepository(fr.client, fakeDelegate(POLICY));
    await repo.incrementAndCount(ORG_A, "api.requests", 60);
    await repo.incrementAndCount(ORG_A, "api.requests", 60);
    const ttls = [...fr.ttls.values()];
    assert.equal(ttls.length, 1);
    assert.equal(ttls[0], 61); // windowSeconds + 1
  });

  it("currentCount reads Redis without incrementing", async () => {
    const fr = fakeRedis();
    const repo = new RedisRateLimitRepository(fr.client, fakeDelegate(POLICY));
    await repo.incrementAndCount(ORG_A, "api.requests", 60);
    await repo.incrementAndCount(ORG_A, "api.requests", 60);
    assert.equal(await repo.currentCount(ORG_A, "api.requests", 60), 2);
    assert.equal(await repo.currentCount(ORG_A, "api.requests", 60), 2);
    assert.equal(await repo.currentCount(ORG_A, "missing", 60), 0);
  });

  it("falls back to the durable delegate when Redis is down (degraded, not failing open)", async () => {
    const delegate = fakeDelegate(POLICY);
    const fr = fakeRedis();
    fr.setDown(true);
    const repo = new RedisRateLimitRepository(fr.client, delegate);

    assert.equal(await repo.incrementAndCount(ORG_A, "api.requests", 60), 1);
    assert.equal(await repo.incrementAndCount(ORG_A, "api.requests", 60), 2);
    assert.equal(await repo.currentCount(ORG_A, "api.requests", 60), 2);
    // count went to the durable delegate, not Redis
    assert.equal(fr.store.size, 0);
    assert.equal(delegate.delegateCounters.get(`${ORG_A}:api.requests`), 2);
  });

  it("rethrows on Redis error when fallback is disabled", async () => {
    const fr = fakeRedis();
    fr.setDown(true);
    const repo = new RedisRateLimitRepository(fr.client, fakeDelegate(POLICY), {
      fallbackToDelegate: false,
    });
    await assert.rejects(() => repo.incrementAndCount(ORG_A, "api.requests", 60));
  });

  it("readiness is ready on PONG and degraded when Redis is unreachable", async () => {
    const fr = fakeRedis();
    const repo = new RedisRateLimitRepository(fr.client, fakeDelegate(POLICY));
    assert.equal((await repo.readiness()).status, "ready");
    fr.setDown(true);
    const degraded = await repo.readiness();
    assert.equal(degraded.status, "degraded");
    assert.match(degraded.detail, /fallback/i);
  });
});
