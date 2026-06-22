/**
 * Real notification transports (ADR-0068 / ADR-ACT-0273 — Phase 6.5).
 *
 * Concrete `NotificationTransport` closures that replace the local sink with REAL
 * delivery, behind the existing NotificationTransport seam (no usecase change):
 *
 *   - createEmailTransport: resolves the recipient server-side (NotificationRecipientResolver)
 *     and sends through the EmailPort (SmtpEmailAdapter → local Mailpit). A missing
 *     recipient or a send error reports `failed` (logged failed, never faked sent).
 *   - createWebhookTransport: resolves the tenant webhook destination, signs the body with
 *     the ADR-0052 HMAC signer (webhookSignatureHeader), and POSTs via WebhookDispatchPort.
 *     A non-2xx / unreachable / missing destination reports `failed`.
 *
 * The payload carries only non-secret summary fields (category/subject/ids) — the
 * dispatch usecase already rejects secret-bearing payload keys before reaching here.
 */

import type { EmailPort, EmailAddress } from "@platform/email-runtime";
import type {
  NotificationDispatchStatus,
  NotificationCategory,
  NotificationChannel,
} from "@platform/contracts-admin";
import type { NotificationTransport } from "../ports/notification-repository.ts";
import type { NotificationRecipientResolver } from "../ports/notification-recipient-resolver.ts";
import { webhookSignatureHeader, type WebhookDispatchPort } from "../usecases/webhooks.ts";

export interface NotificationTransportsProviderConfig {
  timeoutMs: number;
  retryAttempts: number;
  retryBackoffMs: number;
  configSource: "NOTIFICATION_EMAIL_DOMAIN|NOTIFICATION_EMAIL_OVERRIDE|NOTIFICATION_WEBHOOK_URL";
  secretSource: "NOTIFICATION_WEBHOOK_SECRET";
}

export function loadNotificationTransportsProviderConfig(
  env: NodeJS.ProcessEnv = process.env
): NotificationTransportsProviderConfig {
  return {
    timeoutMs: Number(env["NOTIFICATION_TRANSPORT_TIMEOUT_MS"] ?? "5000"),
    retryAttempts: Number(env["NOTIFICATION_TRANSPORT_RETRY_ATTEMPTS"] ?? "1"),
    retryBackoffMs: Number(env["NOTIFICATION_TRANSPORT_RETRY_BACKOFF_MS"] ?? "100"),
    configSource: "NOTIFICATION_EMAIL_DOMAIN|NOTIFICATION_EMAIL_OVERRIDE|NOTIFICATION_WEBHOOK_URL",
    secretSource: "NOTIFICATION_WEBHOOK_SECRET",
  };
}

/**
 * Configured recipient resolver (this pass): resolves destinations from operator/env
 * config, server-side. Email = `<localPrefix>+<userId>@<emailDomain>` (or a fixed
 * `emailOverride`); webhook = a per-tenant URL map or a default `webhookUrl`. Returns
 * null when nothing is configured (⇒ the transport reports `failed`, never faked).
 * IdP-backed per-user email + per-subscription webhook routing are follow-ups behind
 * the same NotificationRecipientResolver port.
 */
export class ConfiguredNotificationRecipientResolver implements NotificationRecipientResolver {
  private readonly opts: {
    emailDomain?: string;
    emailOverride?: string;
    webhookUrl?: string;
  };
  constructor(opts: { emailDomain?: string; emailOverride?: string; webhookUrl?: string }) {
    this.opts = opts;
  }
  async resolveEmail(_organisationId: string, userId: string): Promise<string | null> {
    if (this.opts.emailOverride) return this.opts.emailOverride;
    if (!this.opts.emailDomain) return null;
    const safe = userId.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 64) || "user";
    return `notify+${safe}@${this.opts.emailDomain}`;
  }
  async resolveWebhookUrl(_organisationId: string, _userId: string): Promise<string | null> {
    return this.opts.webhookUrl ?? null;
  }
}

interface TransportMsg {
  organisationId: string;
  userId: string;
  channel: NotificationChannel;
  category: NotificationCategory;
  subject: string;
}

