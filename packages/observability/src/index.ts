import { createLogger } from "@platform/platform-logging";
import { createTracer, withSpan as otelWithSpan } from "@platform/platform-observability";
import type { OtelSpanAttributes } from "@platform/platform-observability";

export const packageName = "@platform/observability";

export interface ObservabilityConfig {
  serviceName: string;
  serviceVersion?: string;
  logLevel?: "trace" | "debug" | "info" | "warn" | "error";
}

export interface ObservabilityService {
  logger: ReturnType<typeof createLogger>;
  tracer: ReturnType<typeof createTracer>;
  withSpan<T>(
    name: string,
    fn: () => T | Promise<T>,
    attributes?: OtelSpanAttributes,
  ): Promise<T>;
  child(context: Record<string, unknown>): ObservabilityService;
}

export function createObservability(config: ObservabilityConfig): ObservabilityService {
  const logger = createLogger({ name: config.serviceName, level: config.logLevel ?? "info" });
  const tracer = createTracer(config.serviceName, config.serviceVersion);

  function build(log: ReturnType<typeof createLogger>): ObservabilityService {
    return {
      logger: log,
      tracer,
      async withSpan(name, fn, attributes) {
        return otelWithSpan(tracer, name, fn, attributes);
      },
      child(context) {
        return build(log.child(context));
      },
    };
  }

  return build(logger);
}
