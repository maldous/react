import { randomUUID } from "node:crypto";

export const packageName = "@platform/email-runtime";

export class EmailError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "EmailError";
    this.cause = cause;
  }
}

export interface EmailAddress {
  address: string;
  displayName?: string;
}

export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType: string;
}

export interface EmailMessage {
  from: EmailAddress;
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  replyTo?: EmailAddress;
  subject: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
  attachments?: EmailAttachment[];
}

export interface EmailSendResult {
  messageId: string;
}

export interface EmailPort {
  send(message: EmailMessage): Promise<EmailSendResult>;
}

export function isValidEmailAddress(email: string): boolean {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function createNoopEmailPort(): EmailPort {
  return {
    async send() {
      return { messageId: `noop-${randomUUID()}` };
    },
  };
}
