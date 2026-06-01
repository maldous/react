import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { resolveAccessToken } from "../../src/server/dependencies.ts";
import type { SessionStore, SessionRecord, CreateSessionCommand } from "@platform/session-runtime";
import { encryptToken } from "../../src/server/token-crypto.ts";

const KEY = "b".repeat(64);

function makeFakeStore(
  record: Partial<SessionRecord> | null
): SessionStore & { created: CreateSessionCommand[] } {
  const created: CreateSessionCommand[] = [];
  return {
    created,
    async create(cmd) {
      created.push(cmd);
      return "new-session-id";
    },
    async find(_id) {
      if (!record) return null;
      return {
        sessionId: "sid",
        userId: "u1",
        tenantId: "t1",
        organisationId: "o1",
        roles: ["tenant-admin"],
        permissions: [],
        displayName: "Test",
        expiresAt: new Date(Date.now() + 3600_000),
        createdAt: new Date(),
        ...record,
      };
    },
    async refresh() {},
    async destroy() {},
  };
}

describe("resolveAccessToken", () => {
  before(() => {
    process.env["TENANT_SECRET_ENCRYPTION_KEY"] = KEY;
  });
  after(() => {
    delete process.env["TENANT_SECRET_ENCRYPTION_KEY"];
  });

  it("returns decrypted token when not expired", async () => {
    const enc = encryptToken("valid-at");
    const store = makeFakeStore({
      accessTokenEnc: enc,
      refreshTokenEnc: encryptToken("rt"),
      accessTokenExpiresAt: new Date(Date.now() + 60_000),
    });
    const token = await resolveAccessToken("sid", store);
    assert.equal(token, "valid-at");
  });

  it("returns null when no accessTokenEnc in record", async () => {
    const store = makeFakeStore({});
    const token = await resolveAccessToken("sid", store);
    assert.equal(token, null);
  });

  it("returns null when session not found", async () => {
    const store = makeFakeStore(null);
    const token = await resolveAccessToken("sid", store);
    assert.equal(token, null);
  });
});
