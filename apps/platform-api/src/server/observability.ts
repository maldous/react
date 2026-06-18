import process from "node:process";
import { SentryErrorAdapter } from "@platform/adapters-sentry";
import { createLogger } from "@platform/platform-logging";

export function createSentryAdapter(): SentryErrorAdapter {
  const enabled = process.env["SENTRY_ENABLED"] === "true";
  const dsn = process.env["SENTRY_DSN"] ?? "";
  const environment = process.env["PLATFORM_ENV"] ?? process.env["NODE_ENV"] ?? "development";
  const release = process.env["APP_VERSION"];

  const log = createLogger({ name: "sentry-adapter", service: "platform-api" });
  const adapter = new SentryErrorAdapter(
    { dsn, environment, release, enabled },
    {
      // Surface a Sentry SDK init failure instead of silently swallowing it — a
      // dark error monitor is itself an incident worth a structured log line.
      onInitError: (err) => log.error({ err }, "sentry adapter initialisation failed"),
    }
  );
  adapter.start();
  return adapter;
}
