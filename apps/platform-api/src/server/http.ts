import http from "node:http";
import process from "node:process";
import { createLogger } from "@platform/platform-logging";
import { createRouter } from "./pipeline.ts";
import { routes } from "./routes.ts";
import { connectRedis, disconnectRedis } from "./dependencies.ts";

// LOG_LEVEL defaults to "debug" so all auth/session/tenant operations are visible.
// Set LOG_LEVEL=info in production to reduce noise.
const LOG_LEVEL = process.env["LOG_LEVEL"] ?? "debug";
const log = createLogger({ name: "platform-api", level: LOG_LEVEL });
const PORT = Number(process.env["PLATFORM_API_PORT"] ?? 3001);

async function start(): Promise<void> {
  // Connect Redis before the server starts accepting requests.
  // The auth flow (PKCE state store, session store) requires an active client.
  await connectRedis();
  log.info("Redis connected");

  const router = createRouter(routes);
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

start().catch((err: unknown) => {
  process.stderr.write(`fatal startup error: ${String(err)}\n`);
  process.exit(1);
});
