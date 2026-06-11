import { randomUUID } from "node:crypto";

export const packageName = "@platform/email-runtime";

export class EmailError extends Error {
  // `override`: ES2022 Error already declares `cause`. This is checked under the
  // ES2022 lib used by the platform-api project (noImplicitOverride).
  override readonly cause?: unknown;
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
  // Structural validation (no backtracking regex) to avoid polynomial-time ReDoS on
  // attacker-supplied input. Equivalent to /^[^\s@]+@[^\s@]+\.[^\s@]+$/ but linear-time.
  if (typeof email !== "string") return false;
  if (/\s/.test(email)) return false;
  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@")) return false; // exactly one "@", non-empty local part
  const domain = email.slice(at + 1);
  const lastDot = domain.lastIndexOf(".");
  // domain must contain a "." with a non-empty label on each side
  return lastDot > 0 && lastDot < domain.length - 1;
}

export function createNoopEmailPort(): EmailPort {
  return {
    async send() {
      return { messageId: `noop-${randomUUID()}` };
    },
  };
}
