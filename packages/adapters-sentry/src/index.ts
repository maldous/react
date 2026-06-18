import { trace } from "@opentelemetry/api";

export const packageName = "@platform/adapters-sentry";

// Read the active OpenTelemetry trace context (set by the NodeSDK in
// adapters-opentelemetry) so every Sentry event can carry the SAME trace id as
// the Tempo trace and the Loki logs — one shared id triangulates an error
// across all three (ADR-ACT-0284, "keep both + cross-link"). @opentelemetry/api
// is the no-op-safe spec layer; when no span is active the ids are absent.
function activeTrace(): { traceId: string; spanId: string } | null {
  const span = trace.getActiveSpan();
  if (!span) return null;
  const ctx = span.spanContext();
  if (!ctx?.traceId) return null;
  return { traceId: ctx.traceId, spanId: ctx.spanId };
}

// Correlation ids we promote from `context` to searchable Sentry tags. Stable,
// bounded-per-request identifiers only — never actor/tenant/free-form values.
const CORRELATION_TAG_KEYS = ["requestId", "testRunId", "scenarioId"] as const;

export function correlationTagsFrom(context?: Record<string, unknown>): Record<string, string> {
  if (!context) return {};
  const tags: Record<string, string> = {};
  for (const key of CORRELATION_TAG_KEYS) {
    const value = context[key];
    if (typeof value === "string" && value.length > 0) tags[key] = value;
  }
  return tags;
}

export interface SentryConfig {
  dsn: string;
  environment: string;
  release?: string;
  tracesSampleRate?: number;
  enabled?: boolean;
}

export type SentryLevel = "debug" | "info" | "warning" | "error" | "fatal";

export interface SentryUser {
  id: string;
  email?: string;
  username?: string;
}

export class SentryErrorAdapter {
  private readonly enabled: boolean;
  private readonly config: SentryConfig;
  private started = false;
  private sentry: typeof import("@sentry/node") | null = null;

  constructor(config: SentryConfig) {
    // Constructor is synchronous (no async work — Sonar S7059); the SDK import is
    // kicked off by start(), invoked from the factory immediately after construction.
    this.config = config;
    this.enabled = (config.enabled ?? true) && config.dsn.length > 0;
  }

  /**
   * Begin (fire-and-forget) SDK initialisation. Called by createSentryAdapter right
   * after construction, so init is still eager but the async trigger lives outside
   * the constructor. Idempotent; the adapter methods guard on `this.sentry` until it
   * resolves.
   */
  start(): void {
    if (!this.enabled || this.started) return;
    this.started = true;
    void this.initSentry(this.config);
  }

  private async initSentry(config: SentryConfig): Promise<void> {
    try {
      // Dynamic import to avoid hard dependency when Sentry is not configured
      const mod = await import("@sentry/node");
      this.sentry = mod;
      mod.init({
        dsn: config.dsn,
        environment: config.environment,
        release: config.release,
        tracesSampleRate: config.tracesSampleRate ?? 0.1,
        // @sentry/node v10 is OpenTelemetry-based and would register its OWN
        // global TracerProvider + http instrumentation, fighting the NodeSDK
        // in adapters-opentelemetry (last-one-wins → dropped spans, double
        // instrumentation). Skip Sentry's OTEL setup so the platform NodeSDK
        // is the sole OTEL owner and Tempo is the single trace store; Sentry
        // stays error-capture-only (ADR-ACT-0284).
        skipOpenTelemetrySetup: true,
      });
    } catch {
      this.sentry = null;
    }
  }

  captureError(error: Error, context?: Record<string, unknown>): string | undefined {
    if (!this.enabled || !this.sentry) return undefined;
    const tc = activeTrace();
    const extra = {
      ...(context ?? {}),
      ...(tc ? { trace_id: tc.traceId, span_id: tc.spanId } : {}),
    };
    // Promote stable correlation ids to Sentry TAGS so they are searchable via
    // the Sentry API (`?query=key:value`); `extra` is stored but not indexed for
    // search. requestId pivots to the matching Loki log line; testRunId/scenarioId
    // let an E2E run find exactly the event it triggered (ADR-ACT-0285 Phase 5.5).
    // Unlike Loki labels (ADR-0035), Sentry tags tolerate this cardinality.
    const correlationTags = correlationTagsFrom(context);
    const tags = {
      ...(tc ? { trace_id: tc.traceId } : {}),
      ...correlationTags,
    };
    return this.sentry.captureException(error, {
      extra,
      ...(Object.keys(tags).length ? { tags } : {}),
    });
  }

  captureMessage(message: string, level: SentryLevel = "info"): string | undefined {
    if (!this.enabled || !this.sentry) return undefined;
    const tc = activeTrace();
    return this.sentry.captureMessage(message, {
      level: level as never,
      ...(tc ? { tags: { trace_id: tc.traceId }, extra: { span_id: tc.spanId } } : {}),
    } as never);
  }

  setUser(user: SentryUser | null): void {
    if (!this.enabled || !this.sentry) return;
    this.sentry.setUser(user);
  }

  async flush(timeoutMs = 2000): Promise<boolean> {
    if (!this.enabled || !this.sentry) return true;
    return this.sentry.flush(timeoutMs);
  }
}

export function createSentryAdapter(config: SentryConfig): SentryErrorAdapter {
  const adapter = new SentryErrorAdapter(config);
  adapter.start();
  return adapter;
}