async function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  unavailableMessage: string
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(unavailableMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function withRetry<T>(
  operation: () => Promise<T>,
  config: NotificationTransportsProviderConfig,
  unavailableMessage: string
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= config.retryAttempts; attempt += 1) {
    try {
      return await withTimeout(operation, config.timeoutMs, unavailableMessage);
    } catch (err) {
      lastError = err;
      if (attempt >= config.retryAttempts) break;
      await new Promise((resolve) => setTimeout(resolve, config.retryBackoffMs * (attempt + 1)));
    }
  }
  throw new Error(
    `${unavailableMessage}; no fallback is allowed for notification transport delivery, fail-closed after retry attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}

/** Email transport: resolve recipient → send via SMTP (Mailpit locally). */
export function createEmailTransport(deps: {
  resolver: NotificationRecipientResolver;
  email: EmailPort;
  from: EmailAddress;
  config?: Partial<NotificationTransportsProviderConfig>;
  warn?: (message: string, meta: Record<string, unknown>) => void;
}): NotificationTransport {
  const warn = deps.warn ?? (() => {});
  const config = { ...loadNotificationTransportsProviderConfig(), ...deps.config };
  return async (msg: TransportMsg): Promise<NotificationDispatchStatus> => {
    const to = await withRetry(
      () => deps.resolver.resolveEmail(msg.organisationId, msg.userId),
      config,
      "notification-transports email resolver unavailable"
    );
    if (!to) {
      warn("notification email transport: no recipient resolved", {
        organisationId: msg.organisationId,
        category: msg.category,
      });
      return "failed";
    }
    try {
      await withRetry(
        () =>
          deps.email.send({
            from: deps.from,
            to: [{ address: to }],
            subject: msg.subject,
            text: `[${msg.category}] ${msg.subject}`,
          }),
        config,
        "notification-transports email provider unavailable"
      );
      return "sent";
    } catch (err) {
      warn("notification email transport: send failed", {
        organisationId: msg.organisationId,
        category: msg.category,
        error: err instanceof Error ? err.message : String(err),
      });
      return "failed";
    }
  };
}

/** Webhook transport: resolve destination → signed POST (ADR-0052 signer). */
export function createWebhookTransport(deps: {
  resolver: NotificationRecipientResolver;
  dispatch: WebhookDispatchPort;
  /** Signing secret; when set, a replay-protected X-Platform-Signature is attached. */
  secret?: string;
  config?: Partial<NotificationTransportsProviderConfig>;
  now?: () => number;
  warn?: (message: string, meta: Record<string, unknown>) => void;
}): NotificationTransport {
  const warn = deps.warn ?? (() => {});
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  const config = { ...loadNotificationTransportsProviderConfig(), ...deps.config };
  return async (msg: TransportMsg): Promise<NotificationDispatchStatus> => {
    const url = await withRetry(
      () => deps.resolver.resolveWebhookUrl(msg.organisationId, msg.userId),
      config,
      "notification-transports webhook resolver unavailable"
    );
    if (!url) {
      warn("notification webhook transport: no destination resolved", {
        organisationId: msg.organisationId,
        category: msg.category,
      });
      return "failed";
    }
    // Non-secret summary only — no payload secrets (usecase already rejects them).
    const timestamp = now();
    const body = JSON.stringify({
      event: `notification.${msg.category}`,
      organisationId: msg.organisationId,
      userId: msg.userId,
      subject: msg.subject,
      timestamp,
    });
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-platform-event": `notification.${msg.category}`,
      ...(deps.secret
        ? { "x-platform-signature": webhookSignatureHeader(deps.secret, timestamp, body) }
        : {}),
    };
    try {
      const res = await withRetry(
        () => deps.dispatch.dispatch({ url, headers, body }),
        config,
        "notification-transports webhook provider unavailable"
      );
      return res.ok ? "sent" : "failed";
    } catch (err) {
      warn("notification webhook transport: dispatch failed", {
        organisationId: msg.organisationId,
        category: msg.category,
        error: err instanceof Error ? err.message : String(err),
      });
      return "failed";
    }
  };
}

export async function notificationTransportsHealthCheck(deps: {
  resolver: NotificationRecipientResolver;
  channel: "email" | "webhook";
  organisationId: string;
  userId: string;
  config?: Partial<NotificationTransportsProviderConfig>;
}): Promise<{
  status: "ready";
  provider: "notification-transports";
  channel: "email" | "webhook";
}> {
  const config = { ...loadNotificationTransportsProviderConfig(), ...deps.config };
  const destination = await withRetry(
    () =>
      deps.channel === "email"
        ? deps.resolver.resolveEmail(deps.organisationId, deps.userId)
        : deps.resolver.resolveWebhookUrl(deps.organisationId, deps.userId),
    config,
    `notification-transports ${deps.channel} health resolver unavailable`
  );
  if (!destination) {
    throw new Error(
      `notification-transports ${deps.channel} unavailable; no fallback is allowed for notification delivery, fail-closed because no destination is configured`
    );
  }
  return { status: "ready", provider: "notification-transports", channel: deps.channel };
}

export function notificationTransportsRecoveryAction(): string {
  return "operator recovery: verify NOTIFICATION_EMAIL_DOMAIN/NOTIFICATION_EMAIL_OVERRIDE/NOTIFICATION_WEBHOOK_URL config, NOTIFICATION_WEBHOOK_SECRET when webhook signing is required, SMTP/Webhook provider readiness, recipient resolver data, then retry notification transport dispatch";
}
