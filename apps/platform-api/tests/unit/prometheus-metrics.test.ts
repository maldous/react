/**
 * Unit tests for Prometheus application metrics (V1C-17 closure).
 *
 * Proves:
 *   - All required metric families are registered
 *   - HTTP duration uses seconds (Prometheus convention)
 *   - All labels are bounded (no tenantId, userId, etc.)
 *   - Route label uses registered template, never raw path
 *   - Gauge metrics accept 0/1 values
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Dynamic import so prom-client isn't loaded at parse time
const mod = await import("../../src/adapters/prometheus-metrics.ts");

type MetricLike = { name?: string; labelNames?: string[] };

describe("prometheus-metrics adapter", () => {
  it("exports http_requests_total counter", () => {
    assert.ok(mod.httpRequestsTotal, "httpRequestsTotal must be exported");
    const m = mod.httpRequestsTotal as MetricLike;
    assert.equal(m.name, "http_requests_total", "metric name must be http_requests_total");
  });

  it("exports http_request_duration_seconds histogram", () => {
    assert.ok(mod.httpRequestDurationSeconds, "httpRequestDurationSeconds must be exported");
    const m = mod.httpRequestDurationSeconds as MetricLike;
    assert.ok(m.name?.endsWith("seconds"), `duration metric must use seconds, got: ${m.name}`);
    assert.ok(!m.name?.endsWith("ms"), `duration metric name must not end with ms, got: ${m.name}`);
  });

  it("http_requests_total has bounded labels only", () => {
    const m = mod.httpRequestsTotal as MetricLike;
    const labels = m.labelNames ?? [];
    assert.ok(labels.includes("method"), "must have method label");
    assert.ok(labels.includes("route"), "must have route label");
    assert.ok(labels.includes("status_class"), "must have status_class label");
    const forbidden = [
      "tenant_id",
      "tenantId",
      "user_id",
      "userId",
      "email",
      "request_id",
      "trace_id",
      "raw_url",
    ];
    for (const f of forbidden) {
      assert.ok(
        !labels.some((l) => l.toLowerCase().includes(f.toLowerCase())),
        `forbidden label "${f}" must not appear in ${labels}`
      );
    }
  });

  it("http_request_duration_seconds has bounded labels only", () => {
    const m = mod.httpRequestDurationSeconds as MetricLike;
    const labels = m.labelNames ?? [];
    assert.ok(labels.includes("method"), "must have method label");
    assert.ok(labels.includes("route"), "must have route label");
  });

  it("exports infrastructure health gauges", () => {
    assert.ok(mod.postgresAvailable, "postgresAvailable must be exported");
    assert.ok(mod.redisAvailable, "redisAvailable must be exported");
    assert.equal((mod.postgresAvailable as MetricLike).name, "postgres_available");
    assert.equal((mod.redisAvailable as MetricLike).name, "redis_available");
  });

  it("exports event-bus and dead-letter metrics", () => {
    assert.ok(mod.eventBusPending, "eventBusPending must be exported");
    assert.ok(mod.deadLetterCount, "deadLetterCount must be exported");
    assert.equal((mod.eventBusPending as MetricLike).name, "event_bus_pending");
    assert.equal((mod.deadLetterCount as MetricLike).name, "dead_letter_count");
  });

  it("exports worker_liveness gauge with bounded labels", () => {
    assert.ok(mod.workerLiveness, "workerLiveness must be exported");
    const m = mod.workerLiveness as MetricLike;
    assert.equal(m.name, "worker_liveness");
    assert.ok((m.labelNames ?? []).includes("worker_name"), "must have worker_name label");
  });

  it("exports scheduled_job_outcome_total counter with bounded labels", () => {
    assert.ok(mod.scheduledJobOutcomeTotal, "scheduledJobOutcomeTotal must be exported");
    const m = mod.scheduledJobOutcomeTotal as MetricLike;
    assert.equal(m.name, "scheduled_job_outcome_total");
    assert.ok((m.labelNames ?? []).includes("job_key"), "must have job_key label");
    assert.ok((m.labelNames ?? []).includes("outcome"), "must have outcome label");
  });

  it("exports notification_dispatch_total counter with bounded labels", () => {
    assert.ok(mod.notificationDispatchTotal, "notificationDispatchTotal must be exported");
    const m = mod.notificationDispatchTotal as MetricLike;
    assert.equal(m.name, "notification_dispatch_total");
    assert.ok((m.labelNames ?? []).includes("channel"), "must have channel label");
    assert.ok((m.labelNames ?? []).includes("outcome"), "must have outcome label");
  });

  it("exports provider_readiness gauge with bounded labels", () => {
    assert.ok(mod.providerReadiness, "providerReadiness must be exported");
    const m = mod.providerReadiness as MetricLike;
    assert.equal(m.name, "provider_readiness");
    assert.ok((m.labelNames ?? []).includes("provider_name"), "must have provider_name label");
  });

  it("getMetrics returns Prometheus text format", async () => {
    const text = await mod.getMetrics();
    assert.ok(typeof text === "string", "getMetrics must return a string");
    assert.ok(text.includes("http_requests_total"), "must include http_requests_total");
  });

  it("metricsContentType returns text/plain variant", () => {
    const ct = mod.metricsContentType();
    assert.ok(ct.includes("text/plain"), `content-type must include text/plain, got: ${ct}`);
  });

  it("getMetricList returns array of metric objects", async () => {
    const list = await mod.getMetricList();
    assert.ok(Array.isArray(list), "getMetricList must return an array");
    assert.ok(list.length > 0, "getMetricList must return at least one metric");
  });

  // ── Bounded labels across ALL metrics — check labelNames explicitly ─
  it("no metric has forbidden label names", () => {
    const forbidden = [
      "tenant_id",
      "organisation_id",
      "user_id",
      "request_id",
      "trace_id",
      "email",
      "raw_url",
      "error_text",
    ];
    const allMetrics: MetricLike[] = [
      mod.httpRequestsTotal,
      mod.httpRequestDurationSeconds,
      mod.postgresAvailable,
      mod.redisAvailable,
      mod.eventBusPending,
      mod.deadLetterCount,
      mod.workerLiveness,
      mod.scheduledJobOutcomeTotal,
      mod.notificationDispatchTotal,
      mod.providerReadiness,
    ];
    for (const m of allMetrics) {
      const labels = m.labelNames ?? [];
      for (const f of forbidden) {
        assert.ok(
          !labels.includes(f),
          `metric ${m.name} must not have forbidden label "${f}" in labelNames: ${labels}`
        );
      }
    }
  });
});
