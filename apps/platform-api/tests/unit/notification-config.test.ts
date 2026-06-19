import { test } from "node:test";
import assert from "node:assert/strict";
import { configMetadata } from "@platform/config-runtime";
import {
  loadNotificationConfig,
  loadWebhookWorkerConfig,
  NOTIFICATION_CONFIG_SCHEMA,
} from "../../src/config/notification-config.ts";

test("notification config defaults preserve prior behaviour (hermetic, source-injected)", () => {
  const cfg = loadNotificationConfig({ source: {} });
  assert.equal(cfg.localSmtpHost, "localhost");
  assert.equal(cfg.localSmtpPort, 1025);
  assert.equal(cfg.smtpHost, "localhost");
  assert.equal(cfg.smtpPort, 1025);
  assert.equal(cfg.emailDomain, "mailpit.local");
  assert.equal(cfg.fromEmail, "notifications@platform.local");
  assert.equal(cfg.emailTransport, "");
  assert.equal(cfg.webhookTransport, "");
  // optional, unset → undefined (was a bare process.env read).
  assert.equal(cfg.emailOverride, undefined);
  assert.equal(cfg.webhookUrl, undefined);
  assert.equal(cfg.webhookSecret, undefined);
});

test("ports are typed numbers (no Number() coercion needed at call site)", () => {
  const cfg = loadNotificationConfig({
    source: { MAIL_SMTP_PORT: "2525", MAILPIT_SMTP_PORT: "26" },
  });
  assert.equal(cfg.localSmtpPort, 2525);
  assert.equal(cfg.smtpPort, 26);
});

test("webhook secret is marked secret (redacted in metadata)", () => {
  const meta = configMetadata(NOTIFICATION_CONFIG_SCHEMA).find(
    (m) => m.key === "NOTIFICATION_WEBHOOK_SECRET"
  );
  assert.ok(meta);
  assert.equal(meta.secret, true);
});

test("webhook worker config defaults preserve prior behaviour", () => {
  const cfg = loadWebhookWorkerConfig({ source: {} });
  assert.equal(cfg.intervalMs, 5000);
  assert.equal(cfg.disabled, ""); // compared with === "true" at the call site
  // disabled stays a string so non-true values never throw nor flip semantics.
  const off = loadWebhookWorkerConfig({ source: { WEBHOOK_WORKER_DISABLED: "1" } });
  assert.notEqual(off.disabled, "true");
});
