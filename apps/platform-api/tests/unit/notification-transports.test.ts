import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { EmailPort } from "@platform/email-runtime";
import type { WebhookDispatchPort } from "../../src/usecases/webhooks.ts";
import {
  ConfiguredNotificationRecipientResolver,
  createEmailTransport,
  createWebhookTransport,
  notificationTransportsHealthCheck,
  notificationTransportsRecoveryAction,
} from "../../src/adapters/notification-transports.ts";

const msg = {
  organisationId: "11111111-1111-1111-1111-111111111111",
  userId: "user-1",
  channel: "email" as const,
  category: "system" as const,
  subject: "Subject",
};

describe("notification-transports provider reliability", () => {
  it("email transport retries bounded sends and fails closed", async () => {
    let sends = 0;
    const warnings: string[] = [];
    const email: EmailPort = {
      async send() {
        sends += 1;
        throw new Error("smtp down");
      },
    };
    const transport = createEmailTransport({
      resolver: new ConfiguredNotificationRecipientResolver({ emailOverride: "to@example.test" }),
      email,
      from: { address: "from@example.test" },
      config: { timeoutMs: 100, retryAttempts: 1, retryBackoffMs: 0 },
      warn: (message) => warnings.push(message),
    });

    assert.equal(await transport(msg), "failed");
    assert.equal(sends, 2);
    assert.ok(warnings.some((m) => m.includes("send failed")));
  });

  it("webhook transport signs, retries bounded dispatch, and fails closed", async () => {
    let dispatches = 0;
    const warnings: string[] = [];
    const dispatch: WebhookDispatchPort = {
      async dispatch(input) {
        dispatches += 1;
        assert.ok(input.headers["x-platform-signature"]);
        throw new Error("webhook down");
      },
    };
    const transport = createWebhookTransport({
      resolver: new ConfiguredNotificationRecipientResolver({ webhookUrl: "https://hook.test/a" }),
      dispatch,
      secret: "secret",
      config: { timeoutMs: 100, retryAttempts: 1, retryBackoffMs: 0 },
      now: () => 123,
      warn: (message) => warnings.push(message),
    });

    assert.equal(await transport({ ...msg, channel: "webhook" }), "failed");
    assert.equal(dispatches, 2);
    assert.ok(warnings.some((m) => m.includes("dispatch failed")));
  });

  it("health check fails closed without a configured destination", async () => {
    await assert.rejects(
      () =>
        notificationTransportsHealthCheck({
          resolver: new ConfiguredNotificationRecipientResolver({}),
          channel: "email",
          organisationId: msg.organisationId,
          userId: msg.userId,
          config: { timeoutMs: 100, retryAttempts: 0 },
        }),
      /notification-transports email unavailable; no fallback.*fail-closed/
    );
    assert.match(notificationTransportsRecoveryAction(), /NOTIFICATION_EMAIL_DOMAIN/);
  });

  it("health check reports ready when a destination is configured", async () => {
    const health = await notificationTransportsHealthCheck({
      resolver: new ConfiguredNotificationRecipientResolver({ emailDomain: "example.test" }),
      channel: "email",
      organisationId: msg.organisationId,
      userId: msg.userId,
      config: { timeoutMs: 100, retryAttempts: 0 },
    });

    assert.deepEqual(health, {
      status: "ready",
      provider: "notification-transports",
      channel: "email",
    });
  });
});
