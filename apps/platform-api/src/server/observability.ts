import { SentryErrorAdapter } from "@platform/adapters-sentry";
import { createLogger } from "@platform/platform-logging";
import {
  loadObservabilityConfig,
  observabilityEnvironment,
} from "../config/observability-config.ts";

export function createSentryAdapter(): SentryErrorAdapter {
  // Typed observability projection (V1C-CONF-06); behaviour preserved exactly.
  const obs = loadObservabilityConfig();
  const enabled = obs.sentryEnabled === "true";
  const dsn = obs.sentryDsn;
  const environment = observabilityEnvironment(obs);
  const release = obs.appVersion;

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
