import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  packageName,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
  type SessionRecord,
  type CreateSessionCommand,
} from "../src/index.ts";

describe("packageName", () => {
  it("exports the correct package name", () => {
    assert.equal(packageName, "@platform/session-runtime");
  });
});

describe("SESSION_COOKIE_NAME", () => {
  it("is platform_session", () => {
    assert.equal(SESSION_COOKIE_NAME, "platform_session");
  });
});

describe("SESSION_COOKIE_OPTIONS", () => {
  it("has httpOnly: true", () => {
    assert.equal(SESSION_COOKIE_OPTIONS.httpOnly, true);
  });

  it("has secure: true", () => {
    assert.equal(SESSION_COOKIE_OPTIONS.secure, true);
  });

  it("has sameSite: strict", () => {
    assert.equal(SESSION_COOKIE_OPTIONS.sameSite, "strict");
  });

  it("has path: /", () => {
    assert.equal(SESSION_COOKIE_OPTIONS.path, "/");
  });
});

describe("SessionRecord interface", () => {
  it("accepts a valid SessionRecord shape (type-level test)", () => {
    const record: SessionRecord = {
      sessionId: "sess-abc",
      userId: "user-1",
      tenantId: "tenant-1",
      organisationId: "org-1",
      roles: ["tenant-admin"],
      permissions: ["organisation.read"],
      displayName: "Alice",
      expiresAt: new Date(),
      createdAt: new Date(),
    };
    assert.equal(record.sessionId, "sess-abc");
    assert.equal(record.userId, "user-1");
    assert.deepEqual(record.roles, ["tenant-admin"]);
  });
});

describe("CreateSessionCommand interface", () => {
  it("accepts a valid CreateSessionCommand shape (type-level test)", () => {
    const cmd: CreateSessionCommand = {
      userId: "user-2",
      tenantId: "tenant-2",
      organisationId: "org-2",
      roles: ["viewer"],
      permissions: ["member.read", "profile.read_self"],
      displayName: "Bob",
      ttlSeconds: 3600,
    };
    assert.equal(cmd.ttlSeconds, 3600);
    assert.deepEqual(cmd.permissions, ["member.read", "profile.read_self"]);
  });
});
