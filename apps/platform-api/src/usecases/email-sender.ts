import pg from "pg";
import { withTenant } from "@platform/adapters-postgres";
import { AuditAction, createAuditEvent, type AuditEventPort } from "@platform/audit-events";
import { isValidEmailAddress, type EmailPort } from "@platform/email-runtime";
import {
  EmailSenderSettingsSchema,
  TestEmailRequestSchema,
  UpdateEmailSenderSettingsSchema,
  type EmailSenderProvider,
  type EmailSenderReadinessStatus,
  type EmailSenderSettings,
  type EmailTestResult,
} from "@platform/contracts-admin";
import type { EmailSenderSecretStore } from "../ports/email-sender-store.ts";

// ---------------------------------------------------------------------------
// Tenant email sender configuration + readiness (ADR-0047 / ADR-ACT-0216).
//
// Non-secret config lives in tenant_settings under "email.sender"; the SMTP
// password / API key lives encrypted in the EmailSenderSecretStore and is
// write-only (never returned/logged/audited). Readiness is honest: a sender is
// `configured` only for the local dev sink (documented invariant) or after a
// real successful test-send (validated); an unverified smtp/brevo credential is
// `unknown`, never `ready`. Domain verification is not implemented, so
// `sender_unverified` is never returned.
// ---------------------------------------------------------------------------

export const EMAIL_SENDER_SETTINGS_KEY = "email.sender";

/** Non-secret sender config persisted in tenant_settings. */
export interface StoredEmailSenderConfig {
  provider: EmailSenderProvider;
  fromName: string;
  fromEmail: string;
  replyToEmail: string;
  enabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUsername: string;
}

export const DEFAULT_EMAIL_SENDER_CONFIG: StoredEmailSenderConfig = {
  provider: "disabled",
  fromName: "",
  fromEmail: "",
  replyToEmail: "",
  enabled: false,
  smtpHost: "",
  smtpPort: 0,
  smtpSecure: false,
  smtpUsername: "",
};

function coerceConfig(value: unknown): StoredEmailSenderConfig {
  const v = (value ?? {}) as Partial<StoredEmailSenderConfig>;
  return {
    provider: v.provider ?? "disabled",
    fromName: v.fromName ?? "",
    fromEmail: v.fromEmail ?? "",
    replyToEmail: v.replyToEmail ?? "",
    enabled: Boolean(v.enabled),
    smtpHost: v.smtpHost ?? "",
    smtpPort: typeof v.smtpPort === "number" ? v.smtpPort : 0,
    smtpSecure: Boolean(v.smtpSecure),
    smtpUsername: v.smtpUsername ?? "",
  };
}

/** Pure: classify readiness from stored config + secret presence/validation. */
export function computeEmailSenderReadiness(
  config: StoredEmailSenderConfig,
  meta: { hasCredential: boolean; validated: boolean }
): EmailSenderReadinessStatus {
  if (config.provider === "disabled") return "missing_sender";
  if (!isValidEmailAddress(config.fromEmail)) return "missing_sender";
  if (config.provider === "local") return "configured"; // dev sink — documented invariant
  if (config.provider === "smtp") {
    if (!config.smtpHost) return "missing_sender";
    return meta.validated ? "configured" : "unknown";
  }
  // brevo
  if (!meta.hasCredential) return "missing_credential";
  return meta.validated ? "configured" : "unknown";
}

export interface EmailSenderReadDeps {
  pool: pg.Pool;
  secretStore: EmailSenderSecretStore;
}

async function readStored(
  pool: pg.Pool,
  organisationId: string
): Promise<{ config: StoredEmailSenderConfig; updatedAt: string | null }> {
  return withTenant(pool, organisationId, async (client) => {
    const { rows } = await client.query<{ value: unknown; updated_at: string | null }>(
      `SELECT value, updated_at FROM tenant_settings WHERE key = $1 LIMIT 1`,
      [EMAIL_SENDER_SETTINGS_KEY]
    );
    return { config: coerceConfig(rows[0]?.value), updatedAt: rows[0]?.updated_at ?? null };
  });
}

/** `GET /api/org/email-sender` — redacted settings DTO (never the secret). */
export async function getEmailSenderSettings(
  organisationId: string,
  deps: EmailSenderReadDeps
): Promise<EmailSenderSettings> {
  const { config, updatedAt } = await readStored(deps.pool, organisationId);
  const meta = await deps.secretStore.getMetadata(organisationId);
  const hasCredential = meta?.hasCredential ?? false;
  const validated = !!meta?.lastValidatedAt;
  const dto: EmailSenderSettings = {
    provider: config.provider,
    fromName: config.fromName,
    fromEmail: config.fromEmail,
    replyToEmail: config.replyToEmail,
    enabled: config.enabled,
    smtpHost: config.smtpHost,
    smtpPort: config.smtpPort,
    smtpSecure: config.smtpSecure,
    smtpUsername: config.smtpUsername,
    hasCredential,
    updatedAt,
    readiness: computeEmailSenderReadiness(config, { hasCredential, validated }),
  };
  // Defence in depth: the schema is .strict() so no stray field can leak.
  return EmailSenderSettingsSchema.parse(dto);
}

export async function getEmailSenderReadiness(
  organisationId: string,
  deps: EmailSenderReadDeps
): Promise<{ status: EmailSenderReadinessStatus }> {
  const settings = await getEmailSenderSettings(organisationId, deps);
  return { status: settings.readiness };
}

export interface UpdateEmailSenderInput {
  rawBody: unknown;
  organisationId: string;
  actorId: string;
  actorRoles: string[];
  sourceHost?: string;
  ipAddress?: string;
}

