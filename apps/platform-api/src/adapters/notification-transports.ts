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
    emailDomain?: string | undefined;
    emailOverride?: string | undefined;
    webhookUrl?: string | undefined;
  };
  constructor(opts: {
    emailDomain?: string | undefined;
    emailOverride?: string | undefined;
    webhookUrl?: string | undefined;
  }) {
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

/** Email transport: resolve recipient → send via SMTP (Mailpit locally). */
export function createEmailTransport(deps: {
  resolver: NotificationRecipientResolver;
  email: EmailPort;
  from: EmailAddress;
  warn?: (message: string, meta: Record<string, unknown>) => void;
}): NotificationTransport {
  const warn = deps.warn ?? (() => {});
  return async (msg: TransportMsg): Promise<NotificationDispatchStatus> => {
    const to = await deps.resolver.resolveEmail(msg.organisationId, msg.userId);
    if (!to) {
      warn("notification email transport: no recipient resolved", {
        organisationId: msg.organisationId,
        category: msg.category,
      });
      return "failed";
    }
    try {
      await deps.email.send({
        from: deps.from,
        to: [{ address: to }],
        subject: msg.subject,
        text: `[${msg.category}] ${msg.subject}`,
      });
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
  secret?: string | undefined;
  now?: () => number;
  warn?: (message: string, meta: Record<string, unknown>) => void;
}): NotificationTransport {
  const warn = deps.warn ?? (() => {});
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  return async (msg: TransportMsg): Promise<NotificationDispatchStatus> => {
    const url = await deps.resolver.resolveWebhookUrl(msg.organisationId, msg.userId);
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
      const res = await deps.dispatch.dispatch({ url, headers, body });
      return res.ok ? "sent" : "failed";
    } catch {
      return "failed";
    }
  };
}
