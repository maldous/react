import { trace, type Tracer } from "@opentelemetry/api";

export const packageName = "@platform/adapters-opentelemetry";

export interface OtelSdkConfig {
  serviceName: string;
  serviceVersion: string;
  enabled?: boolean;
  exporterUrl?: string;
}

export class OtelSdkAdapter {
  private readonly enabled: boolean;
  private readonly serviceName: string;
  private readonly serviceVersion: string;

  constructor(config: OtelSdkConfig) {
    this.enabled = config.enabled ?? true;
    this.serviceName = config.serviceName;
    this.serviceVersion = config.serviceVersion;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getTracer(): Tracer {
    return trace.getTracer(this.serviceName, this.serviceVersion);
  }

  async shutdown(): Promise<void> {
    // No-op when using the API-only package without a registered SDK provider.
    // Replace with provider.shutdown() when @opentelemetry/sdk-node is wired.
  }
}

export function createOtelSdkAdapter(config: OtelSdkConfig): OtelSdkAdapter {
  return new OtelSdkAdapter(config);
}

// ---------------------------------------------------------------------------
// Real Node OpenTelemetry SDK bootstrap (ADR-ACT-0284, ADR-0020 §10)
//
// This package is the ONLY place permitted to import the OpenTelemetry SDK
// (sdk-node / auto-instrumentations / exporters) — every other package is held
// to @opentelemetry/api by the import-boundary rules. The SDK is started ONCE,
// at application startup, BEFORE any instrumented module (node:http, pg, redis)
// is loaded, so auto-instrumentation can patch them.
//
// Sentry coexistence: @sentry/node v10 is itself OpenTelemetry-based and would
// register its own global TracerProvider. The application MUST init Sentry with
// `skipOpenTelemetrySetup: true` so this NodeSDK is the sole OTEL owner;
// otherwise the two fight over the global provider and spans are dropped.
// ---------------------------------------------------------------------------

export interface NodeTracingConfig {
  serviceName: string;
  serviceVersion: string;
  environment: string;
  /** OTLP/HTTP base endpoint of the collector, e.g. http://otel-collector:4318.
   *  Falls back to OTEL_EXPORTER_OTLP_ENDPOINT, then localhost. */
  exporterEndpoint?: string;
}

// Minimal structural type — avoids exporting an @opentelemetry/sdk-node type
// across the package boundary (consumers only start/stop).
export interface NodeTracingHandle {
  shutdown(): Promise<void>;
}

let activeHandle: NodeTracingHandle | null = null;

/**
 * Start the Node OpenTelemetry SDK with OTLP/HTTP export + auto-instrumentation.
 * Idempotent: a second call returns the existing handle. Returns null when
 * disabled (OTEL_SDK_DISABLED=true) so callers can no-op cleanly.
 */
export async function startNodeTracing(
  config: NodeTracingConfig
): Promise<NodeTracingHandle | null> {
  if (activeHandle) return activeHandle;
  if ((process.env["OTEL_SDK_DISABLED"] ?? "").toLowerCase() === "true") return null;

  // Imported lazily so merely importing this package (e.g. for getTracer) never
  // pulls the heavy SDK graph into a bundle that does not start tracing.
  const { NodeSDK } = await import("@opentelemetry/sdk-node");
  const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
  const { getNodeAutoInstrumentations } = await import("@opentelemetry/auto-instrumentations-node");
  const { resourceFromAttributes } = await import("@opentelemetry/resources");
  const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } =
    await import("@opentelemetry/semantic-conventions");

  const base =
    config.exporterEndpoint ??
    process.env["OTEL_EXPORTER_OTLP_ENDPOINT"] ??
    "http://localhost:4318";

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.serviceName,
      [ATTR_SERVICE_VERSION]: config.serviceVersion,
      "deployment.environment.name": config.environment,
    }),
    traceExporter: new OTLPTraceExporter({ url: `${base.replace(/\/$/, "")}/v1/traces` }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // fs spans are extremely noisy and not useful for request tracing.
        "@opentelemetry/instrumentation-fs": { enabled: false },
      }),
    ],
  });

  sdk.start();
  activeHandle = {
    shutdown: () => sdk.shutdown(),
  };
  return activeHandle;
}

export async function stopNodeTracing(): Promise<void> {
  if (!activeHandle) return;
  const handle = activeHandle;
  activeHandle = null;
  await handle.shutdown();
}
