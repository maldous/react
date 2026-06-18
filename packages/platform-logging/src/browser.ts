// ---------------------------------------------------------------------------
// Browser logger — developer diagnostics only.
// NEVER logs tokens, cookies, auth headers, full API responses, or PII.
// ---------------------------------------------------------------------------

export type BrowserLogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface BrowserLogger {
  trace(msg: string, fields?: Record<string, unknown>): void;
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  fatal(msg: string, fields?: Record<string, unknown>): void;
}

const LOG_LEVEL_ORDER: Record<BrowserLogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  fatal: 5,
};

export function createBrowserLogger(options: {
  name: string;
  level?: BrowserLogLevel;
}): BrowserLogger {
  const minLevel = options.level ?? "info";
  const minOrder = LOG_LEVEL_ORDER[minLevel];

  function shouldLog(level: BrowserLogLevel): boolean {
    return LOG_LEVEL_ORDER[level] >= minOrder;
  }

  function log(level: BrowserLogLevel, msg: string, fields?: Record<string, unknown>): void {
    if (!shouldLog(level)) return;
    const entry = { name: options.name, level, msg, ...fields };
    // browser logger leaf: console is the only output mechanism available in browsers; exempt from no-console gate (ADR-ACT-0196)
    switch (level) {
      case "trace":
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
      case "fatal":
        console.error(entry);
        break;
    }
  }

  return {
    trace: (msg, fields) => log("trace", msg, fields),
    debug: (msg, fields) => log("debug", msg, fields),
    info: (msg, fields) => log("info", msg, fields),
    warn: (msg, fields) => log("warn", msg, fields),
    error: (msg, fields) => log("error", msg, fields),
    fatal: (msg, fields) => log("fatal", msg, fields),
  };
}
