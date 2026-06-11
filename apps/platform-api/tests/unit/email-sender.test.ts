/**
 * Unit tests for tenant email sender configuration + readiness (ADR-0047).
 * Pure — no HTTP, no real DB, no real SMTP. The pool, secret store, and email
 * sender are all faked; the secret is asserted never to cross the DTO/audit boundary.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { type AuditEvent, type AuditEventPort } from "@platform/audit-events";
import type { EmailPort } from "@platform/email-runtime";
import type { EmailSenderSecretStore } from "../../src/ports/email-sender-store.ts";
import {
  classifyEmailSendError,
  computeEmailSenderReadiness,
  DEFAULT_EMAIL_SENDER_CONFIG,
  getEmailSenderSettings,
  testEmailSender,
  updateEmailSenderSettings,
  type StoredEmailSenderConfig,
} from "../../src/usecases/email-sender.ts";

const ORG = "a1b2c3d4-e5f6-4000-8000-000000000001";
const ACTOR = "a1b2c3d4-e5f6-4000-8000-000000000002";

function makeAudit(): AuditEventPort & { events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  return {
    events,
    async emit(e) {
      events.push(e);
    },
    async query() {
      return [];
    },
  };
}

/** Pool whose SELECT on tenant_settings returns one row; INSERT/SET no-op. */
function makePool(value: unknown = null, updatedAt: string | null = null) {
  const client = {
    escapeIdentifier: (s: string) => `"${s}"`,
    async query(text: string) {
      if (text.toLowerCase().includes("from tenant_settings")) {
        return value === null
          ? { rows: [], rowCount: 0 }
          : { rows: [{ value, updated_at: updatedAt }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  return {
    async connect() {
      return client;
    },
    async query() {
      return { rows: [], rowCount: 1 };
    },
  } as never;
}

function makeSecretStore(initial?: {
  secret?: string;
  validated?: boolean;
}): EmailSenderSecretStore & {
  setCalls: { secret: string; validated?: boolean }[];
  validatedCalls: number;
} {
  let secret = initial?.secret ?? null;
  let validated = initial?.validated ?? false;
  const setCalls: { secret: string; validated?: boolean }[] = [];
  let validatedCalls = 0;
  return {
    setCalls,
    get validatedCalls() {
      return validatedCalls;
    },
    async getSecret() {
      return secret;
    },
    async setSecret(_org, s, opts) {
      secret = s;
      validated = opts?.validated ?? false;
      setCalls.push({ secret: s, validated: opts?.validated });
    },
    async markValidated() {
      validated = true;
      validatedCalls++;
    },
    async getMetadata() {
      return {
        hasCredential: secret !== null,
        lastValidatedAt: validated ? "2026-06-12T00:00:00Z" : null,
        updatedAt: secret !== null ? "2026-06-12T00:00:00Z" : null,
      };
    },
    async clear() {
      secret = null;
    },
  };
}

const cfg = (over: Partial<StoredEmailSenderConfig> = {}): StoredEmailSenderConfig => ({
  ...DEFAULT_EMAIL_SENDER_CONFIG,
  ...over,
});

describe("computeEmailSenderReadiness (pure)", () => {
  it("disabled or missing sender is missing_sender", () => {
    assert.equal(
      computeEmailSenderReadiness(cfg({ provider: "disabled" }), {
        hasCredential: false,
        validated: false,
      }),
      "missing_sender"
    );
    assert.equal(
      computeEmailSenderReadiness(cfg({ provider: "local", fromEmail: "" }), {
        hasCredential: false,
        validated: false,
      }),
      "missing_sender"
    );
  });
  it("local with a valid sender is configured (dev invariant)", () => {
    assert.equal(
      computeEmailSenderReadiness(cfg({ provider: "local", fromEmail: "a@b.com" }), {
        hasCredential: false,
        validated: false,
      }),
      "configured"
    );
  });
  it("smtp needs a host, then unknown until validated", () => {
    assert.equal(
      computeEmailSenderReadiness(cfg({ provider: "smtp", fromEmail: "a@b.com" }), {
        hasCredential: true,
        validated: false,
      }),
      "missing_sender"
    );
    assert.equal(
      computeEmailSenderReadiness(
        cfg({ provider: "smtp", fromEmail: "a@b.com", smtpHost: "smtp.x" }),
        { hasCredential: true, validated: false }
      ),
      "unknown"
    );
    assert.equal(
      computeEmailSenderReadiness(
        cfg({ provider: "smtp", fromEmail: "a@b.com", smtpHost: "smtp.x" }),
        { hasCredential: true, validated: true }
      ),
      "configured"
    );
  });
  it("brevo needs a credential, then unknown until validated", () => {
    assert.equal(
      computeEmailSenderReadiness(cfg({ provider: "brevo", fromEmail: "a@b.com" }), {
        hasCredential: false,
        validated: false,
      }),
      "missing_credential"
    );
    assert.equal(
      computeEmailSenderReadiness(cfg({ provider: "brevo", fromEmail: "a@b.com" }), {
        hasCredential: true,
        validated: false,
      }),
      "unknown"
    );
    assert.equal(
      computeEmailSenderReadiness(cfg({ provider: "brevo", fromEmail: "a@b.com" }), {
        hasCredential: true,
        validated: true,
      }),
      "configured"
    );
  });
});

describe("getEmailSenderSettings", () => {
  it("returns disabled defaults when nothing is stored, with no secret field", async () => {
    const s = await getEmailSenderSettings(ORG, {
      pool: makePool(null),
      secretStore: makeSecretStore(),
    });
    assert.equal(s.provider, "disabled");
    assert.equal(s.readiness, "missing_sender");
    assert.equal(s.hasCredential, false);
    const keys = Object.keys(s);
    assert.ok(
      !keys.includes("smtpPassword") && !keys.includes("apiKey"),
      "no secret field in the DTO"
    );
  });
  it("reflects stored config + credential presence", async () => {
    const s = await getEmailSenderSettings(ORG, {
      pool: makePool(
        { provider: "brevo", fromEmail: "noreply@acme.test", fromName: "Acme" },
        "2026-06-12T00:00:00Z"
      ),
      secretStore: makeSecretStore({ secret: "x", validated: true }),
    });
    assert.equal(s.provider, "brevo");
    assert.equal(s.hasCredential, true);
    assert.equal(s.readiness, "configured");
  });
});

describe("updateEmailSenderSettings", () => {
  const base = { organisationId: ORG, actorId: ACTOR, actorRoles: ["tenant-admin"] };

  it("rejects smtp without a host", async () => {
    const r = await updateEmailSenderSettings(
      {
        ...base,
        rawBody: {
          provider: "smtp",
          fromName: "A",
          fromEmail: "a@b.com",
          replyToEmail: "",
          enabled: true,
        },
      },
      { pool: makePool(null), secretStore: makeSecretStore(), audit: makeAudit() }
    );
    assert.equal(r.kind, "invalid_body");
  });

  it("rejects a tenant id smuggled in the body (strict schema)", async () => {
    const r = await updateEmailSenderSettings(
      {
        ...base,
        rawBody: {
          provider: "local",
          fromName: "A",
          fromEmail: "a@b.com",
          replyToEmail: "",
          enabled: true,
          organisationId: "other",
        },
      },
      { pool: makePool(null), secretStore: makeSecretStore(), audit: makeAudit() }
    );
    assert.equal(r.kind, "invalid_body");
  });

  it("is audit-first and never puts the secret in audit metadata", async () => {
    const audit = makeAudit();
    const store = makeSecretStore();
    const r = await updateEmailSenderSettings(
      {
        ...base,
        rawBody: {
          provider: "smtp",
          fromName: "A",
          fromEmail: "a@b.com",
          replyToEmail: "",
          enabled: true,
          smtpHost: "smtp.x",
          apiKey: "SUPERSECRET",
        },
      },
      { pool: makePool(null), secretStore: store, audit }
    );
    assert.equal(r.kind, "ok");
    assert.equal(audit.events.length, 1);
    assert.equal(audit.events[0]!.action, "email_sender.changed");
    const meta = JSON.stringify(audit.events[0]!.metadata);
    assert.ok(!meta.includes("SUPERSECRET"), "secret must not appear in audit metadata");
    assert.ok(meta.includes("secretChanged"));
    assert.equal(store.setCalls.length, 1);
    assert.equal(store.setCalls[0]!.validated, false, "a new secret is stored unvalidated");
  });

  it("preserves the existing secret when none is supplied", async () => {
    const store = makeSecretStore({ secret: "existing" });
    await updateEmailSenderSettings(
      {
        ...base,
        rawBody: {
          provider: "smtp",
          fromName: "A",
          fromEmail: "a@b.com",
          replyToEmail: "",
          enabled: true,
          smtpHost: "smtp.x",
        },
      },
      { pool: makePool(null), secretStore: store, audit: makeAudit() }
    );
    assert.equal(
      store.setCalls.length,
      0,
      "no secret write when none is supplied → existing preserved"
    );
  });
});

describe("testEmailSender", () => {
  const base = { organisationId: ORG, actorId: ACTOR, actorRoles: ["tenant-admin"] };
  const okSender: EmailPort = {
    async send() {
      return { messageId: "mid-1" };
    },
  };
  const throwingSender = (code: string): EmailPort => ({
    async send() {
      throw Object.assign(new Error(code), { code });
    },
  });

  it("rejects an invalid recipient", async () => {
    const r = await testEmailSender(
      { ...base, rawBody: { to: "not-an-email" } },
      {
        pool: makePool({ provider: "local", fromEmail: "a@b.com" }),
        secretStore: makeSecretStore(),
        audit: makeAudit(),
        makeSender: () => okSender,
      }
    );
    assert.equal(r.kind, "invalid_body");
  });

  it("sends via local and marks the credential validated; audits the result without a secret", async () => {
    const audit = makeAudit();
    const store = makeSecretStore({ secret: "x" });
    const r = await testEmailSender(
      { ...base, rawBody: { to: "dest@acme.test" } },
      {
        pool: makePool({ provider: "local", fromEmail: "a@b.com", fromName: "Acme" }),
        secretStore: store,
        audit,
        makeSender: () => okSender,
      }
    );
    assert.equal(r.kind === "ok" && r.result, "sent");
    assert.equal(r.kind === "ok" && r.messageId, "mid-1");
    assert.equal(store.validatedCalls, 1);
    assert.equal(audit.events[0]!.action, "email_sender.tested");
    assert.ok(JSON.stringify(audit.events[0]!.metadata).includes("sent"));
  });

  it("returns disabled / missing_sender / missing_credential honestly", async () => {
    const disabled = await testEmailSender(
      { ...base, rawBody: { to: "d@acme.test" } },
      {
        pool: makePool({ provider: "disabled" }),
        secretStore: makeSecretStore(),
        audit: makeAudit(),
        makeSender: () => okSender,
      }
    );
    assert.equal(disabled.kind === "ok" && disabled.result, "disabled");

    const noSender = await testEmailSender(
      { ...base, rawBody: { to: "d@acme.test" } },
      {
        pool: makePool({ provider: "smtp", fromEmail: "a@b.com" }),
        secretStore: makeSecretStore(),
        audit: makeAudit(),
        makeSender: () => null,
      }
    );
    assert.equal(noSender.kind === "ok" && noSender.result, "missing_credential");
  });

  it("classifies auth vs connection failures (no bare 500)", async () => {
    const auth = await testEmailSender(
      { ...base, rawBody: { to: "d@acme.test" } },
      {
        pool: makePool({ provider: "smtp", fromEmail: "a@b.com", smtpHost: "smtp.x" }),
        secretStore: makeSecretStore({ secret: "x" }),
        audit: makeAudit(),
        makeSender: () => throwingSender("EAUTH"),
      }
    );
    assert.equal(auth.kind === "ok" && auth.result, "invalid_credential");

    const conn = await testEmailSender(
      { ...base, rawBody: { to: "d@acme.test" } },
      {
        pool: makePool({ provider: "smtp", fromEmail: "a@b.com", smtpHost: "smtp.x" }),
        secretStore: makeSecretStore({ secret: "x" }),
        audit: makeAudit(),
        makeSender: () => throwingSender("ECONNREFUSED"),
      }
    );
    assert.equal(conn.kind === "ok" && conn.result, "provider_unreachable");
  });
});

describe("classifyEmailSendError (pure)", () => {
  it("maps EAUTH to invalid_credential and others to provider_unreachable", () => {
    assert.equal(
      classifyEmailSendError(Object.assign(new Error("x"), { code: "EAUTH" })),
      "invalid_credential"
    );
    assert.equal(
      classifyEmailSendError(Object.assign(new Error("x"), { code: "ETIMEDOUT" })),
      "provider_unreachable"
    );
    assert.equal(classifyEmailSendError(new Error("boom")), "provider_unreachable");
  });
});
