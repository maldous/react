/**
 * Unit tests for ADR-ACT-0154: audit-first Auth Settings mutations.
 *
 * Tests are pure — no HTTP, no Keycloak, no DB required.
 *
 * Coverage:
 *   A. mutateAuthSetting generic usecase
 *      1. audit emitted before adapter mutation (order enforced)
 *      2. audit failure prevents Keycloak mutation
 *      3. invalid body → no audit, no mutation, returns invalid_body
 *      4. no tenant context → no audit, no mutation, returns no_tenant
 *      5. all four mutation routes (idp / mfa / session / sysadmin-brokering)
 *
 *   B. buildIdpAuditMetadata sanitization
 *      6. config values stripped, only keys recorded
 *      7. no secret fields in metadata
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  mutateAuthSetting,
  buildIdpAuditMetadata,
  buildMfaAuditMetadata,
  buildSessionAuditMetadata,
  buildSysadminBrokeringAuditMetadata,
} from "../../src/usecases/auth-settings.ts";
import { AuditAction, type AuditEventPort, type AuditEvent } from "@platform/audit-events";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TENANT_CTX = { organisationId: "org-aaa", realmName: "tenant-org-aaa" };
const ACTOR_ID = "user-tenant-admin";
const ACTOR_ROLES = ["tenant-admin"];

function makeAuditPort(opts: { shouldFail?: boolean } = {}): AuditEventPort & {
  events: AuditEvent[];
  callCount: number;
} {
  const events: AuditEvent[] = [];
  let callCount = 0;
  return {
    events,
    get callCount() {
      return callCount;
    },
    async emit(event) {
      callCount++;
      if (opts.shouldFail) throw new Error("audit store unavailable");
      events.push(event);
    },
    async query() {
      return [];
    },
  };
}

function makeMutateSpy(): { calls: unknown[]; fn: (body: unknown) => Promise<void> } {
  const calls: unknown[] = [];
  return {
    calls,
    fn: async (body: unknown) => {
      calls.push(body);
    },
  };
}

// Simple schemas for testing
const SimpleSchema = z.object({ value: z.string() });
const buildSimpleMeta = (body: { value: string }) => ({ value: body.value });

// ---------------------------------------------------------------------------
// A. mutateAuthSetting generic usecase
// ---------------------------------------------------------------------------

describe("mutateAuthSetting — ordering", () => {
  it("emits audit BEFORE calling mutate (audit order enforced)", async () => {
    const callOrder: string[] = [];
    const audit = makeAuditPort();
    const originalEmit = audit.emit.bind(audit);
    audit.emit = async (event) => {
      callOrder.push("audit");
      return originalEmit(event);
    };

    await mutateAuthSetting(
      {
        rawBody: { value: "test" },
        tenantCtx: TENANT_CTX,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
        auditAction: "test.action",
        buildAuditMetadata: buildSimpleMeta,
        schema: SimpleSchema,
        mutate: async () => {
          callOrder.push("mutate");
        },
      },
      { audit }
    );

    assert.deepEqual(callOrder, ["audit", "mutate"]);
  });

  it("audit failure prevents mutation", async () => {
    const audit = makeAuditPort({ shouldFail: true });
    const spy = makeMutateSpy();

    await assert.rejects(
      () =>
        mutateAuthSetting(
          {
            rawBody: { value: "test" },
            tenantCtx: TENANT_CTX,
            actorId: ACTOR_ID,
            actorRoles: ACTOR_ROLES,
            auditAction: "test.action",
            buildAuditMetadata: buildSimpleMeta,
            schema: SimpleSchema,
            mutate: spy.fn,
          },
          { audit }
        ),
      /audit store unavailable/
    );

    assert.equal(spy.calls.length, 0, "mutate must not be called when audit fails");
  });

  it("invalid body → returns invalid_body, no audit, no mutation", async () => {
    const audit = makeAuditPort();
    const spy = makeMutateSpy();

    const result = await mutateAuthSetting(
      {
        rawBody: { wrong_field: 123 },
        tenantCtx: TENANT_CTX,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
        auditAction: "test.action",
        buildAuditMetadata: buildSimpleMeta,
        schema: SimpleSchema,
        mutate: spy.fn,
      },
      { audit }
    );

    assert.equal(result.kind, "invalid_body");
    assert.equal(audit.events.length, 0, "no audit event on invalid body");
    assert.equal(spy.calls.length, 0, "no mutation on invalid body");
  });

  it("no tenant context → returns no_tenant, no audit, no mutation", async () => {
    const audit = makeAuditPort();
    const spy = makeMutateSpy();

    const result = await mutateAuthSetting(
      {
        rawBody: { value: "test" },
        tenantCtx: null,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
        auditAction: "test.action",
        buildAuditMetadata: buildSimpleMeta,
        schema: SimpleSchema,
        mutate: spy.fn,
      },
      { audit }
    );

    assert.equal(result.kind, "no_tenant");
    assert.equal(audit.events.length, 0, "no audit event when tenant context absent");
    assert.equal(spy.calls.length, 0, "no mutation when tenant context absent");
  });

  it("successful mutation → returns ok, audit emitted with correct tenant fields", async () => {
    const audit = makeAuditPort();
    const spy = makeMutateSpy();

    const result = await mutateAuthSetting(
      {
        rawBody: { value: "good" },
        tenantCtx: TENANT_CTX,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
        auditAction: "test.action",
        buildAuditMetadata: buildSimpleMeta,
        schema: SimpleSchema,
        mutate: spy.fn,
      },
      { audit }
    );

    assert.equal(result.kind, "ok");
    assert.equal(audit.events.length, 1);
    const evt = audit.events[0]!;
    assert.equal(evt.tenantId, TENANT_CTX.organisationId);
    assert.equal(evt.actorId, ACTOR_ID);
    assert.equal(evt.resource, "auth_settings");
    assert.equal(evt.resourceId, TENANT_CTX.realmName);
    assert.equal(spy.calls.length, 1);
  });
});

// ---------------------------------------------------------------------------
// All four mutation routes: correct audit action per route
// ---------------------------------------------------------------------------

describe("mutateAuthSetting — all four routes emit correct audit action", () => {
  const IdpSchema = z.object({
    alias: z.string(),
    displayName: z.string(),
    providerId: z.string(),
    config: z.record(z.string()).default({}),
    enabled: z.boolean().default(true),
  });

  const MfaSchema = z.object({
    required: z.string(),
    type: z.string().optional(),
  });

  const SessionSchema = z.object({
    accessTokenLifespanSeconds: z.number(),
    ssoSessionIdleTimeoutSeconds: z.number(),
    ssoSessionMaxLifespanSeconds: z.number(),
    rememberMe: z.boolean(),
  });

  const BrokeringSchema = z.object({
    enabled: z.boolean(),
    requireMfa: z.boolean().optional(),
    auditAllAccess: z.boolean().optional(),
  });

  const cases = [
    {
      label: "idp",
      action: AuditAction.AuthSettingsIdpChanged,
      body: {
        alias: "google",
        displayName: "Google",
        providerId: "oidc",
        config: {},
        enabled: true,
      },
      schema: IdpSchema,
      meta: buildIdpAuditMetadata,
    },
    {
      label: "mfa",
      action: AuditAction.AuthSettingsMfaChanged,
      body: { required: "optional", type: "totp" },
      schema: MfaSchema,
      meta: buildMfaAuditMetadata,
    },
    {
      label: "session",
      action: AuditAction.AuthSettingsSessionChanged,
      body: {
        accessTokenLifespanSeconds: 900,
        ssoSessionIdleTimeoutSeconds: 1800,
        ssoSessionMaxLifespanSeconds: 36000,
        rememberMe: false,
      },
      schema: SessionSchema,
      meta: buildSessionAuditMetadata,
    },
    {
      label: "sysadmin-brokering",
      action: AuditAction.AuthSettingsSysadminBrokeringChanged,
      body: { enabled: true, requireMfa: true, auditAllAccess: true },
      schema: BrokeringSchema,
      meta: buildSysadminBrokeringAuditMetadata,
    },
  ] as const;

  for (const tc of cases) {
    it(`${tc.label} route emits ${tc.action}`, async () => {
      const audit = makeAuditPort();
      await mutateAuthSetting(
        {
          rawBody: tc.body,
          tenantCtx: TENANT_CTX,
          actorId: ACTOR_ID,
          actorRoles: ACTOR_ROLES,
          auditAction: tc.action,
          buildAuditMetadata: tc.meta as (b: typeof tc.body) => Record<string, unknown>,
          schema: tc.schema as z.ZodType<typeof tc.body>,
          mutate: async () => {},
        },
        { audit }
      );
      assert.equal(audit.events.length, 1);
      assert.equal(audit.events[0]!.action, tc.action);
    });
  }
});

// ---------------------------------------------------------------------------
// B. buildIdpAuditMetadata — secrets must not appear in metadata
// ---------------------------------------------------------------------------

describe("buildIdpAuditMetadata — sanitization", () => {
  it("includes alias, displayName, providerId, enabled", () => {
    const meta = buildIdpAuditMetadata({
      alias: "my-idp",
      displayName: "My IDP",
      providerId: "oidc",
      config: {},
      enabled: true,
    });
    assert.equal(meta["alias"], "my-idp");
    assert.equal(meta["providerId"], "oidc");
    assert.equal(meta["enabled"], true);
  });

  it("records config key names but NOT values", () => {
    const meta = buildIdpAuditMetadata({
      alias: "saml-idp",
      displayName: "SAML",
      providerId: "saml",
      config: {
        clientSecret: "super-secret-value",
        signingKey: "-----BEGIN PRIVATE KEY-----",
        entityId: "https://idp.example.com",
      },
      enabled: true,
    });

    const serialized = JSON.stringify(meta);
    // Values must not appear
    assert.ok(
      !serialized.includes("super-secret-value"),
      "clientSecret value must not be in metadata"
    );
    assert.ok(!serialized.includes("BEGIN PRIVATE KEY"), "signing key must not be in metadata");
    // Keys should appear (informative without leaking)
    const configKeys = meta["configKeys"] as string[];
    assert.ok(Array.isArray(configKeys));
    assert.ok(configKeys.includes("clientSecret"), "key name may appear");
    assert.ok(configKeys.includes("signingKey"), "key name may appear");
  });

  it("config field itself is not present in metadata", () => {
    const meta = buildIdpAuditMetadata({
      alias: "x",
      displayName: "X",
      providerId: "oidc",
      config: { secret: "leak-me" },
      enabled: false,
    });
    assert.ok(!("config" in meta), "raw config object must not be in metadata");
  });
});
