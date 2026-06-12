/**
 * Unit tests for ADR-ACT-0228 / ADR-ACT-0235 / ADR-ACT-0236 — platform operations
 * service readiness. Pure-ish: registry + probe classification + host-authority
 * decisions with injected probes (no real network/DB).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SERVICE_REGISTRY,
  buildServiceSummaries,
  buildWorkerSummaries,
  buildPlatformServicesReadiness,
  consoleAccessFor,
  resolveReadinessAccess,
  type PlatformProbeDeps,
  type HttpProbeResult,
} from "../../src/usecases/platform-services.ts";
import { CLICKTHROUGH_SERVICES } from "../../src/usecases/service-clickthrough.ts";
import type { WorkerHeartbeat } from "../../src/server/worker-registry.ts";

const NOW = new Date("2026-06-12T12:00:00.000Z");
const ENV = { PLATFORM_ENV: "test", GIT_SHA: "abc123" } as NodeJS.ProcessEnv;

// One body that satisfies every structured check (grafana database, localstack
// services, sonar status, keycloak issuer) — lets generic tests stay healthy.
const HEALTHY_BODY = JSON.stringify({
  status: "UP",
  database: "ok",
  issuer: "http://localhost:8090/kc/realms/master",
  services: { s3: "running" },
});
const ok = (body = HEALTHY_BODY): HttpProbeResult => ({ statusCode: 200, body });

function deps(over: Partial<PlatformProbeDeps> = {}): PlatformProbeDeps {
  return {
    httpProbe: async () => ok(),
    pgProbe: async () => true,
    redisConfigured: () => true,
    viewerMode: "system_operator",
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

  it("redis stays structural: configured when wired (never healthy), not_configured otherwise", async () => {
    const on = await buildServiceSummaries(deps({ redisConfigured: () => true }));
    const off = await buildServiceSummaries(deps({ redisConfigured: () => false }));
    assert.equal(on.find((s) => s.key === "redis")?.status, "configured");
    assert.equal(off.find((s) => s.key === "redis")?.status, "not_configured");
    // The structural caveat is surfaced to the UI via the detail key.
    assert.equal(
      on.find((s) => s.key === "redis")?.detailKey,
      "feature.admin.platform.svc.redis.detail"
    );
  });

  it("exposes only safe localhost/tenant-host console URLs (or null), all local-only", async () => {
    const all = await buildServiceSummaries(deps());
    for (const s of all) {
      assert.equal(s.localOnly, true);
      if (s.consoleUrl !== null) {
        assert.match(s.consoleUrl, /^http:\/\/localhost:/);
        assert.equal(s.consoleUrlKind, "direct_local");
      } else {
        assert.equal(s.consoleUrlKind, null);
      }
    }
    // a console-less service is null (e.g. redis/otel/loki)
    assert.equal(all.find((s) => s.key === "loki")?.consoleUrl, null);
    // a console service is a localhost URL (system-operator viewer)
    assert.match(all.find((s) => s.key === "grafana")?.consoleUrl ?? "", /^http:\/\/localhost:/);
  });
});

describe("health semantics — a response is NOT automatically healthy (ADR-ACT-0235/0236)", () => {
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

  it("malformed JSON on a structured endpoint is degraded, not healthy (ADR-ACT-0236)", async () => {
    const r = await buildServiceSummaries(deps({ httpProbe: async () => ok("<html>") }));
    for (const key of ["grafana", "localstack", "sonarqube", "keycloak"]) {
      assert.equal(r.find((s) => s.key === key)?.status, "degraded", key);
    }
    // Unstructured endpoints (plain 2xx contract) remain healthy.
    assert.equal(r.find((s) => s.key === "loki")?.status, "healthy");
  });

  it("SonarQube status !== UP is degraded", async () => {
    const down = await buildServiceSummaries(
      deps({ httpProbe: async () => ok(JSON.stringify({ status: "DOWN" })) })
    );
    assert.equal(down.find((s) => s.key === "sonarqube")?.status, "degraded");
    const starting = await buildServiceSummaries(
      deps({ httpProbe: async () => ok(JSON.stringify({ status: "STARTING" })) })
    );
    assert.equal(starting.find((s) => s.key === "sonarqube")?.status, "degraded");
  });

  it("Keycloak discovery without an issuer is degraded", async () => {
    const r = await buildServiceSummaries(
      deps({ httpProbe: async () => ok(JSON.stringify({ token_endpoint: "x" })) })
    );
    assert.equal(r.find((s) => s.key === "keycloak")?.status, "degraded");
  });
});

describe("host authority — resolveReadinessAccess (ADR-ACT-0236)", () => {
  it("tenant-admin on a tenant-resolved host gets the tenant-safe view", () => {
    assert.deepEqual(
      resolveReadinessAccess({
        isSystemAdmin: false,
        hostKind: "tenant_slug",
        tenantResolved: true,
      }),
      { kind: "ok", viewerMode: "tenant_operator" }
    );
  });

  it("tenant-admin on the apex gets NO_TENANT", () => {
    assert.deepEqual(
      resolveReadinessAccess({ isSystemAdmin: false, hostKind: "apex", tenantResolved: false }),
      { kind: "no_tenant" }
    );
  });

  it("system-admin on the apex gets the system-operator view", () => {
    assert.deepEqual(
      resolveReadinessAccess({ isSystemAdmin: true, hostKind: "apex", tenantResolved: false }),
      { kind: "ok", viewerMode: "system_operator" }
    );
  });

  it("system-admin on unknown/reserved/unresolved hosts is REFUSED (no implicit global origin)", () => {
    for (const hostKind of [
      "reserved_subdomain",
      "invalid_subdomain",
      "custom_domain_candidate",
      "malformed",
    ] as const) {
      assert.deepEqual(
        resolveReadinessAccess({ isSystemAdmin: true, hostKind, tenantResolved: false }),
        { kind: "invalid_operations_origin" },
        hostKind
      );
    }
  });

  it("system-admin on a tenant host is DOWNGRADED to the tenant-safe view (documented policy)", () => {
    assert.deepEqual(
      resolveReadinessAccess({
        isSystemAdmin: true,
        hostKind: "tenant_slug",
        tenantResolved: true,
      }),
      { kind: "ok", viewerMode: "tenant_operator" }
    );
  });
});

describe("console-link exposure follows the clickthrough policy (ADR-ACT-0233/0235/0236)", () => {
  const tenantDeps = () => deps({ viewerMode: "tenant_operator", tenantHost: "acme.aldous.info" });

  it("tenant viewers NEVER receive pgAdmin/MinIO/Grafana/Mailpit/ClickHouse/Sonar console links", async () => {
    const tenant = await buildServiceSummaries(tenantDeps());
    for (const key of ["pgadmin", "minio", "grafana", "mailpit", "clickhouse", "sonarqube"]) {
      const svc = tenant.find((s) => s.key === key);
      assert.equal(svc?.consoleUrl, null, `${key} console link must be withheld`);
      assert.equal(svc?.consoleAccess, "global_only", key);
    }
    // web_caddy (apex super-admin app) is also operator-only.
    assert.equal(tenant.find((s) => s.key === "web_caddy")?.consoleUrl, null);
  });

  it("tenant viewers get the ROUTED tenant-origin Keycloak link, never a direct port", async () => {
    const tenant = await buildServiceSummaries(tenantDeps());
    const kc = tenant.find((s) => s.key === "keycloak");
    assert.equal(kc?.consoleAccess, "tenant_safe");
    assert.equal(kc?.consoleUrl, "http://acme.aldous.info/kc");
    assert.equal(kc?.consoleUrlKind, "routed");
  });

  it("a tenant viewer WITHOUT a routed tenant host gets no Keycloak link (never a direct port)", async () => {
    const tenant = await buildServiceSummaries(deps({ viewerMode: "tenant_operator" }));
    const kc = tenant.find((s) => s.key === "keycloak");
    assert.equal(kc?.consoleUrl, null);
    assert.equal(kc?.consoleUrlKind, null);
  });

  it("system operators get global-only console links, labelled direct_local", async () => {
    const sys = await buildServiceSummaries(deps({ viewerMode: "system_operator" }));
    for (const key of ["pgadmin", "minio", "grafana", "keycloak"]) {
      const svc = sys.find((s) => s.key === key);
      assert.match(svc?.consoleUrl ?? "", /^http:\/\/localhost:/, key);
      assert.equal(svc?.consoleUrlKind, "direct_local", key);
    }
  });

  it("not-exposed services (WireMock) never carry a console link, even for the system operator", async () => {
    const sys = await buildServiceSummaries(deps({ viewerMode: "system_operator" }));
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

describe("buildPlatformServicesReadiness (ADR-ACT-0228/0236)", () => {
  it("returns environment + version + viewerMode + services + workers (no secret fields)", async () => {
    const r = await buildPlatformServicesReadiness({ ...deps(), getHeartbeat: () => null });
    assert.equal(r.environment, "test");
    assert.equal(r.appVersion, "abc123");
    assert.equal(r.viewerMode, "system_operator");
    assert.ok(r.services.length > 0 && r.workers.length > 0);
    // defence-in-depth: no secret-ish keys leaked in the payload
    const blob = JSON.stringify(r);
    assert.ok(!/secret|password|dsn|token|smtp|s3_admin|webhook_secret/i.test(blob));
  });

  it("the tenant view carries viewerMode=tenant_operator", async () => {
    const r = await buildPlatformServicesReadiness({
      ...deps({ viewerMode: "tenant_operator", tenantHost: "acme.aldous.info" }),
      getHeartbeat: () => null,
    });
    assert.equal(r.viewerMode, "tenant_operator");
  });
});
