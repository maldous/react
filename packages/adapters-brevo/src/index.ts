import type { EmailPort, EmailMessage, EmailSendResult } from "@platform/email-runtime";
import { EmailError } from "@platform/email-runtime";

export const packageName = "@platform/adapters-brevo";

export interface BrevoConfig {
  apiKey: string;
  defaultFromAddress: string;
  defaultFromName?: string;
  baseUrl?: string;
}

export class BrevoEmailAdapter implements EmailPort {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(config: BrevoConfig, fetchFn: typeof fetch = globalThis.fetch) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? "https://api.brevo.com/v3";
    this.fetchFn = fetchFn;
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const body = JSON.stringify({
      sender: { email: message.from.address, name: message.from.displayName },
      to: message.to.map((a) => ({ email: a.address, name: a.displayName })),
      cc: message.cc?.map((a) => ({ email: a.address, name: a.displayName })),
      bcc: message.bcc?.map((a) => ({ email: a.address, name: a.displayName })),
      subject: message.subject,
      textContent: message.text,
      htmlContent: message.html,
    });

    const response = await this.fetchFn(`${this.baseUrl}/smtp/email`, {
      method: "POST",
      headers: {
        "api-key": this.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ message: `HTTP ${response.status}` }));
      throw new EmailError(
        `Brevo API error ${response.status}: ${(err as { message?: string }).message ?? "Unknown error"}`,
      );
    }

    const data = (await response.json()) as { messageId?: string };
    return { messageId: data.messageId ?? `brevo-${Date.now()}` };
  }
}
