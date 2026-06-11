// Minimal typed surface for nodemailer (ADR-0047). nodemailer ships no types and
// @types/nodemailer is not installed; this declares only what SmtpEmailAdapter uses,
// avoiding a loose `any` and keeping the SMTP send path type-checked.
declare module "nodemailer" {
  export type NodemailerAddress = string | { name: string; address: string };

  export interface SendMailOptions {
    from?: NodemailerAddress;
    to?: NodemailerAddress[];
    cc?: NodemailerAddress[];
    bcc?: NodemailerAddress[];
    replyTo?: NodemailerAddress;
    subject?: string;
    text?: string;
    html?: string;
    headers?: Record<string, string>;
  }

  export interface SentMessageInfo {
    messageId?: string;
  }

  export interface Transporter {
    sendMail(options: SendMailOptions): Promise<SentMessageInfo>;
  }

  export interface TransportOptions {
    host?: string;
    port?: number;
    secure?: boolean;
    auth?: { user: string; pass: string };
  }

  export function createTransport(options: TransportOptions): Transporter;
}
