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
 *
 * V1C-17 closure: application-metrics scope complete.
 *   - HTTP RED (http_requests_total, http_request_duration_seconds)
 *   - Infrastructure health (postgres_available, redis_available)
 *   - Event bus / DLQ (event_bus_pending, dead_letter_count)
 *   - Worker liveness (worker_liveness)
 *   - Scheduled jobs (scheduled_job_outcome_total)
 *   - Notification dispatch (notification_dispatch_total)
 *   - Provider readiness (provider_readiness)
 */
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

export type PrometheusMetricsProviderConfig = {
  readonly scrapeEnabled: boolean;
  readonly operationTimeoutMs: number;
  readonly retryAttempts: number;
  readonly retryBackoffMs: number;
  readonly configSource: string;
  readonly secretSource: string;
  readonly fallbackRationale: string;
};

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadPrometheusMetricsProviderConfig(
  env: NodeJS.ProcessEnv = process.env
): PrometheusMetricsProviderConfig {
  return {
    scrapeEnabled: env["PROMETHEUS_METRICS_DISABLED"] !== "1",
    operationTimeoutMs: parsePositiveInteger(env["PROMETHEUS_METRICS_TIMEOUT_MS"], 5000),
    retryAttempts: parsePositiveInteger(env["PROMETHEUS_METRICS_RETRY_ATTEMPTS"], 2),
    retryBackoffMs: parsePositiveInteger(env["PROMETHEUS_METRICS_RETRY_BACKOFF_MS"], 50),
    configSource:
      "process.env PROMETHEUS_METRICS_DISABLED|PROMETHEUS_METRICS_TIMEOUT_MS|PROMETHEUS_METRICS_RETRY_ATTEMPTS|PROMETHEUS_METRICS_RETRY_BACKOFF_MS",
    secretSource: "no secret, credential, token, or apiKey is required for local /metrics scraping",
    fallbackRationale:
      "no fallback registry is used; disabled or unavailable metrics fail closed for scrape exposure",
  };
}

function assertPrometheusMetricsAvailable(config: PrometheusMetricsProviderConfig): void {
  if (!config.scrapeEnabled) {
    throw new Error("prometheus-metrics unavailable: metrics scrape disabled; fail closed");
  }
}

async function withMetricsReliability<T>(
  operation: () => Promise<T>,
  config: PrometheusMetricsProviderConfig
): Promise<T> {
  assertPrometheusMetricsAvailable(config);
  const attempts = Math.max(1, config.retryAttempts);
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const startedAt = Date.now();
    try {
      const value = await Promise.race([
        operation(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `prometheus-metrics timeout after ${config.operationTimeoutMs}ms; fail closed`
                )
              ),
            config.operationTimeoutMs
          )
        ),
      ]);
      if (Date.now() - startedAt > config.operationTimeoutMs) {
        throw new Error(
          `prometheus-metrics timeout after ${config.operationTimeoutMs}ms; fail closed`
        );
      }
      return value;
    } catch (err) {
      lastError = err;
      if (attempt < attempts && config.retryBackoffMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, config.retryBackoffMs));
      }
    }
  }
  throw new Error(`prometheus-metrics unavailable after retry attempts; fail closed: ${lastError}`);
}

// ── Registry ────────────────────────────────────────────────────────────────

const registry = new Registry();

// Default Node.js metrics (heap, event loop, gc) — no application labels.
collectDefaultMetrics({ register: registry });

// ── HTTP RED metrics ─────────────────────────────────────────────────────────

/** Bounded-label route template path (never raw request path). */
export const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total HTTP requests served.",
  labelNames: ["method", "route", "status_class"],
  registers: [registry],
});

/** HTTP request duration in seconds (Prometheus base-unit convention). */
export const httpRequestDurationSeconds = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds.",
  labelNames: ["method", "route"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
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

// ── Event bus / dead-letter queue ────────────────────────────────────────────

export const eventBusPending = new Gauge({
  name: "event_bus_pending",
  help: "Number of pending events in the outbox (unprocessed).",
  registers: [registry],
});

export const deadLetterCount = new Gauge({
  name: "dead_letter_count",
  help: "Number of events in the dead-letter queue.",
  registers: [registry],
});

// ── Worker liveness ──────────────────────────────────────────────────────────

export const workerLiveness = new Gauge({
  name: "worker_liveness",
  help: "Worker liveness (1 = alive, reported heartbeat within TTL; 0 = dead).",
  labelNames: ["worker_name"],
  registers: [registry],
});

// ── Scheduled jobs ───────────────────────────────────────────────────────────

export const scheduledJobOutcomeTotal = new Counter({
  name: "scheduled_job_outcome_total",
  help: "Total scheduled-job executions by outcome.",
  labelNames: ["job_key", "outcome"],
  registers: [registry],
});

// ── Notification dispatch ────────────────────────────────────────────────────

export const notificationDispatchTotal = new Counter({
  name: "notification_dispatch_total",
  help: "Total notification dispatches by channel and outcome.",
  labelNames: ["channel", "outcome"],
  registers: [registry],
});

// ── Provider readiness ───────────────────────────────────────────────────────

export const providerReadiness = new Gauge({
  name: "provider_readiness",
  help: "Provider readiness (1 = ready, 0 = not ready). Bounded provider names only.",
  labelNames: ["provider_name"],
  registers: [registry],
});

// ── Expose ───────────────────────────────────────────────────────────────────

/**
 * Return the Prometheus text format for the current registry snapshot.
 * Called by the /metrics endpoint.
 */
export async function getMetrics(): Promise<string> {
  return withMetricsReliability(
    () => registry.metrics(),
    loadPrometheusMetricsProviderConfig(process.env)
  );
}

/**
 * Return the content-type for the Prometheus text format.
 */
export function metricsContentType(): string {
  assertPrometheusMetricsAvailable(loadPrometheusMetricsProviderConfig(process.env));
  return registry.contentType;
}

/**
 * Return all registered metric objects (for proof scripts).
 */
export async function getMetricList(): Promise<unknown[]> {
  return withMetricsReliability(
    async () => registry.getMetricsAsArray(),
    loadPrometheusMetricsProviderConfig(process.env)
  );
}

export async function prometheusMetricsHealthCheck(
  env: NodeJS.ProcessEnv = process.env
): Promise<{ ok: true; metricFamilies: number } | { ok: false; reason: string }> {
  const config = loadPrometheusMetricsProviderConfig(env);
  try {
    assertPrometheusMetricsAvailable(config);
    const metricFamilies = await withMetricsReliability(
      async () => registry.getMetricsAsArray().length,
      config
    );
    return metricFamilies > 0
      ? { ok: true, metricFamilies }
      : { ok: false, reason: "prometheus-metrics misconfigured: no metric families registered" };
  } catch (err) {
    return { ok: false, reason: `prometheus-metrics unavailable: ${String(err)}` };
  }
}

export function prometheusMetricsRecoveryAction(): string {
  return [
    "operator recovery: unset PROMETHEUS_METRICS_DISABLED or set it to 0",
    "verify PROMETHEUS_METRICS_TIMEOUT_MS, PROMETHEUS_METRICS_RETRY_ATTEMPTS, and PROMETHEUS_METRICS_RETRY_BACKOFF_MS are positive integers",
    "repair Prometheus scrape configuration for the platform-api /metrics target, then retry the live proof",
  ].join("; ");
}
