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
  private sentry: typeof import("@sentry/node") | null = null;

  constructor(config: SentryConfig) {
    this.enabled = (config.enabled ?? true) && config.dsn.length > 0;
    if (!this.enabled) return;
    // Dynamic import to avoid hard dependency when Sentry is not configured
    import("@sentry/node")
      .then((mod) => {
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
      })
      .catch(() => {
        this.sentry = null;
      });
  }

  captureError(error: Error, context?: Record<string, unknown>): string | undefined {
    if (!this.enabled || !this.sentry) return undefined;
    const tc = activeTrace();
    const extra = {
      ...(context ?? {}),
      ...(tc ? { trace_id: tc.traceId, span_id: tc.spanId } : {}),
    };
    return this.sentry.captureException(error, {
      extra,
      // Tag so the trace id is filterable in Sentry and pivots to the matching
      // Tempo trace (and its Loki logs) — one shared id across all three.
      ...(tc ? { tags: { trace_id: tc.traceId } } : {}),
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
  return new SentryErrorAdapter(config);
}
