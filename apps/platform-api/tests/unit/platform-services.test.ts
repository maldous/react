/**
 * Unit tests for ADR-ACT-0228 — platform operations service readiness.
 * Pure-ish: registry + probe classification with injected probes (no real network/DB).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SERVICE_REGISTRY,
  buildServiceSummaries,
  buildWorkerSummaries,
  buildPlatformServicesReadiness,
  type PlatformProbeDeps,
} from "../../src/usecases/platform-services.ts";
import type { WorkerHeartbeat } from "../../src/server/worker-registry.ts";

const NOW = new Date("2026-06-12T12:00:00.000Z");
const ENV = { PLATFORM_ENV: "test", GIT_SHA: "abc123" } as NodeJS.ProcessEnv;

function deps(over: Partial<PlatformProbeDeps> = {}): PlatformProbeDeps {
  return {
    httpProbe: async () => true,
    pgProbe: async () => true,
    redisConfigured: () => true,
    env: ENV,
    now: NOW,
    ...over,
  };
}

describe("buildServiceSummaries (ADR-ACT-0228)", () => {
  it("classifies postgres via pgProbe and http services via httpProbe", async () => {
    const healthy = await buildServiceSummaries(deps());
    const pg = healthy.find((s) => s.key === "postgres");
    const grafana = healthy.find((s) => s.key === "grafana");
    assert.equal(pg?.status, "healthy");
    assert.equal(grafana?.status, "healthy");
    // every registry service is represented
    assert.equal(healthy.length, SERVICE_REGISTRY.length);
    // checkedAt is stamped from the injected clock
    assert.equal(grafana?.checkedAt, NOW.toISOString());
  });

  it("a down http service is unreachable (never faked healthy)", async () => {
    const down = await buildServiceSummaries(deps({ httpProbe: async () => false }));
    assert.equal(down.find((s) => s.key === "loki")?.status, "unreachable");
    // postgres still healthy (separate probe)
    assert.equal(down.find((s) => s.key === "postgres")?.status, "healthy");
  });

  it("redis is configured (structural) when wired, not_configured otherwise", async () => {
    const on = await buildServiceSummaries(deps({ redisConfigured: () => true }));
    const off = await buildServiceSummaries(deps({ redisConfigured: () => false }));
    assert.equal(on.find((s) => s.key === "redis")?.status, "configured");
    assert.equal(off.find((s) => s.key === "redis")?.status, "not_configured");
  });

  it("exposes only safe localhost console URLs (or null), all local-only", async () => {
    const all = await buildServiceSummaries(deps());
    for (const s of all) {
      assert.equal(s.localOnly, true);
      if (s.consoleUrl !== null) {
        assert.match(s.consoleUrl, /^http:\/\/localhost:/);
      }
    }
    // a console-less service is null (e.g. redis/otel/loki)
    assert.equal(all.find((s) => s.key === "loki")?.consoleUrl, null);
    // a console service is a localhost URL
    assert.match(all.find((s) => s.key === "grafana")?.consoleUrl ?? "", /^http:\/\/localhost:/);
  });
});

describe("buildWorkerSummaries (ADR-ACT-0228)", () => {
  const hb = (status: WorkerHeartbeat["status"]): WorkerHeartbeat => ({
    lastTickAt: NOW.toISOString(),
    lastError: null,
    status,
  });

  it("reflects the in-memory heartbeat status when enabled", () => {
    const w = buildWorkerSummaries((k) => (k === "webhook-delivery" ? hb("idle") : null), ENV);
    assert.equal(w[0]?.key, "webhook-delivery");
    assert.equal(w[0]?.status, "idle");
    assert.equal(w[0]?.enabled, true);
    assert.equal(w[0]?.inMemory, true);
  });

  it("is stopped when WEBHOOK_WORKER_DISABLED=true", () => {
    const w = buildWorkerSummaries(() => null, { ...ENV, WEBHOOK_WORKER_DISABLED: "true" });
    assert.equal(w[0]?.status, "stopped");
    assert.equal(w[0]?.enabled, false);
  });

  it("is unknown with no heartbeat yet", () => {
    assert.equal(buildWorkerSummaries(() => null, ENV)[0]?.status, "unknown");
  });
});

describe("buildPlatformServicesReadiness (ADR-ACT-0228)", () => {
  it("returns environment + version + services + workers (no secret fields)", async () => {
    const r = await buildPlatformServicesReadiness({ ...deps(), getHeartbeat: () => null });
    assert.equal(r.environment, "test");
    assert.equal(r.appVersion, "abc123");
    assert.ok(r.services.length > 0 && r.workers.length > 0);
    // defence-in-depth: no secret-ish keys leaked in the payload
    const blob = JSON.stringify(r);
    assert.ok(!/secret|password|dsn|token/i.test(blob));
  });
});
