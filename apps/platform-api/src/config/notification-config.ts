// ---------------------------------------------------------------------------
// NotificationConfig / WebhookWorkerConfig — typed projections for the
// notification-transport provider adapters (ADR-0047/ADR-0052; V1C-CONF-06).
//
// These carry ONLY notification/webhook keys, all optional or defaulted, so
// loading never fails the process on a missing required key (the transports are
// best-effort: when nothing is configured the system falls back to the local
// Mailpit sink / disabled worker). Behaviour is preserved exactly — same keys,
// same defaults, same comparison semantics at the call sites (the *_TRANSPORT
// flags and WEBHOOK_WORKER_DISABLED stay strings so `=== "smtp" | "on" | "true"`
// is unchanged; only ports/intervals are typed numbers).
// ---------------------------------------------------------------------------
import { loadConfig, type ResolvedConfig, type LoadConfigOptions } from "@platform/config-runtime";

export const NOTIFICATION_CONFIG_SCHEMA = {
  // Local Mailpit dev sink (createEmailSenderFactory "local" provider).
  localSmtpHost: {
    key: "MAIL_SMTP_HOST",
    type: "string",
    default: "localhost",
    restartOrReload: "restart-required",
    description: "SMTP host for the local Mailpit dev email sink.",
  },
  localSmtpPort: {
    key: "MAIL_SMTP_PORT",
    type: "number",
    default: 1025,
    restartOrReload: "restart-required",
    description: "SMTP port for the local Mailpit dev email sink.",
  },
  // Transport selection (compared with toLowerCase() === "smtp" / "on" — keep strings).
  emailTransport: {
    key: "NOTIFICATION_EMAIL_TRANSPORT",
    type: "string",
    default: "",
    restartOrReload: "restart-required",
    description: 'Email transport enabled when this equals "smtp" (case-insensitive).',
  },
  webhookTransport: {
    key: "NOTIFICATION_WEBHOOK_TRANSPORT",
    type: "string",
    default: "",
    restartOrReload: "restart-required",
    description: 'Webhook transport enabled when this equals "on" (case-insensitive).',
  },
  // Recipient resolver.
  emailDomain: {
    key: "NOTIFICATION_EMAIL_DOMAIN",
    type: "string",
    default: "mailpit.local",
    restartOrReload: "restart-required",
    description: "Default email domain for resolved notification recipients.",
  },
  emailOverride: {
    key: "NOTIFICATION_EMAIL_OVERRIDE",
    type: "string",
    optional: true,
    restartOrReload: "restart-required",
    description: "Force-route all notification email to this address (dev/test).",
  },
  webhookUrl: {
    key: "NOTIFICATION_WEBHOOK_URL",
    type: "string",
    optional: true,
    restartOrReload: "restart-required",
    description: "Destination URL for the webhook notification transport.",
  },
  // SMTP transport (Mailpit).
  smtpHost: {
    key: "SMTP_HOST",
    type: "string",
    default: "localhost",
    restartOrReload: "restart-required",
    description: "SMTP host for the notification email transport.",
  },
  smtpPort: {
    key: "MAILPIT_SMTP_PORT",
    type: "number",
    default: 1025,
    restartOrReload: "restart-required",
    description: "SMTP port for the notification email transport.",
  },
  fromEmail: {
    key: "NOTIFICATION_FROM_EMAIL",
    type: "string",
    default: "notifications@platform.local",
    restartOrReload: "restart-required",
    description: "From address for outbound notification email.",
  },
  webhookSecret: {
    key: "NOTIFICATION_WEBHOOK_SECRET",
    type: "string",
    optional: true,
    secret: true,
    restartOrReload: "restart-required",
    description: "HMAC signing secret for the webhook notification transport (ADR-0052).",
  },
} as const satisfies Record<string, import("@platform/config-runtime").ConfigFieldDef>;

export type NotificationConfig = ResolvedConfig<typeof NOTIFICATION_CONFIG_SCHEMA>;

/** Load the notification-transport projection. Safe at composition time: no required keys. */
export function loadNotificationConfig(
  opts?: LoadConfigOptions<typeof NOTIFICATION_CONFIG_SCHEMA>
): NotificationConfig {
  return loadConfig(NOTIFICATION_CONFIG_SCHEMA, opts);
}

export const WEBHOOK_WORKER_CONFIG_SCHEMA = {
  intervalMs: {
    key: "WEBHOOK_WORKER_INTERVAL_MS",
    type: "number",
    default: 5000,
    restartOrReload: "restart-required",
    description: "Webhook delivery worker tick interval (ms).",
  },
  disabled: {
    key: "WEBHOOK_WORKER_DISABLED",
    type: "string",
    default: "",
    restartOrReload: "restart-required",
    description: 'Webhook delivery worker disabled when this equals "true".',
  },
} as const satisfies Record<string, import("@platform/config-runtime").ConfigFieldDef>;

export type WebhookWorkerConfig = ResolvedConfig<typeof WEBHOOK_WORKER_CONFIG_SCHEMA>;

/** Load the webhook-delivery-worker projection. Safe at module load: no required keys. */
export function loadWebhookWorkerConfig(
  opts?: LoadConfigOptions<typeof WEBHOOK_WORKER_CONFIG_SCHEMA>
): WebhookWorkerConfig {
  return loadConfig(WEBHOOK_WORKER_CONFIG_SCHEMA, opts);
}
