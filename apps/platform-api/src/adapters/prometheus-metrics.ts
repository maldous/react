/**
 * Prometheus metrics adapter (ADR-0062 / ADR-0020).
 *
 * Collects bounded application metrics and exposes them at /metrics for the
 * in-cluster Prometheus scrape. This is the ONLY file permitted to import
 * prom-client — it stays in the infrastructure/adapters layer. The /metrics
 * endpoint is Compose-internal only (never routed through Caddy to external
 * traffic). No tenantId, organisationId, userId, requestId, traceId, email,
 * raw URL, or unbounded error text is used as a label value.
 *
 * ADR-ACT-0284 / ADR-0020 §10: external SDK imports stay in adapters.
 */
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

// ── Registry ────────────────────────────────────────────────────────────────

const registry = new Registry();

// Default Node.js metrics (heap, event loop, gc) — no application labels.
collectDefaultMetrics({ register: registry });

// ── HTTP metrics ─────────────────────────────────────────────────────────────

export const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total HTTP requests served.",
  labelNames: ["method", "route", "status_class"],
  registers: [registry],
});

export const httpRequestDurationMs = new Histogram({
  name: "http_request_duration_ms",
  help: "HTTP request duration in milliseconds.",
  labelNames: ["method", "route"],
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  registers: [registry],
});

// ── Infrastructure health gauges ─────────────────────────────────────────────

export const postgresAvailable = new Gauge({
  name: "postgres_available",
  help: "Postgres database availability (1 = reachable, 0 = unreachable).",
  registers: [registry],
});

export const redisAvailable = new Gauge({
  name: "redis_available",
  help: "Redis availability (1 = reachable, 0 = unreachable).",
  registers: [registry],
});

// ── Expose ───────────────────────────────────────────────────────────────────

/**
 * Return the Prometheus text format for the current registry snapshot.
 * Called by the /metrics endpoint.
 */
export async function getMetrics(): Promise<string> {
  return registry.metrics();
}

/**
 * Return the content-type for the Prometheus text format.
 */
export function metricsContentType(): string {
  return registry.contentType;
}

/**
 * Return all registered metric objects (for proof scripts).
 */
export async function getMetricList(): Promise<unknown[]> {
  return registry.getMetricsAsArray();
}