export interface UpdateEmailSenderDeps extends EmailSenderReadDeps {
  audit: AuditEventPort;
}

export type UpdateEmailSenderResult =
  | { kind: "invalid_body"; message: string }
  | { kind: "ok"; settings: EmailSenderSettings };

/** `PATCH /api/org/email-sender` — audit-first; blank/omitted secret preserves. */
export async function updateEmailSenderSettings(
  input: UpdateEmailSenderInput,
  deps: UpdateEmailSenderDeps
): Promise<UpdateEmailSenderResult> {
  const parsed = UpdateEmailSenderSettingsSchema.safeParse(input.rawBody);
  if (!parsed.success) {
    return { kind: "invalid_body", message: parsed.error.issues[0]?.message ?? "Invalid body" };
  }
  const b = parsed.data;
  const next: StoredEmailSenderConfig = {
    provider: b.provider,
    fromName: b.fromName,
    fromEmail: b.fromEmail,
    replyToEmail: b.replyToEmail,
    enabled: b.enabled,
    smtpHost: b.smtpHost ?? "",
    smtpPort: b.smtpPort ?? 0,
    smtpSecure: b.smtpSecure ?? false,
    smtpUsername: b.smtpUsername ?? "",
  };
  const newSecret = b.smtpPassword || b.apiKey || null;

  // Audit-first: record intent (provider + whether a secret changed) BEFORE writing.
  // The secret value is NEVER included.
  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actorId,
      actorRoles: input.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.EmailSenderChanged,
      resource: "email_sender",
      resourceId: "settings",
      metadata: {
        operation: "update",
        provider: next.provider,
        enabled: next.enabled,
        fromEmail: next.fromEmail,
        secretChanged: !!newSecret,
      },
      sourceHost: input.sourceHost,
      ipAddress: input.ipAddress,
    })
  );

  await withTenant(deps.pool, input.organisationId, async (client) => {
    await client.query(
      `INSERT INTO tenant_settings (key, value, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = now()`,
      [EMAIL_SENDER_SETTINGS_KEY, JSON.stringify(next)]
    );
  });

  // A new secret is stored unvalidated (a successful test marks it validated).
  if (newSecret) {
    await deps.secretStore.setSecret(input.organisationId, newSecret, {
      validated: false,
      rotatedBy: input.actorId,
    });
  }

  return { kind: "ok", settings: await getEmailSenderSettings(input.organisationId, deps) };
}

/** Builds a concrete EmailPort for a provider+config+secret, or null when the
 * provider cannot send (disabled / missing required credential). Injected so the
 * use case stays testable; the route wires the real factory. */
export type EmailSenderFactory = (
  provider: EmailSenderProvider,
  config: StoredEmailSenderConfig,
  secret: string | null
) => EmailPort | null;

export interface TestEmailInput {
  rawBody: unknown;
  organisationId: string;
  actorId: string;
  actorRoles: string[];
  sourceHost?: string;
  ipAddress?: string;
}

export interface TestEmailDeps extends EmailSenderReadDeps {
  audit: AuditEventPort;
  makeSender: EmailSenderFactory;
}

export type TestEmailResult =
  | { kind: "invalid_body"; message: string }
  | { kind: "ok"; result: EmailTestResult; messageId: string | null };

/** Classify a send failure without surfacing the secret or a 500. */
export function classifyEmailSendError(
  err: unknown
): "invalid_credential" | "provider_unreachable" {
  const code = (err as { code?: string; cause?: { code?: string } })?.code ?? "";
  const causeCode = (err as { cause?: { code?: string } })?.cause?.code ?? "";
  const msg = err instanceof Error ? err.message : String(err);
  if (/EAUTH/i.test(code) || /EAUTH/i.test(causeCode) || /\b(401|403|auth)\b/i.test(msg)) {
    return "invalid_credential";
  }
  return "provider_unreachable";
}

/** `POST /api/org/email-sender/test` — sends a real message; audit-first on result. */
export async function testEmailSender(
  input: TestEmailInput,
  deps: TestEmailDeps
): Promise<TestEmailResult> {
  const parsed = TestEmailRequestSchema.safeParse(input.rawBody);
  if (!parsed.success) {
    return { kind: "invalid_body", message: parsed.error.issues[0]?.message ?? "Invalid body" };
  }
  const to = parsed.data.to;

  const { config } = await readStored(deps.pool, input.organisationId);

  let result: EmailTestResult;
  let messageId: string | null = null;

  if (config.provider === "disabled") {
    result = "disabled";
  } else if (!isValidEmailAddress(config.fromEmail)) {
    result = "missing_sender";
  } else {
    const secret = await deps.secretStore.getSecret(input.organisationId);
    const sender = deps.makeSender(config.provider, config, secret);
    if (!sender) {
      result = "missing_credential";
    } else {
      try {
        const sent = await sender.send({
          from: { address: config.fromEmail, displayName: config.fromName || undefined },
          to: [{ address: to }],
          replyTo: config.replyToEmail ? { address: config.replyToEmail } : undefined,
          subject: "Test email from your platform sender",
          text: "This is a test message confirming your tenant email sender is configured.",
        });
        result = "sent";
        messageId = sent.messageId;
        await deps.secretStore.markValidated(input.organisationId);
      } catch (err) {
        result = classifyEmailSendError(err);
      }
    }
  }

  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actorId,
      actorRoles: input.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.EmailSenderTested,
      resource: "email_sender",
      resourceId: "test",
      metadata: { operation: "test", provider: config.provider, result },
      sourceHost: input.sourceHost,
      ipAddress: input.ipAddress,
    })
  );

  return { kind: "ok", result, messageId };
}
