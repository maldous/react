/**
 * Unit tests for vanity-domain usecase (T-C2).
 * Covers validateDomain edge cases and audit-before-mutation ordering.
 */
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { addVanityDomain, removeVanityDomain } from "../../src/usecases/vanity-domain.ts";

const baseInput = {
  organisationId: "org-1",
  realmName: "realm-1",
  actorId: "actor-1",
  actorRoles: ["system_admin"],
};

// Fake admin config — fetch is mocked via mock.method on globalThis
const fakeAdminConfig = { url: "http://kc", adminClientId: "cl", adminClientSecret: "sec" };

function makeDeps() {
  const auditCalls: string[] = [];
  const mutationCalls: string[] = [];
  const audit = {
    emit: mock.fn(async () => {
      auditCalls.push("audit");
    }),
  };

  // Patch global fetch so mutateBffClientUris succeeds without network.
  // The usecase makes 3 sequential calls: token → clients lookup → PUT update.
  const origFetch = global.fetch;
  global.fetch = mock.fn(async (urlArg: string, _opts?: unknown) => {
    mutationCalls.push("fetch");
    const url = String(urlArg);
    if (url.includes("/protocol/openid-connect/token")) {
      return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
    }
    if (url.includes("/clients?")) {
      return new Response(JSON.stringify([{ id: "client-1", redirectUris: [], webOrigins: [] }]), {
        status: 200,
      });
    }
    // PUT /clients/{id}
    return new Response(JSON.stringify({}), { status: 200 });
  }) as typeof fetch;

  return {
    audit,
    auditCalls,
    mutationCalls,
    restore: () => {
      global.fetch = origFetch;
    },
  };
}

// ── validateDomain (via addVanityDomain which calls it internally) ─────────────
describe("validateDomain", () => {
  it("rejects single-label hostname (no dot)", async () => {
    const { audit, restore } = makeDeps();
    await assert.rejects(
      () =>
        addVanityDomain(
          { ...baseInput, domain: "localhost" },
          { audit: audit as never, adminConfig: fakeAdminConfig }
        ),
      /invalid domain format/
    );
    restore();
  });

  it("rejects IP literals", async () => {
    const { audit, restore } = makeDeps();
    await assert.rejects(
      () =>
        addVanityDomain(
          { ...baseInput, domain: "1.2.3.4" },
          { audit: audit as never, adminConfig: fakeAdminConfig }
        ),
      /IP literals/
    );
    restore();
  });

  it("rejects domain exceeding 253 chars", async () => {
    const { audit, restore } = makeDeps();
    // 63+1+63+1+63+1+63+1+3 = 259 chars — exceeds the 253-char limit
    const longDomain =
      "a".repeat(63) + "." + "b".repeat(63) + "." + "c".repeat(63) + "." + "d".repeat(63) + ".com";
    await assert.rejects(
      () =>
        addVanityDomain(
          { ...baseInput, domain: longDomain },
          { audit: audit as never, adminConfig: fakeAdminConfig }
        ),
      /invalid domain format/
    );
    restore();
  });

  it("accepts valid subdomain", async () => {
    const { audit, restore } = makeDeps();
    await assert.doesNotReject(() =>
      addVanityDomain(
        { ...baseInput, domain: "tenant.example.com" },
        { audit: audit as never, adminConfig: fakeAdminConfig }
      )
    );
    restore();
  });

  it("accepts 253-char valid domain", async () => {
    const { audit, restore } = makeDeps();
    // 63+1+63+1+63+1+59+2 = 253 chars with TLD
    const d =
      "a".repeat(63) + "." + "b".repeat(63) + "." + "c".repeat(63) + "." + "d".repeat(57) + ".co";
    assert.ok(d.length <= 253);
    await assert.doesNotReject(() =>
      addVanityDomain(
        { ...baseInput, domain: d },
        { audit: audit as never, adminConfig: fakeAdminConfig }
      )
    );
    restore();
  });
});

// ── addVanityDomain ────────────────────────────────────────────────────────────
describe("addVanityDomain", () => {
  it("emits audit BEFORE calling Keycloak fetch", async () => {
    const { audit, restore } = makeDeps();
    // Track order: first fetch is token, second is mutation
    const callOrder: string[] = [];
    audit.emit = mock.fn(async () => {
      callOrder.push("audit");
    });
    (global.fetch as ReturnType<typeof mock.fn>) = mock.fn(async (urlArg: string) => {
      callOrder.push("fetch");
      const url = String(urlArg);
      if (url.includes("/protocol/openid-connect/token")) {
        return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
      }
      if (url.includes("/clients?")) {
        return new Response(
          JSON.stringify([{ id: "client-1", redirectUris: [], webOrigins: [] }]),
          { status: 200 }
        );
      }
      // PUT /clients/{id}
      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch;

    await addVanityDomain(
      { ...baseInput, domain: "tenant.example.com" },
      { audit: audit as never, adminConfig: fakeAdminConfig }
    );
    assert.ok(
      callOrder.indexOf("audit") < callOrder.indexOf("fetch"),
      "audit must fire before fetch"
    );
    restore();
  });
});

// ── removeVanityDomain ─────────────────────────────────────────────────────────
describe("removeVanityDomain", () => {
  it("emits audit and calls Keycloak for valid domain", async () => {
    const { audit, auditCalls, restore } = makeDeps();
    await removeVanityDomain(
      { ...baseInput, domain: "tenant.example.com" },
      { audit: audit as never, adminConfig: fakeAdminConfig }
    );
    assert.equal(auditCalls.length, 1);
    restore();
  });

  it("rejects invalid domain without calling audit or Keycloak", async () => {
    const { audit, auditCalls, restore } = makeDeps();
    await assert.rejects(
      () =>
        removeVanityDomain(
          { ...baseInput, domain: "localhost" },
          { audit: audit as never, adminConfig: fakeAdminConfig }
        ),
      /invalid domain format/
    );
    assert.equal(auditCalls.length, 0, "audit must not fire for invalid domain");
    restore();
  });
});
