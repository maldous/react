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

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
}

function toAddress(a: EmailAddress): string | { name: string; address: string } {
  return a.displayName ? { name: a.displayName, address: a.address } : a.address;
}

export class SmtpEmailAdapter implements EmailPort {
  private readonly transporter: Transporter;

  constructor(config: SmtpConfig, transportFactory: typeof createTransport = createTransport) {
    this.transporter = transportFactory({
      host: config.host,
      port: config.port,
      secure: config.secure,
      ...(config.user ? { auth: { user: config.user, pass: config.pass ?? "" } } : {}),
    });
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    try {
      const info = await this.transporter.sendMail({
        from: toAddress(message.from),
        to: message.to.map(toAddress),
        cc: message.cc?.map(toAddress),
        bcc: message.bcc?.map(toAddress),
        replyTo: message.replyTo ? toAddress(message.replyTo) : undefined,
        subject: message.subject,
        text: message.text,
        html: message.html,
        headers: message.headers,
      });
      return { messageId: info.messageId ?? `smtp-${Date.now()}` };
    } catch (err) {
      throw new EmailError("SMTP send failed", err);
    }
  }
}
