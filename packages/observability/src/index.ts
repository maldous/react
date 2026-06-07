export const packageName = "@platform/observability";

// ---------------------------------------------------------------------------
// Generic logger interface ? zero @platform/* dependencies
// ---------------------------------------------------------------------------

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface LogFields {
  [key: string]: unknown;
}

export interface ObservabilityLogger {
  trace(msg: string, fields?: LogFields): void;
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(fields: LogFields): ObservabilityLogger;
}

// ---------------------------------------------------------------------------
// Generic span interface
// ---------------------------------------------------------------------------

export interface ObservabilitySpan {
  setAttribute(key: string, value: string | number | boolean): void;
  recordException(err: Error): void;
  end(): void;
}

// ---------------------------------------------------------------------------
// ObservabilityPort ? the port interface adapters must satisfy
// ---------------------------------------------------------------------------

export interface ObservabilityPort {
  logger: ObservabilityLogger;
  startSpan(name: string, fn: () => void): void;
  withSpan<T>(name: string, fn: () => T | Promise<T>): Promise<T>;
  child(fields: LogFields): ObservabilityPort;
}

// ---------------------------------------------------------------------------
// Console-based implementation ? FOR TESTING AND LOCAL DEVELOPMENT ONLY.
// Do NOT use createConsoleObservabilityPort in production BFF, adapter, or
// app runtime code. Production code must use a platform-logging-backed
// ObservabilityPort wired by the adapter layer (ADR-0020, ADR-0029).
// ---------------------------------------------------------------------------

function makeConsoleLogger(fields: LogFields = {}): ObservabilityLogger {
  function log(level: string, msg: string, extra?: LogFields): void {
    const entry = { level, msg, ...fields, ...extra };
    if (level === "error" || level === "fatal") {
      // eslint-disable-next-line no-console -- intentional: this IS the console logger leaf (test/dev only)
      console.error(JSON.stringify(entry));
    } else {
      // eslint-disable-next-line no-console -- intentional: this IS the console logger leaf (test/dev only)
      console.log(JSON.stringify(entry));
    }
  }
  return {
    trace: (msg, f) => log("trace", msg, f),
    debug: (msg, f) => log("debug", msg, f),
    info: (msg, f) => log("info", msg, f),
    warn: (msg, f) => log("warn", msg, f),
    error: (msg, f) => log("error", msg, f),
    child: (f) => makeConsoleLogger({ ...fields, ...f }),
  };
}

/**
 * Console-backed ObservabilityPort ? FOR TESTING AND LOCAL DEVELOPMENT ONLY.
 *
 * Uses console.log / console.error. Never use this in production BFF,
 * adapter, or app runtime code (ADR-0020, CLAUDE.md constraint 7).
 * Production wiring belongs in the adapter layer using platform-logging.
 */
export function createConsoleObservabilityPort(fields: LogFields = {}): ObservabilityPort {
  const logger = makeConsoleLogger(fields);
  function build(log: ObservabilityLogger): ObservabilityPort {
    return {
      logger: log,
      startSpan(name, fn) {
        log.debug(`span:start ${name}`);
        fn();
        log.debug(`span:end ${name}`);
      },
      async withSpan(name, fn) {
        log.debug(`span:start ${name}`);
        try {
          const result = await fn();
          log.debug(`span:end ${name}`);
          return result;
        } catch (err) {
          log.error(`span:error ${name}`, { err: String(err) });
          throw err;
        }
      },
      child(f) {
        return build(log.child(f));
      },
    };
  }
  return build(logger);
}
