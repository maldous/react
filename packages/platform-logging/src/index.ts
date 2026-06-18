import pino from "pino";
import process from "node:process";

export const packageName = "@platform/platform-logging";

/** Pino redaction paths per ADR-0020 §3. */
export const redactionPaths: string[] = [
  "password",
  "passwordHash",
  "secret",
  "token",
  "accessToken",
  "refreshToken",
  "idToken",
  "apiKey",
  "apiSecret",
  "clientSecret",
  "cookie",
  "cookies",
  "authorization",
  "x-api-key",
  "x-auth-token",
  "x-forwarded-authorization",
  "dsn",
  "connectionString",
  "databaseUrl",
  "DATABASE_URL",
  "SENTRY_DSN",
  "*.password",
  "*.secret",
  "*.token",
  "*.apiKey",
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
];

export type PlatformLogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface PlatformLoggerOptions {
  name: string;
  /** Logical service name emitted in every log line (defaults to name). */
  service?: string;
  /** Package name for package-level loggers. */
  packageName?: string;
  /** DDD bounded context (e.g. "identity", "operations"). */
  boundedContext?: string;
  environment?: string;
  version?: string;
  level?: PlatformLogLevel;
  extra?: Record<string, unknown>;
}

export function createLogger(options: PlatformLoggerOptions): pino.Logger {
  const environment =
    options.environment ?? process.env["PLATFORM_ENV"] ?? process.env["NODE_ENV"] ?? "development";

  // Default: "info". Override via options.level or LOG_LEVEL env var.
  // Each env file sets the appropriate LOG_LEVEL:
  //   dev/local: debug  |  test: warn  |  staging/prod: info
  const level: PlatformLogLevel =
    options.level ?? (process.env["LOG_LEVEL"] as PlatformLogLevel | undefined) ?? "info";

  return pino(
    {
      name: options.name,
      level,
      // ISO 8601 timestamps so Loki/Grafana parse without extra config
      timestamp: pino.stdTimeFunctions.isoTime,
      base: {
        service: options.service ?? options.name,
        packageName: options.packageName ?? options.name,
        boundedContext: options.boundedContext ?? "platform",
        environment,
        version: options.version ?? process.env["APP_VERSION"] ?? "unknown",
        gitSha: process.env["GIT_SHA"] ?? "unknown",
      },
      formatters: {
        // Emit string level names ("info") not Pino numeric level codes
        level(label: string) {
          return { level: label };
        },
      },
      serializers: {
        err: pino.stdSerializers.err,
        error: pino.stdSerializers.err,
      },
      redact: {
        paths: redactionPaths,
        censor: "[REDACTED]",
      },
      ...options.extra,
    },
    pino.destination({ sync: false })
  );
}

export function createChildLogger(
  parent: pino.Logger,
  fields: Record<string, unknown>
): pino.Logger {
  return parent.child(fields);
}

export function createRequestLogger(
  parent: pino.Logger,
  ctx: {
    requestId: string;
    traceId?: string;
    spanId?: string;
    actorId?: string;
    tenantId?: string;
    organisationId?: string;
    operationName?: string;
    method?: string;
    path?: string;
  }
): pino.Logger {
  return parent.child(Object.fromEntries(Object.entries(ctx).filter(([, v]) => v !== undefined)));
}

/**
 * Stringify ANY value without ever throwing (ADR-ACT-0290).
 *
 * Plain JSON.stringify throws on circular references, BigInt, a throwing
 * `toJSON`, and some proxies — turning a logging call (the thing reporting an
 * error) into a second error. This helper renders scalars readably, serialises
 * JSON-compatible objects as JSON (BigInt coerced to its decimal string), and
 * returns a constant safe marker for anything unserialisable. The marker is a
 * fixed string and never inspects property VALUES, so a fallback cannot leak a
 * secret held inside the object.
 */
export function safeStringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return `[Function: ${value.name || "anonymous"}]`;
  try {
    const json = JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v));
    // JSON.stringify returns undefined for values with no JSON representation.
    return json ?? "[unserializable]";
  } catch {
    // Circular, throwing toJSON, exotic proxy, etc. — never rethrow.
    return "[unserializable]";
  }
}

export function safeErrorMeta(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const meta: Record<string, unknown> = {
      errMessage: err.message,
      errName: err.name,
    };
    const errCode = (err as { code?: unknown }).code;
    if (errCode !== undefined) {
      if (typeof errCode === "string") meta["errCode"] = errCode;
      else if (typeof errCode === "number" || typeof errCode === "bigint")
        meta["errCode"] = String(errCode);
      else meta["errCode"] = safeStringify(errCode);
    }
    return meta;
  }
  return { errMessage: String(err), errName: "UnknownError" };
}

/**
 * Normalises any thrown value to a safe structured error object.
 * Used in operation failure logging so Loki can parse err.name/err.message
 * as structured metadata rather than unstructured text.
 */
export function normaliseError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
      code: (err as { code?: unknown }).code,
      cause:
        err.cause instanceof Error
          ? { name: err.cause.name, message: err.cause.message }
          : err.cause,
    };
  }
  return { name: "UnknownError", message: String(err) };
}

export function safeContextMeta(ctx: {
  requestId: string;
  traceId?: string;
  spanId?: string;
  operationName?: string;
}): Record<string, unknown> {
  const meta: Record<string, unknown> = { requestId: ctx.requestId };
  if (ctx.traceId !== undefined) meta["traceId"] = ctx.traceId;
  if (ctx.spanId !== undefined) meta["spanId"] = ctx.spanId;
  if (ctx.operationName !== undefined) meta["operationName"] = ctx.operationName;
  return meta;
}

// ---------------------------------------------------------------------------
// Operation lifecycle helpers (ADR-0020)
// ---------------------------------------------------------------------------

export function logOperationStart(
  logger: pino.Logger,
  fields: Record<string, unknown>,
  msg = "operation.start"
): void {
  logger.debug(fields, msg);
}

export function logOperationSuccess(
  logger: pino.Logger,
  fields: Record<string, unknown>,
  msg = "operation.success"
): void {
  logger.info(fields, msg);
}

export function logOperationFailure(
  logger: pino.Logger,
  err: unknown,
  fields: Record<string, unknown>,
  msg = "operation.failed"
): void {
  logger.error({ ...fields, err: normaliseError(err) }, msg);
}

// Browser logger — re-exported from ./browser.ts (intentional browser-only output calls live there).
export * from "./browser.ts";
