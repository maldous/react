// OpenTelemetry bootstrap — MUST be the first import in the process (see http.ts).
//
// Auto-instrumentation patches node:http, pg, ioredis/redis etc. at load time,
// so the SDK has to start BEFORE those modules are first imported. This module
// is imported first in http.ts and uses top-level await, which ESM guarantees
// completes before any sibling import (node:http, the adapters) is evaluated.
//
// The SDK itself lives in @platform/adapters-opentelemetry — the only package
// permitted to import the OpenTelemetry SDK (ADR-0020 §10). Sentry is configured
// elsewhere with skipOpenTelemetrySetup so this NodeSDK is the sole OTEL owner
// (ADR-ACT-0284).
import { startNodeTracing } from "@platform/adapters-opentelemetry";
import {
  loadObservabilityConfig,
  observabilityEnvironment,
} from "../config/observability-config.ts";

// Minimal typed observability projection (V1C-CONF-06) — never the full PlatformApiConfig, so this
// first-import instrumentation module never fails the process on a missing required key. Behaviour
// preserved: serviceVersion defaults to 0.0.0; environment is PLATFORM_ENV → NODE_ENV → development.
const obs = loadObservabilityConfig();
await startNodeTracing({
  serviceName: obs.otelServiceName,
  serviceVersion: obs.appVersion ?? "0.0.0",
  environment: observabilityEnvironment(obs),
  exporterEndpoint: obs.otelExporterEndpoint,
});
