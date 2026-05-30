import pino from "pino";

export const packageName = "@platform/platform-logging";

/** Pino redaction paths per ADR-0020 ?3. */
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

export interface PlatformLoggerOptions {
  name: string;
  level?: string | undefined;
  extra?: Record<string, unknown> | undefined;
}

export function createLogger(options: PlatformLoggerOptions): pino.Logger {
  return pino({
    name: options.name,
    level: options.level ?? "info",
    redact: {
      paths: redactionPaths,
      censor: "[REDACTED]",
    },
    ...options.extra,
  });
}

export function createChildLogger(
  parent: pino.Logger,
  fields: Record<string, unknown>
): pino.Logger {
  return parent.child(fields);
}

export function createRequestLogger(
  parent: pino.Logger,
  ctx: { requestId: string; traceId?: string | undefined; spanId?: string | undefined }
): pino.Logger {
  const fields: Record<string, unknown> = { requestId: ctx.requestId };
  if (ctx.traceId !== undefined) fields["traceId"] = ctx.traceId;
  if (ctx.spanId !== undefined) fields["spanId"] = ctx.spanId;
  return parent.child(fields);
}

export function safeErrorMeta(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const meta: Record<string, unknown> = {
      errMessage: err.message,
      errName: err.name,
    };
    const errCode = (err as { code?: unknown }).code;
    if (errCode !== undefined) {
      meta["errCode"] = String(errCode);
    }
    return meta;
  }
  return { errMessage: String(err), errName: "UnknownError" };
}

export function safeContextMeta(ctx: {
  requestId: string;
  traceId?: string | undefined;
  spanId?: string | undefined;
  operationName?: string | undefined;
}): Record<string, unknown> {
  const meta: Record<string, unknown> = { requestId: ctx.requestId };
  if (ctx.traceId !== undefined) meta["traceId"] = ctx.traceId;
  if (ctx.spanId !== undefined) meta["spanId"] = ctx.spanId;
  if (ctx.operationName !== undefined) meta["operationName"] = ctx.operationName;
  return meta;
}

export type BrowserLogLevel = "debug" | "info" | "warn" | "error";

export interface BrowserLogger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

const LOG_LEVEL_ORDER: Record<BrowserLogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export function createBrowserLogger(options: {
  name: string;
  level?: BrowserLogLevel | undefined;
}): BrowserLogger {
  const minLevel = options.level ?? "info";
  const minOrder = LOG_LEVEL_ORDER[minLevel];

  function shouldLog(level: BrowserLogLevel): boolean {
    return LOG_LEVEL_ORDER[level] >= minOrder;
  }

  function log(level: BrowserLogLevel, msg: string, fields?: Record<string, unknown>): void {
    if (!shouldLog(level)) return;
    const entry = { name: options.name, level, msg, ...fields };
    switch (level) {
      case "debug":
        console.debug(entry);
        break;
      case "info":
        console.info(entry);
        break;
      case "warn":
        console.warn(entry);
        break;
      case "error":
        console.error(entry);
        break;
    }
  }

  return {
    debug: (msg, fields) => log("debug", msg, fields),
    info: (msg, fields) => log("info", msg, fields),
    warn: (msg, fields) => log("warn", msg, fields),
    error: (msg, fields) => log("error", msg, fields),
  };
}
