export const packageName = "@platform/observability";

// ---------------------------------------------------------------------------
// Generic logger interface — zero @platform/* dependencies
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
// ObservabilityPort — the port interface adapters must satisfy
// ---------------------------------------------------------------------------

export interface ObservabilityPort {
  logger: ObservabilityLogger;
  startSpan(name: string, fn: () => void): void;
  withSpan<T>(name: string, fn: () => T | Promise<T>): Promise<T>;
  child(fields: LogFields): ObservabilityPort;
}

// ---------------------------------------------------------------------------
// Console-based noop implementation for testing and development
// ---------------------------------------------------------------------------

function makeConsoleLogger(fields: LogFields = {}): ObservabilityLogger {
  function log(level: string, msg: string, extra?: LogFields): void {
    const entry = { level, msg, ...fields, ...extra };
    if (level === "error" || level === "fatal") {
      console.error(JSON.stringify(entry));
    } else {
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
