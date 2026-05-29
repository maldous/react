export const packageName = "@platform/adapters-sentry";

export interface SentryConfig {
  dsn: string;
  environment: string;
  release?: string;
  tracesSampleRate?: number;
  enabled?: boolean;
}

export type SentryLevel = "debug" | "info" | "warning" | "error" | "fatal";

export interface SentryUser {
  id: string;
  email?: string;
  username?: string;
}

export class SentryErrorAdapter {
  private readonly enabled: boolean;
  private sentry: typeof import("@sentry/node") | null = null;

  constructor(config: SentryConfig) {
    this.enabled = (config.enabled ?? true) && config.dsn.length > 0;
    if (!this.enabled) return;
    // Dynamic import to avoid hard dependency when Sentry is not configured
    import("@sentry/node")
      .then((mod) => {
        this.sentry = mod;
        mod.init({
          dsn: config.dsn,
          environment: config.environment,
          release: config.release,
          tracesSampleRate: config.tracesSampleRate ?? 0.1,
        });
      })
      .catch(() => {
        this.sentry = null;
      });
  }

  captureError(error: Error, context?: Record<string, unknown>): string | undefined {
    if (!this.enabled || !this.sentry) return undefined;
    return this.sentry.captureException(error, context ? { extra: context } : undefined);
  }

  captureMessage(message: string, level: SentryLevel = "info"): string | undefined {
    if (!this.enabled || !this.sentry) return undefined;
    return this.sentry.captureMessage(message, level as never);
  }

  setUser(user: SentryUser | null): void {
    if (!this.enabled || !this.sentry) return;
    this.sentry.setUser(user);
  }

  async flush(timeoutMs = 2000): Promise<boolean> {
    if (!this.enabled || !this.sentry) return true;
    return this.sentry.flush(timeoutMs);
  }
}

export function createSentryAdapter(config: SentryConfig): SentryErrorAdapter {
  return new SentryErrorAdapter(config);
}
