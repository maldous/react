/**
 * SmtpEmailAdapter (ADR-0047) — EmailPort over SMTP via nodemailer. Used for the
 * `local` provider (Mailpit dev sink) and the `smtp` provider (tenant SMTP). The
 * password is supplied per-call from the encrypted store and is never logged.
 */

import { createTransport, type Transporter } from "nodemailer";
import {
  EmailError,
  type EmailAddress,
  type EmailMessage,
  type EmailPort,
  type EmailSendResult,
} from "@platform/email-runtime";

type SmtpTransporter = Transporter & {
  verify(): Promise<true>;
};

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  timeoutMs?: number;
  retryAttempts?: number;
  retryBackoffMs?: number;
  configSource?: string;
  secretSource?: string;
}

function toAddress(a: EmailAddress): string | { name: string; address: string } {
  return a.displayName ? { name: a.displayName, address: a.address } : a.address;
}

export interface SmtpProviderHealth {
  ok: boolean;
  degradedMode: "none" | "unavailable";
  recoveryAction: string;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_RETRY_ATTEMPTS = 2;
const DEFAULT_RETRY_BACKOFF_MS = 100;

function numberFromEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadSmtpEmailProviderConfig(env: NodeJS.ProcessEnv = process.env): SmtpConfig {
  return {
    host: env["SMTP_HOST"] ?? env["MAIL_SMTP_HOST"] ?? "localhost",
    port: numberFromEnv(env["SMTP_PORT"] ?? env["MAIL_SMTP_PORT"], 1025),
    secure: (env["SMTP_SECURE"] ?? "false") === "true",
    user: env["SMTP_USER"],
    pass: env["SMTP_PASSWORD"],
    timeoutMs: numberFromEnv(env["SMTP_TIMEOUT_MS"], DEFAULT_TIMEOUT_MS),
    retryAttempts: numberFromEnv(env["SMTP_RETRY_ATTEMPTS"], DEFAULT_RETRY_ATTEMPTS),
    retryBackoffMs: numberFromEnv(env["SMTP_RETRY_BACKOFF_MS"], DEFAULT_RETRY_BACKOFF_MS),
    configSource: "SMTP_HOST/SMTP_PORT/SMTP_SECURE",
    secretSource: "SMTP_USER/SMTP_PASSWORD credential",
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class SmtpEmailAdapter implements EmailPort {
  private readonly transporter: SmtpTransporter;
  private readonly config: Required<
    Pick<
      SmtpConfig,
      "timeoutMs" | "retryAttempts" | "retryBackoffMs" | "configSource" | "secretSource"
    >
  >;

  constructor(config: SmtpConfig, transportFactory: typeof createTransport = createTransport) {
    this.config = {
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      retryAttempts: config.retryAttempts ?? DEFAULT_RETRY_ATTEMPTS,
      retryBackoffMs: config.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS,
      configSource: config.configSource ?? "constructor",
      secretSource: config.secretSource ?? "per-call encrypted SMTP credential",
    };
    this.transporter = transportFactory({
      host: config.host,
      port: config.port,
      secure: config.secure,
      connectionTimeout: this.config.timeoutMs,
      greetingTimeout: this.config.timeoutMs,
      socketTimeout: this.config.timeoutMs,
      ...(config.user ? { auth: { user: config.user, pass: config.pass ?? "" } } : {}),
    } as Parameters<typeof createTransport>[0]) as SmtpTransporter;
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
      try {
        const info = await this.withTimeout(
          this.transporter.sendMail({
            from: toAddress(message.from),
            to: message.to.map(toAddress),
            cc: message.cc?.map(toAddress),
            bcc: message.bcc?.map(toAddress),
            replyTo: message.replyTo ? toAddress(message.replyTo) : undefined,
            subject: message.subject,
            text: message.text,
            html: message.html,
            headers: message.headers,
          })
        );
        return { messageId: info.messageId ?? `smtp-${Date.now()}` };
      } catch (err) {
        lastError = err;
        if (attempt < this.config.retryAttempts) await sleep(this.config.retryBackoffMs * attempt);
      }
    }
    throw new EmailError(
      `SMTP provider unavailable after retry budget; fail-closed with no fallback or degraded delivery (${this.config.configSource}; secret source ${this.config.secretSource})`,
      lastError
    );
  }

  async healthCheck(): Promise<SmtpProviderHealth> {
    try {
      await this.withTimeout(this.transporter.verify());
      return {
        ok: true,
        degradedMode: "none",
        recoveryAction: "none required",
      };
    } catch {
      return {
        ok: false,
        degradedMode: "unavailable",
        recoveryAction: `operator recover SMTP provider by validating ${this.config.configSource}, rotating ${this.config.secretSource}, and retrying readiness probe`,
      };
    }
  }

  recoveryAction(): string {
    return `operator recover SMTP provider by validating ${this.config.configSource}, rotating ${this.config.secretSource}, checking network allow-list, and retrying queued email dispatch`;
  }

  private async withTimeout<T>(operation: Promise<T>): Promise<T> {
    let timeout: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error(`SMTP provider timeout after ${this.config.timeoutMs}ms`)),
        this.config.timeoutMs
      );
    });
    try {
      return await Promise.race([operation, timeoutPromise]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
