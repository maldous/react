/**
 * Tenant Email Sender runtime proof (ADR-0047 / ADR-ACT-0216).
 *
 * Sends a real message through the SMTP adapter to the local Mailpit sink and
 * reads it back via Mailpit's HTTP API, proving the local sender path end to end.
 * Also exercises the pure readiness classifier and the unreachable-provider
 * classification (real connection refusal). No secret is printed.
 *
 *   1. readiness classifier — representative honest verdicts
 *   2. send a test email via SmtpEmailAdapter → Mailpit (unique subject)
 *   3. read it back via the Mailpit API → confirm delivery
 *   4. unreachable provider → classified provider_unreachable (no throw escapes)
 *   5. cleanup the proof message
 *
 * Usage (Mailpit must be up; `make compose-up-default`):
 *   npm run proof:email-sender
 */

import {
  loadSmtpEmailProviderConfig,
  SmtpEmailAdapter,
} from "../src/adapters/smtp-email-adapter.ts";
import assert from "node:assert/strict";
import {
  classifyEmailSendError,
  computeEmailSenderReadiness,
  DEFAULT_EMAIL_SENDER_CONFIG,
} from "../src/usecases/email-sender.ts";
import { loadLocalEnv } from "./lib/local-env.ts";

loadLocalEnv();
const SMTP_HOST = process.env["MAIL_SMTP_HOST"] ?? "localhost";
const SMTP_PORT = Number(process.env["MAIL_SMTP_PORT"] ?? process.env["MAILPIT_SMTP_PORT"] ?? 1025);
const MAILPIT_API = normalizeMailpitApi(
  process.env["MAILPIT_API"] ?? "http://localhost:8025/mailpit/api/v1"
);

function normalizeMailpitApi(value: string): string {
  const trimmed = value.replace(/\/$/, "");
  return trimmed.endsWith("/api/v1") ? trimmed : `${trimmed}/api/v1`;
}

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}` + (detail ? ` — ${detail}` : ""));
  if (!ok) failures++;
  assert.equal(ok, true, detail ? `${label}: ${detail}` : label);
}

async function main(): Promise<void> {
  console.log(`# Email sender runtime proof — Mailpit @ ${SMTP_HOST}:${SMTP_PORT}\n`);

  // 1. Readiness classifier (pure, honest).
  check(
    "disabled → missing_sender",
    computeEmailSenderReadiness(
      { ...DEFAULT_EMAIL_SENDER_CONFIG, provider: "disabled" },
      {
        hasCredential: false,
        validated: false,
      }
    ) === "missing_sender"
  );
  check(
    "local + sender → configured",
    computeEmailSenderReadiness(
      { ...DEFAULT_EMAIL_SENDER_CONFIG, provider: "local", fromEmail: "noreply@proof.test" },
      { hasCredential: false, validated: false }
    ) === "configured"
  );
  check(
    "smtp configured-but-unverified → unknown (never faked)",
    computeEmailSenderReadiness(
      {
        ...DEFAULT_EMAIL_SENDER_CONFIG,
        provider: "smtp",
        fromEmail: "a@b.test",
        smtpHost: "smtp.x",
      },
      { hasCredential: true, validated: false }
    ) === "unknown"
  );

  // 2. Send a real email to Mailpit with a unique subject.
  const token = `proof-${SMTP_PORT}-${Math.floor(Date.now())}`;
  const subject = `Email sender proof ${token}`;
  const adapter = new SmtpEmailAdapter({
    ...loadSmtpEmailProviderConfig({
      SMTP_HOST,
      SMTP_PORT: String(SMTP_PORT),
      SMTP_TIMEOUT_MS: "5000",
      SMTP_RETRY_ATTEMPTS: "2",
      SMTP_RETRY_BACKOFF_MS: "50",
    }),
    secure: false,
  });
  const health = await adapter.healthCheck();
  check("SMTP provider health probe reports Mailpit ready", health.ok, health.recoveryAction);
  const sent = await adapter.send({
    from: { address: "noreply@proof.test", displayName: "Proof Sender" },
    to: [{ address: "dest@proof.test" }],
    subject,
    text: "Email sender runtime proof message.",
  });
  check("test email sent via SMTP", !!sent.messageId, sent.messageId);

  // 3. Read it back via the Mailpit API.
  await new Promise((r) => setTimeout(r, 500));
  const listRes = await fetch(`${MAILPIT_API}/messages?limit=50`);
  const list = (await listRes.json()) as { messages?: Array<{ ID: string; Subject: string }> };
  const match = (list.messages ?? []).find((m) => m.Subject === subject);
  check("message visible in Mailpit", !!match, match?.ID ?? "not found");

  // 4. Unreachable provider → classified, never thrown out.
  let unreachableResult = "";
  try {
    const dead = new SmtpEmailAdapter({
      ...loadSmtpEmailProviderConfig({
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: "1",
        SMTP_TIMEOUT_MS: "250",
        SMTP_RETRY_ATTEMPTS: "2",
        SMTP_RETRY_BACKOFF_MS: "10",
      }),
      secure: false,
    });
    const deadHealth = await dead.healthCheck();
    check(
      "unavailable SMTP provider health probe fails closed",
      !deadHealth.ok && deadHealth.degradedMode === "unavailable",
      deadHealth.recoveryAction
    );
    await dead.send({
      from: { address: "a@b.test" },
      to: [{ address: "c@d.test" }],
      subject: "should fail",
      text: "x",
    });
  } catch (err) {
    unreachableResult = classifyEmailSendError(err);
  }
  check(
    "unreachable provider classified",
    unreachableResult === "provider_unreachable",
    unreachableResult
  );

  // 5. Cleanup the proof message.
  if (match) {
    await fetch(`${MAILPIT_API}/messages`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ IDs: [match.ID] }),
    });
    check("proof message cleaned up", true);
  }

  console.log(`\n# ` + (failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("email sender runtime proof errored:", err instanceof Error ? err.message : err);
  process.exit(2);
});
