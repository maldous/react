import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RedisSessionStore, RedisAuthStateStore } from "../src/index.ts";
import type { CreateSessionCommand } from "@platform/session-runtime";

// ---------------------------------------------------------------------------
// Minimal fake Redis client for unit tests — no real Redis required
// ---------------------------------------------------------------------------

function makeFakeRedis(): {
  store: Map<string, { value: string; expiresAt: number }>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: { EX?: number }): Promise<void>;
  getDel(key: string): Promise<string | null>;
  del(key: string): Promise<void>;
  expire(key: string, seconds: number): Promise<void>;
} {
  const store = new Map<string, { value: string; expiresAt: number }>();
  const now = () => Date.now();

  function isAlive(entry: { value: string; expiresAt: number }): boolean {
    return entry.expiresAt > now();
  }

  return {
    store,
    async get(key) {
      const entry = store.get(key);
      if (!entry || !isAlive(entry)) return null;
      return entry.value;
    },
    async set(key, value, opts) {
      const ttlMs = (opts?.EX ?? 3600) * 1000;
      store.set(key, { value, expiresAt: now() + ttlMs });
    },
    async getDel(key) {
      const entry = store.get(key);
      if (!entry || !isAlive(entry)) return null;
      store.delete(key);
      return entry.value;
    },
    async del(key) {
      store.delete(key);
    },
    async expire(key, seconds) {
      const entry = store.get(key);
      if (entry) store.set(key, { value: entry.value, expiresAt: now() + seconds * 1000 });
    },
  };
}

// ---------------------------------------------------------------------------
// RedisSessionStore tests
// ---------------------------------------------------------------------------

describe("RedisSessionStore", () => {
  const command: CreateSessionCommand = {
    userId: "user-1",
    tenantId: "org-1",
    organisationId: "org-1",
    roles: ["tenant-admin"],
    permissions: ["organisation.read", "organisation.update"],
    displayName: "Test User",
    ttlSeconds: 1800,
  };

  it("create returns a sessionId", async () => {
    const redis = makeFakeRedis();
    const store = new RedisSessionStore(redis as never);
    const sessionId = await store.create(command);
    assert.ok(typeof sessionId === "string");
    assert.ok(sessionId.length > 0);
    assert.match(sessionId, /^[0-9a-f-]{36}$/);
  });

  it("find returns the session record after create", async () => {
    const redis = makeFakeRedis();
    const store = new RedisSessionStore(redis as never);
    const sessionId = await store.create(command);
    const record = await store.find(sessionId);
    assert.ok(record !== null);
    assert.equal(record.sessionId, sessionId);
    assert.equal(record.userId, "user-1");
    assert.equal(record.tenantId, "org-1");
    assert.deepEqual(record.roles, ["tenant-admin"]);
    assert.deepEqual(record.permissions, ["organisation.read", "organisation.update"]);
    assert.equal(record.displayName, "Test User");
    assert.ok(record.expiresAt instanceof Date);
    assert.ok(record.createdAt instanceof Date);
  });

  it("find returns null for unknown sessionId", async () => {
    const redis = makeFakeRedis();
    const store = new RedisSessionStore(redis as never);
    const result = await store.find("does-not-exist");
    assert.equal(result, null);
  });

  it("destroy removes the session", async () => {
    const redis = makeFakeRedis();
    const store = new RedisSessionStore(redis as never);
    const sessionId = await store.create(command);
    await store.destroy(sessionId);
    const result = await store.find(sessionId);
    assert.equal(result, null);
  });

  it("refresh extends expiry without changing value", async () => {
    const redis = makeFakeRedis();
    const store = new RedisSessionStore(redis as never);
    const sessionId = await store.create(command);
    await store.refresh(sessionId, 3600);
    const record = await store.find(sessionId);
    assert.ok(record !== null);
    assert.equal(record.userId, "user-1");
  });

  it("uses key prefix for isolation", async () => {
    const redis = makeFakeRedis();
    const store = new RedisSessionStore(redis as never, "session:");
    const sessionId = await store.create(command);
    assert.ok(redis.store.has("session:" + sessionId));
  });

  it("stores session data without raw tokens", async () => {
    const redis = makeFakeRedis();
    const store = new RedisSessionStore(redis as never);
    const sessionId = await store.create(command);
    const raw = redis.store.get("session:" + sessionId)?.value ?? "";
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    assert.ok(!("accessToken" in parsed));
    assert.ok(!("refreshToken" in parsed));
    assert.ok("userId" in parsed);
    assert.ok("permissions" in parsed);
  });
});

// ---------------------------------------------------------------------------
// RedisAuthStateStore tests
// ---------------------------------------------------------------------------

describe("RedisAuthStateStore", () => {
  it("put stores the state and take retrieves it", async () => {
    const redis = makeFakeRedis();
    const store = new RedisAuthStateStore(redis as never);
    await store.put("state-abc", {
      codeVerifier: "verifier123",
      returnTo: "/dashboard",
      nonce: "nonce-abc",
    });
    const result = await store.take("state-abc");
    assert.ok(result !== null);
    assert.equal(result.codeVerifier, "verifier123");
    assert.equal(result.returnTo, "/dashboard");
  });

  it("take is consume-once: second take returns null", async () => {
    const redis = makeFakeRedis();
    const store = new RedisAuthStateStore(redis as never);
    await store.put("state-xyz", { codeVerifier: "v", returnTo: "/", nonce: "n1" });
    await store.take("state-xyz");
    const second = await store.take("state-xyz");
    assert.equal(second, null);
  });

  it("take returns null for unknown state", async () => {
    const redis = makeFakeRedis();
    const store = new RedisAuthStateStore(redis as never);
    const result = await store.take("nonexistent");
    assert.equal(result, null);
  });

  it("uses key prefix for isolation from sessions", async () => {
    const redis = makeFakeRedis();
    const store = new RedisAuthStateStore(redis as never, "auth_state:");
    await store.put("s1", { codeVerifier: "cv", returnTo: "/", nonce: "n2" });
    assert.ok(redis.store.has("auth_state:s1"));
    assert.ok(!redis.store.has("session:s1"));
  });
});
