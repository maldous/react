import process from "node:process";
import { SentryErrorAdapter } from "@platform/adapters-sentry";

export function createSentryAdapter(): SentryErrorAdapter {
  const enabled = process.env["SENTRY_ENABLED"] === "true";
  const dsn = process.env["SENTRY_DSN"] ?? "";
  const environment = process.env["PLATFORM_ENV"] ?? process.env["NODE_ENV"] ?? "development";
  const release = process.env["APP_VERSION"];

  return new SentryErrorAdapter({ dsn, environment, release, enabled });
}
