// OpenTelemetry must initialise before any instrumented module loads — keep this
// import first (ADR-ACT-0284).
import "./otel-init.ts";
import http from "node:http";
import process from "node:process";
import { createLogger, type PlatformLogLevel } from "@platform/platform-logging";
import { createRouter } from "./pipeline.ts";
import { routes } from "./routes.ts";
import { connectRedis, disconnectRedis } from "./dependencies.ts";
import { assertEncryptionKeyConfigured } from "./token-crypto.ts";
import { validateProviderModeAtStartup } from "./auth-providers.ts";
import { createSentryAdapter } from "./observability.ts";
import { startWebhookDeliveryWorker } from "./webhook-worker-runtime.ts";
import { loadObservabilityConfig } from "../config/observability-config.ts";
import { loadPlatformApiConfig } from "../config/app-config.ts";

const LOG_LEVEL = loadObservabilityConfig().logLevel as PlatformLogLevel;
const log = createLogger({ name: "platform-api", service: "platform-api", level: LOG_LEVEL });
const sentry = createSentryAdapter();

// Process-level safety net (ADR-ACT-0284). Without these, an async throw or rejected
// promise OUTSIDE a request handler (a worker tick, a background task, a library) would
// crash or leak with NO structured log and NO Sentry capture — undiagnosable. Log +
// capture both; for an uncaught exception the process state is unknown, so flush and
// exit so the orchestrator restarts cleanly.
process.on("unhandledRejection", (reason: unknown) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  log.error({ err: error }, "unhandledRejection");
  sentry.captureError(error);
});
process.on("uncaughtException", (err: unknown) => {
  const error = err instanceof Error ? err : new Error(String(err));
  log.fatal({ err: error }, "uncaughtException — exiting for clean restart");
  // Await init before capture so an exception thrown before Sentry finished
  // initialising is still reported, then flush before exiting. ready() resolves
  // immediately when Sentry is disabled, so this stays fast in that case.
  void (async () => {
    await sentry.ready();
    sentry.captureError(error);
    await sentry.flush(2000);
    process.exit(1);
  })();
});

async function start(): Promise<void> {
  const PORT = loadPlatformApiConfig().platformApiPort;
  // Connect Redis before the server starts accepting requests.
  // The auth flow (PKCE state store, session store) requires an active client.
  assertEncryptionKeyConfigured();

  // Identity-provider mode guardrail (ADR-ACT-0157): fail-fast on dangerous
  // misconfiguration (mock IdPs in staging/prod without the explicit override,
  // or an explicit real mode with no real provider configured). Throwing here
  // aborts startup via the start().catch handler below.
  for (const w of validateProviderModeAtStartup()) {
    log.warn(w.fields, w.message);
  }

  await connectRedis();
  log.info("Redis connected");

  const router = createRouter(routes, undefined, sentry);
  // http.createServer expects a sync (req, res) => void callback; router is
  // async. Wrap so the Node HTTP server gets the right signature. Unhandled
  // rejections from router propagate to the process.on("unhandledRejection")
  // handler installed above, so fire-and-forget is safe here.
  const server = http.createServer((req, res) => {
    void router(req, res);
  });

  server.listen(PORT, () => {
    log.info({ port: PORT }, `platform-api listening`);
    process.stdout.write(`platform-api listening on http://localhost:${PORT}\n`);
  });

  // Background webhook delivery worker (ADR-0052): retries queued deliveries with
  // backoff and dead-letters exhausted ones. Best-effort; disable with
  // WEBHOOK_WORKER_DISABLED=true.
  const stopWebhookWorker = startWebhookDeliveryWorker();

  // Graceful shutdown
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.on(sig, () => {
      log.info({ signal: sig }, "shutting down");
      stopWebhookWorker();
      // server.close expects a sync (err?: Error) => void callback. Run the
      // async shutdown work as a void IIFE; any rejection propagates to the
      // process.on("unhandledRejection") handler, which logs + captures it
      // before process.exit(1) — an acceptable outcome for a shutdown path.
      server.close(() => {
        void (async () => {
          await disconnectRedis();
          process.exit(0);
        })();
      });
    });
  }
}

start().catch(async (err: unknown) => {
  const error = err instanceof Error ? err : new Error(String(err));
  // Log locally first so the line appears even if Sentry transport is slow.
  process.stderr.write(`fatal startup error: ${error.message}\n`);
  // Await initialisation before capture so the fatal error is actually reported
  // (previously the dynamic import often had not resolved yet, so captureError
  // silently dropped the most important error the process will ever emit).
  await sentry.ready();
  sentry.captureError(error);
  await sentry.flush(2000);
  process.exit(1);
});
