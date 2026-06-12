/**
 * Unit tests for ADR-ACT-0228 / ADR-ACT-0235 — platform operations service readiness.
 * Pure-ish: registry + probe classification with injected probes (no real network/DB).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SERVICE_REGISTRY,
  buildServiceSummaries,
  buildWorkerSummaries,
  buildPlatformServicesReadiness,
  consoleAccessFor,
  type PlatformProbeDeps,
  type HttpProbeResult,
} from "../../src/usecases/platform-services.ts";
import { CLICKTHROUGH_SERVICES } from "../../src/usecases/service-clickthrough.ts";
import type { WorkerHeartbeat } from "../../src/server/worker-registry.ts";

const NOW = new Date("2026-06-12T12:00:00.000Z");
const ENV = { PLATFORM_ENV: "test", GIT_SHA: "abc123" } as NodeJS.ProcessEnv;

const ok = (body = ""): HttpProbeResult => ({ statusCode: 200, body });

function deps(over: Partial<PlatformProbeDeps> = {}): PlatformProbeDeps {
  return {
    httpProbe: async () => ok(),
    pgProbe: async () => true,
    redisConfigured: () => true,
    viewerIsSystemAdmin: true,
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
    const down = await buildServiceSummaries(deps({ httpProbe: async () => null }));
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
    // a console service is a localhost URL (system-admin viewer)
    assert.match(all.find((s) => s.key === "grafana")?.consoleUrl ?? "", /^http:\/\/localhost:/);
  });
});

describe("health semantics — a response is NOT automatically healthy (ADR-ACT-0235)", () => {
  it("an HTTP 500 is degraded, never healthy", async () => {
    const r = await buildServiceSummaries(
      deps({ httpProbe: async () => ({ statusCode: 500, body: "boom" }) })
    );
    for (const key of ["loki", "grafana", "clickhouse", "minio", "mailpit"]) {
      assert.equal(r.find((s) => s.key === key)?.status, "degraded", key);
    }
  });

  it("an HTTP 503 is degraded; a network error is unreachable", async () => {
    const degraded = await buildServiceSummaries(
      deps({ httpProbe: async () => ({ statusCode: 503, body: "" }) })
    );
    assert.equal(degraded.find((s) => s.key === "sonarqube")?.status, "degraded");
    const dead = await buildServiceSummaries(deps({ httpProbe: async () => null }));
    assert.equal(dead.find((s) => s.key === "sonarqube")?.status, "unreachable");
  });

  it("Grafana /api/health with a failing database is degraded even on 200", async () => {
    const r = await buildServiceSummaries(
      deps({ httpProbe: async () => ok(JSON.stringify({ database: "failing", version: "x" })) })
    );
    assert.equal(r.find((s) => s.key === "grafana")?.status, "degraded");
    const okDb = await buildServiceSummaries(
      deps({ httpProbe: async () => ok(JSON.stringify({ database: "ok" })) })
    );
    assert.equal(okDb.find((s) => s.key === "grafana")?.status, "healthy");
  });

  it("LocalStack 200 with a failed service in the body is degraded", async () => {
    const body = JSON.stringify({ services: { s3: "running", sqs: "error" } });
    const r = await buildServiceSummaries(deps({ httpProbe: async () => ok(body) }));
    assert.equal(r.find((s) => s.key === "localstack")?.status, "degraded");
    const fine = JSON.stringify({ services: { s3: "running", sqs: "available" } });
    const r2 = await buildServiceSummaries(deps({ httpProbe: async () => ok(fine) }));
    assert.equal(r2.find((s) => s.key === "localstack")?.status, "healthy");
  });

  it("an unparseable 2xx body does not crash classification (stays healthy)", async () => {
    const r = await buildServiceSummaries(deps({ httpProbe: async () => ok("<html>") }));
    assert.equal(r.find((s) => s.key === "grafana")?.status, "healthy");
    assert.equal(r.find((s) => s.key === "localstack")?.status, "healthy");
  });
});

describe("console-link exposure follows the clickthrough policy (ADR-ACT-0233/0235)", () => {
  it("tenant-admin viewers NEVER receive pgAdmin/MinIO/Grafana/Mailpit/ClickHouse/Sonar console links", async () => {
    const tenant = await buildServiceSummaries(deps({ viewerIsSystemAdmin: false }));
    for (const key of ["pgadmin", "minio", "grafana", "mailpit", "clickhouse", "sonarqube"]) {
      const svc = tenant.find((s) => s.key === key);
      assert.equal(svc?.consoleUrl, null, `${key} console link must be withheld`);
      assert.equal(svc?.consoleAccess, "global_only", key);
    }
    // web_caddy (apex super-admin app) is also operator-only.
    assert.equal(tenant.find((s) => s.key === "web_caddy")?.consoleUrl, null);
  });

  it("tenant-admin viewers still get the tenant-safe Keycloak link", async () => {
    const tenant = await buildServiceSummaries(deps({ viewerIsSystemAdmin: false }));
    const kc = tenant.find((s) => s.key === "keycloak");
    assert.equal(kc?.consoleAccess, "tenant_safe");
    assert.match(kc?.consoleUrl ?? "", /^http:\/\/localhost:\d+\/kc$/);
  });

  it("system-admin viewers get global-only console links", async () => {
    const sys = await buildServiceSummaries(deps({ viewerIsSystemAdmin: true }));
    for (const key of ["pgadmin", "minio", "grafana"]) {
      assert.match(sys.find((s) => s.key === key)?.consoleUrl ?? "", /^http:\/\/localhost:/, key);
    }
  });

  it("not-exposed services (WireMock) never carry a console link, even for system-admin", async () => {
    const sys = await buildServiceSummaries(deps({ viewerIsSystemAdmin: true }));
    const wm = sys.find((s) => s.key === "wiremock");
    assert.equal(wm?.consoleAccess, "not_exposed");
    assert.equal(wm?.consoleUrl, null);
  });

  it("registry classifications mirror the ADR-ACT-0233 policy module (single source of truth)", () => {
    const policy = new Map(CLICKTHROUGH_SERVICES.map((s) => [s.id, s.classification]));
    for (const def of SERVICE_REGISTRY) {
      const expected = policy.get(def.key);
      if (!expected) continue; // cockpit-only services (postgres/redis/loki/…) fall back closed
      const projected = expected === "tenant_scoped_safe" ? "tenant_safe" : (expected as string);
      assert.equal(consoleAccessFor(def), projected, def.key);
    }
    // Fail-closed default for services outside the policy without an explicit fallback.
    assert.equal(consoleAccessFor({ key: "postgres" }), "not_exposed");
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
