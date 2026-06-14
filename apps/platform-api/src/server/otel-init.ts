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
import process from "node:process";
import { startNodeTracing } from "@platform/adapters-opentelemetry";

await startNodeTracing({
  serviceName: process.env["OTEL_SERVICE_NAME"] ?? "platform-api",
  serviceVersion: process.env["APP_VERSION"] ?? "0.0.0",
  environment: process.env["PLATFORM_ENV"] ?? process.env["NODE_ENV"] ?? "development",
  exporterEndpoint: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
});
