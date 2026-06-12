/**
 * Unit tests for ADR-0050 / ADR-ACT-0219 — tenant observability readiness.
 * The high-cardinality guard + classifier are pure; the probe is exercised with a
 * fake LogSearchPort. No real Loki backend is required.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { LogSearchQuery, LogSearchResult } from "@platform/adapters-loki";
import {
  assertHighCardinalityGuard,
  classifyObservability,
  getTenantObservabilityReadiness,
  type ObservabilityProbePort,
} from "../../src/usecases/tenant-observability.ts";

const NOW = new Date("2026-06-12T12:00:00.000Z");
const okPort = (calls: LogSearchQuery[] = []): ObservabilityProbePort => ({
  async search(q) {
    calls.push(q);
    return { entries: [] } as LogSearchResult;
  },
});

describe("assertHighCardinalityGuard (ADR-0050)", () => {
  it("low-cardinality service/level are labels; ids are | json filters", () => {
    assert.equal(assertHighCardinalityGuard(), true);
  });
});

describe("classifyObservability (ADR-0050)", () => {
  it("configured only when ingestion + tenant query are ok and the guard holds", () => {
    assert.equal(
      classifyObservability({
        logIngestion: "ok",
        tenantScopedQuery: "ok",
        highCardinalityGuard: true,
      }),
      "configured"
    );
  });
  it("provider_unreachable when ingestion is unreachable", () => {
    assert.equal(
      classifyObservability({
        logIngestion: "unreachable",
        tenantScopedQuery: "unknown",
        highCardinalityGuard: true,
      }),
      "provider_unreachable"
    );
  });
  it("degraded when reachable but the tenant query is unhealthy", () => {
    assert.equal(
      classifyObservability({
        logIngestion: "ok",
        tenantScopedQuery: "unreachable",
        highCardinalityGuard: true,
      }),
      "degraded"
    );
  });
  it("degraded when the high-cardinality guard regresses (never configured)", () => {
    assert.equal(
      classifyObservability({
        logIngestion: "ok",
        tenantScopedQuery: "ok",
        highCardinalityGuard: false,
      }),
      "degraded"
    );
  });
});

describe("getTenantObservabilityReadiness (ADR-0050)", () => {
  it("configured when both bounded probes succeed; traces not_applicable", async () => {
    const calls: LogSearchQuery[] = [];
    const r = await getTenantObservabilityReadiness({
      organisationId: "org-1",
      port: okPort(calls),
      now: NOW,
    });
    assert.equal(r.status, "configured");
    assert.equal(r.logIngestion, "ok");
    assert.equal(r.tenantScopedQuery, "ok");
    assert.equal(r.traceCorrelation, "not_applicable");
    assert.equal(r.highCardinalityGuard, true);
    // the tenant-scoped probe is filtered by organisationId (a | json field, not a label).
    assert.equal(calls[1]?.organisationId, "org-1");
  });

  it("provider_unreachable when the backend throws (never faked)", async () => {
    const r = await getTenantObservabilityReadiness({
      organisationId: "org-1",
      port: {
        async search() {
          throw new Error("loki probe timeout");
        },
      },
      now: NOW,
    });
    assert.equal(r.status, "provider_unreachable");
    assert.equal(r.logIngestion, "unreachable");
  });

  it("degraded when ingestion works but the tenant-scoped query fails", async () => {
    let n = 0;
    const r = await getTenantObservabilityReadiness({
      organisationId: "org-1",
      port: {
        async search() {
          n += 1;
          if (n === 1) return { entries: [] } as LogSearchResult;
          throw new Error("tenant query failed");
        },
      },
      now: NOW,
    });
    assert.equal(r.status, "degraded");
    assert.equal(r.logIngestion, "ok");
    assert.equal(r.tenantScopedQuery, "unreachable");
  });

  it("surfaces infra signals honestly without downgrading the core status (ADR-ACT-0224)", async () => {
    const r = await getTenantObservabilityReadiness({
      organisationId: "org-1",
      port: okPort(),
      now: NOW,
      infra: {
        probeMetrics: async () => "not_applicable",
        probeOtelCollector: async () => "ok",
        probeDashboards: async () => "ok",
        probeErrorCapture: async () => "not_configured",
      },
    });
    // core status still configured (logs healthy); infra signals reported as-is.
    assert.equal(r.status, "configured");
    assert.equal(r.metrics, "not_applicable");
    assert.equal(r.otelCollector, "ok");
    assert.equal(r.dashboards, "ok");
    assert.equal(r.errorCapture, "not_configured");
  });

  it("omitting infra leaves the extra signals 'unknown' (minimal context)", async () => {
    const r = await getTenantObservabilityReadiness({
      organisationId: "org-1",
      port: okPort(),
      now: NOW,
    });
    assert.equal(r.dashboards, "unknown");
    assert.equal(r.otelCollector, "unknown");
    assert.equal(r.metrics, "unknown");
    assert.equal(r.errorCapture, "unknown");
  });
});
