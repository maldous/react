import http from "node:http";
import process from "node:process";
import { createLogger, type PlatformLogLevel } from "@platform/platform-logging";
import { createRouter } from "./pipeline.ts";
import { routes } from "./routes.ts";
import { connectRedis, disconnectRedis } from "./dependencies.ts";
import { assertEncryptionKeyConfigured } from "./token-crypto.ts";
import { validateProviderModeAtStartup } from "./auth-providers.ts";
import { createSentryAdapter } from "./observability.ts";

const LOG_LEVEL = (process.env["LOG_LEVEL"] ?? "info") as PlatformLogLevel;
const log = createLogger({ name: "platform-api", service: "platform-api", level: LOG_LEVEL });
const PORT = Number(process.env["PLATFORM_API_PORT"] ?? 3001);
const sentry = createSentryAdapter();

async function start(): Promise<void> {
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
  const server = http.createServer(router);

  server.listen(PORT, () => {
    log.info({ port: PORT }, `platform-api listening`);
    process.stdout.write(`platform-api listening on http://localhost:${PORT}\n`);
  });

  // Graceful shutdown
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.on(sig, () => {
      log.info({ signal: sig }, "shutting down");
      server.close(async () => {
        await disconnectRedis();
        process.exit(0);
      });
    });
  }
}

start().catch(async (err: unknown) => {
  const error = err instanceof Error ? err : new Error(String(err));
  // Log locally first so the line appears even if Sentry transport is slow.
  process.stderr.write(`fatal startup error: ${error.message}\n`);
  // Note: sentry.sentry may still be null here if the dynamic import has not
  // resolved yet (init race). captureError guards against that internally.
  sentry.captureError(error);
  await sentry.flush(2000);
  process.exit(1);
});
