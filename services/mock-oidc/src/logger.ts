/**
 * Minimal structured logger for the mock-oidc fixture service.
 *
 * This is a standalone NON-PRODUCTION dev/test fixture, so it does not (and must
 * not) depend on the platform's @platform/platform-logging package. It emits
 * single-line JSON to stdout so Compose/Tilt logs stay greppable.
 */
type Level = "info" | "warn" | "error";

function emit(level: Level, message: string, fields?: Record<string, unknown>): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    service: "mock-oidc",
    message,
    ...fields,
  });
  // eslint-disable-next-line no-console -- standalone fixture service, not platform runtime
  console[level === "error" ? "error" : "log"](line);
}

export const logger = {
  info: (message: string, fields?: Record<string, unknown>) => emit("info", message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => emit("warn", message, fields),
  error: (message: string, fields?: Record<string, unknown>) => emit("error", message, fields),
};
