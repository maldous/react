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

// The subset of @sentry/node the adapter actually uses. Declaring it lets tests
// inject a fake module (see SentryAdapterDeps.importSentry) so the enabled init
// lifecycle is exercised without a real DSN or network.
export interface SentryModuleLike {
  init(options: Record<string, unknown>): void;
  captureException(error: Error, hint?: unknown): string;
  captureMessage(message: string, hint?: unknown): string;
  setUser(user: SentryUser | null): void;
  flush(timeout?: number): Promise<boolean>;
}

export interface SentryAdapterDeps {
  /** Importer for the SDK. Defaults to the real @sentry/node dynamic import. */
  importSentry?: () => Promise<SentryModuleLike>;
  /**
   * Diagnostic sink invoked once if SDK initialisation fails. The error is NEVER
   * rethrown (that would turn a telemetry outage into an app crash); routing it
   * here keeps the failure visible instead of silently swallowed.
   */
  onInitError?: (error: Error) => void;
}

export class SentryErrorAdapter {
  private readonly enabled: boolean;
  private readonly config: SentryConfig;
  private readonly deps: SentryAdapterDeps;
  // Memoised init promise — the single source of "initialisation done". It is
  // created at most once (idempotent start()/ready()) and resolves even on
  // failure, so awaiting it can never produce an unhandled rejection.
  private initPromise: Promise<void> | null = null;
  private sentry: SentryModuleLike | null = null;
  private initError: Error | null = null;

  constructor(config: SentryConfig, deps: SentryAdapterDeps = {}) {
    // Constructor stays synchronous (no async work — Sonar S7059); initialisation
    // is triggered by start()/ready().
    this.config = config;
    this.deps = deps;
    this.enabled = (config.enabled ?? true) && config.dsn.length > 0;
  }

  /**
   * Trigger SDK initialisation. Kept for call sites that don't need to await
   * (e.g. the factory at startup). Idempotent and equivalent to `void ready()`.
   */
  start(): void {
    void this.ready();
  }

  /**
   * Resolve when initialisation has completed (successfully or not). Disabled
   * Sentry is a fast no-op that resolves immediately. Memoised: repeated calls —
   * and repeated start() — share one initialisation, never re-importing the SDK.
   * Fatal-error paths await this BEFORE capture/flush so a startup error is not
   * dropped by the init race.
   */
  ready(): Promise<void> {
    if (!this.enabled) return Promise.resolve();
    this.initPromise ??= this.initSentry(this.config);
    return this.initPromise;
  }

  /** True only after a successful init; lets callers branch on real availability. */
  isInitialised(): boolean {
    return this.sentry !== null;
  }

  /** The initialisation error, if init was attempted and failed; else null. */
  getInitError(): Error | null {
    return this.initError;
  }

  private async initSentry(config: SentryConfig): Promise<void> {
    try {
      // Dynamic import to avoid a hard dependency when Sentry is not configured.
      const importSentry =
        this.deps.importSentry ??
        (() => import("@sentry/node") as unknown as Promise<SentryModuleLike>);
      const mod = await importSentry();
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
      // Publish the module only AFTER init() succeeds, so capture/flush never
      // touch a half-initialised SDK.
      this.sentry = mod;
    } catch (err) {
      this.sentry = null;
      this.initError = err instanceof Error ? err : new Error(String(err));
      // Diagnosable, never rethrown — a telemetry init failure must not crash
      // the app or reject the awaited init promise.
      this.deps.onInitError?.(this.initError);
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
    if (!this.enabled) return true;
    // Wait for initialisation before flushing. Previously flush() returned true
    // immediately while init was still pending, so a fatal-startup flush reported
    // success having flushed nothing. After ready(), either the SDK is available
    // (real flush) or init failed (nothing to flush — true is then honest).
    await this.ready();
    if (!this.sentry) return true;
    return this.sentry.flush(timeoutMs);
  }
}

export function createSentryAdapter(
  config: SentryConfig,
  deps?: SentryAdapterDeps
): SentryErrorAdapter {
  const adapter = new SentryErrorAdapter(config, deps);
  adapter.start();
  return adapter;
}
