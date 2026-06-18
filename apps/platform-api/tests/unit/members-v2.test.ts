/**
 * Unit tests for membership v2 usecases (ADR-ACT-0206): editMemberUsername,
 * setMemberStatus, resendInvite, listMemberExternalIdentities. Pure — no HTTP/DB.
 * Includes a guard proving the username is never written by the invite/IdP path.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AuditAction, type AuditEventPort, type AuditEvent } from "@platform/audit-events";
import {
  editMemberUsername,
  setMemberStatus,
  resendInvite,
  listMemberExternalIdentities,
  inviteOrgMember,
} from "../../src/usecases/members.ts";

const _dir = dirname(fileURLToPath(import.meta.url));
const ORG_ID = "a1b2c3d4-e5f6-4000-8000-000000000001";
const ACTOR_ID = "a1b2c3d4-e5f6-4000-8000-000000000002";
const ACTOR_ROLES = ["tenant-admin"];
const TARGET = "a1b2c3d4-e5f6-4000-8000-000000000099";

function makeAudit(opts: { shouldFail?: boolean } = {}): AuditEventPort & { events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  return {
    events,
    async emit(e) {
      if (opts.shouldFail) throw new Error("audit unavailable");
      events.push(e);
    },
    async query() {
      return [];
    },
  };
}

type Opts = {
  memberExists?: boolean;
  memberRole?: string;
  memberStatus?: string;
  usernameTaken?: boolean;
  activeAdminCount?: number;
  pendingInvite?: boolean;
  externalIdentities?: Record<string, unknown>[];
  userEmail?: string;
};

function routeMembershipReads(t: string, opts: Opts) {
  if (t.includes("lower(username) = lower"))
    return { rows: opts.usernameTaken ? [{ x: 1 }] : [], rowCount: 0 };
  if (t.includes("select 1 from memberships where user_id"))
    return { rows: opts.memberExists ? [{ x: 1 }] : [], rowCount: 0 };
  if (t.includes("select role, status from memberships"))
    return {
      rows: opts.memberExists
        ? [{ role: opts.memberRole ?? "member", status: opts.memberStatus ?? "active" }]
        : [],
      rowCount: 0,
    };
  if (t.includes("count(*)") && t.includes("status = 'active'"))
    return { rows: [{ cnt: opts.activeAdminCount ?? 1 }], rowCount: 1 };
  return null;
}

function routeRelatedReads(t: string, opts: Opts) {
  if (t.includes("from public.pending_invitations") && t.includes("select id"))
    return { rows: opts.pendingInvite ? [{ id: "inv-1" }] : [], rowCount: 0 };
  if (t.includes("from public.external_identities"))
    return { rows: opts.externalIdentities ?? [], rowCount: 0 };
  if (t.includes("from public.users"))
    return { rows: opts.userEmail ? [{ id: "user-1" }] : [], rowCount: 0 };
  if (t.startsWith("select id from memberships"))
    return { rows: opts.memberExists ? [{ id: "mem-1" }] : [], rowCount: 0 };
  return null;
}

function routeSpyQuery(text: string, opts: Opts) {
  const t = text.toLowerCase().trim();
  return routeMembershipReads(t, opts) ?? routeRelatedReads(t, opts) ?? { rows: [], rowCount: 1 };
}

function makeSpyPool(opts: Opts = {}) {
  const calls: { text: string; values?: unknown[] }[] = [];
  const route = (text: string) => routeSpyQuery(text, opts);
  const client = {
    escapeIdentifier: (s: string) => `"${s}"`,
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      return route(text);
    },
    release() {},
  };
  const pool = {
    async connect() {
      return client;
    },
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      return route(text);
    },
  } as never;
  return { calls, pool };
}

const wrote = (calls: { text: string }[], frag: string) =>
  calls.some((c) => c.text.toLowerCase().includes(frag));

describe("editMemberUsername", () => {
  it("rejects an invalid username (no audit, no write)", async () => {
    const audit = makeAudit();
    const { pool, calls } = makeSpyPool({ memberExists: true });
    const r = await editMemberUsername(
      {
        organisationId: ORG_ID,
        targetUserId: TARGET,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
        rawBody: { username: "no" },
      },
      { audit, pool }
    );
    assert.equal(r.kind, "invalid_body");
    assert.equal(audit.events.length, 0);
    assert.ok(!wrote(calls, "update memberships set username"));
  });

  it("returns not_found when the member is absent", async () => {
    const audit = makeAudit();
    const { pool } = makeSpyPool({ memberExists: false });
    const r = await editMemberUsername(
      {
        organisationId: ORG_ID,
        targetUserId: TARGET,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
        rawBody: { username: "jane.doe" },
      },
      { audit, pool }
    );
    assert.equal(r.kind, "not_found");
    assert.equal(audit.events.length, 0);
  });

  it("returns conflict when the username is taken (no audit)", async () => {
    const audit = makeAudit();
    const { pool, calls } = makeSpyPool({ memberExists: true, usernameTaken: true });
    const r = await editMemberUsername(
      {
        organisationId: ORG_ID,
        targetUserId: TARGET,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
        rawBody: { username: "jane.doe" },
      },
      { audit, pool }
    );
    assert.equal(r.kind, "conflict");
    assert.equal(audit.events.length, 0);
    assert.ok(!wrote(calls, "update memberships set username"));
  });

  it("sets the username and audits before the write", async () => {
    const order: string[] = [];
    const audit = makeAudit();
    const orig = audit.emit.bind(audit);
    audit.emit = async (e) => {
      order.push("audit");
      return orig(e);
    };
    const { pool, calls } = makeSpyPool({ memberExists: true });
    const r = await editMemberUsername(
      {
        organisationId: ORG_ID,
        targetUserId: TARGET,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
        rawBody: { username: "jane.doe" },
      },
      { audit, pool }
    );
    assert.equal(r.kind, "ok");
    assert.equal(audit.events[0]!.action, AuditAction.MemberUsernameChanged);
    const w = calls.findIndex((c) =>
      c.text.toLowerCase().includes("update memberships set username")
    );
    assert.ok(w !== -1 && order.indexOf("audit") === 0, "audit before write");
  });
});

describe("setMemberStatus", () => {
  it("rejects an invalid status", async () => {
    const { pool } = makeSpyPool({ memberExists: true });
    const r = await setMemberStatus(
      {
        organisationId: ORG_ID,
        targetUserId: TARGET,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
        rawBody: { status: "bogus" },
      },
      { audit: makeAudit(), pool }
    );
    assert.equal(r.kind, "invalid_body");
  });

  it("disables a member and audits before write", async () => {
    const audit = makeAudit();
    const { pool, calls } = makeSpyPool({
      memberExists: true,
      memberRole: "member",
      memberStatus: "active",
    });
    const r = await setMemberStatus(
      {
        organisationId: ORG_ID,
        targetUserId: TARGET,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
        rawBody: { status: "disabled" },
      },
      { audit, pool }
    );
    assert.equal(r.kind, "ok");
    assert.equal(audit.events[0]!.action, AuditAction.MemberStatusChanged);
    assert.ok(wrote(calls, "update memberships set status"));
  });

  it("re-enables a disabled member", async () => {
    const { pool } = makeSpyPool({
      memberExists: true,
      memberRole: "member",
      memberStatus: "disabled",
    });
    const r = await setMemberStatus(
      {
        organisationId: ORG_ID,
        targetUserId: TARGET,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
        rawBody: { status: "active" },
      },
      { audit: makeAudit(), pool }
    );
    assert.equal(r.kind, "ok");
  });

  it("refuses to disable the last active tenant-admin (no audit)", async () => {
    const audit = makeAudit();
    const { pool } = makeSpyPool({
      memberExists: true,
      memberRole: "tenant-admin",
      memberStatus: "active",
      activeAdminCount: 1,
    });
    const r = await setMemberStatus(
      {
        organisationId: ORG_ID,
        targetUserId: TARGET,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
        rawBody: { status: "disabled" },
      },
      { audit, pool }
    );
    assert.equal(r.kind, "last_admin_cannot_be_disabled");
    assert.equal(audit.events.length, 0);
  });

  it("disables an admin when others remain active", async () => {
    const { pool } = makeSpyPool({
      memberExists: true,
      memberRole: "tenant-admin",
      memberStatus: "active",
      activeAdminCount: 2,
    });
    const r = await setMemberStatus(
      {
        organisationId: ORG_ID,
        targetUserId: TARGET,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
        rawBody: { status: "disabled" },
      },
      { audit: makeAudit(), pool }
    );
    assert.equal(r.kind, "ok");
  });

  it("returns not_found when the member is absent", async () => {
    const { pool } = makeSpyPool({ memberExists: false });
    const r = await setMemberStatus(
      {
        organisationId: ORG_ID,
        targetUserId: TARGET,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
        rawBody: { status: "disabled" },
      },
      { audit: makeAudit(), pool }
    );
    assert.equal(r.kind, "not_found");
  });
});

describe("resendInvite", () => {
  it("rejects a missing email", async () => {
    const { pool } = makeSpyPool();
    const r = await resendInvite(
      { organisationId: ORG_ID, actorId: ACTOR_ID, actorRoles: ACTOR_ROLES, rawBody: {} },
      { audit: makeAudit(), pool }
    );
    assert.equal(r.kind, "invalid_body");
  });

  it("returns not_found when there is no pending invitation", async () => {
    const { pool } = makeSpyPool({ pendingInvite: false });
    const r = await resendInvite(
      {
        organisationId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
        rawBody: { email: "x@example.com" },
      },
      { audit: makeAudit(), pool }
    );
    assert.equal(r.kind, "not_found");
  });

  it("re-issues a pending invitation and audits before the update", async () => {
    const audit = makeAudit();
    const { pool, calls } = makeSpyPool({ pendingInvite: true });
    const r = await resendInvite(
      {
        organisationId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
        rawBody: { email: "X@Example.com" },
      },
      { audit, pool }
    );
    assert.equal(r.kind, "ok");
    assert.equal(audit.events[0]!.action, AuditAction.InvitationResent);
    assert.ok(wrote(calls, "update public.pending_invitations"));
  });
});

describe("listMemberExternalIdentities", () => {
  it("returns [] when the target is not a member of the tenant", async () => {
    const { pool } = makeSpyPool({ memberExists: false });
    const r = await listMemberExternalIdentities(
      { organisationId: ORG_ID, targetUserId: TARGET },
      pool
    );
    assert.deepEqual(r, []);
  });

  it("maps external identities for a member", async () => {
    const { pool } = makeSpyPool({
      memberExists: true,
      externalIdentities: [
        {
          id: "ei-1",
          provider: "mock-google",
          provider_subject: "sub-1",
          email: "x@example.com",
          created_at: new Date("2026-01-01T00:00:00Z"),
          last_seen_at: null,
        },
      ],
    });
    const r = await listMemberExternalIdentities(
      { organisationId: ORG_ID, targetUserId: TARGET },
      pool
    );
    assert.equal(r.length, 1);
    assert.equal(r[0]!.provider, "mock-google");
    assert.equal(r[0]!.subject, "sub-1");
    assert.equal(r[0]!.lastSeenAt, null);
  });
});

describe("tenant username is never set from the IdP / invite path", () => {
  it("inviteOrgMember does not write username into the membership", async () => {
    const audit = makeAudit();
    const { pool, calls } = makeSpyPool({ userEmail: "existing@example.com", memberExists: false });
    await inviteOrgMember(
      {
        rawBody: { email: "existing@example.com", role: "member" },
        organisationId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
      },
      { audit, pool }
    );
    const insert = calls.find((c) => c.text.toLowerCase().includes("insert into memberships"));
    assert.ok(insert, "expected a membership insert");
    assert.ok(
      !insert!.text.toLowerCase().includes("username"),
      "membership insert must not set username"
    );
  });

  it("the only username write in members.ts is editMemberUsername", () => {
    const src = readFileSync(join(_dir, "../../src/usecases/members.ts"), "utf8").toLowerCase();
    // No statement derives username from an upstream profile/claim/email/displayName.
    assert.ok(!/username\s*=\s*\$?\d*\s*.*claim/.test(src));
    assert.ok(!src.includes("set username = lower(email)"));
    // The sole username UPDATE is the explicit edit path.
    const updates = src.match(/update memberships set username/g) ?? [];
    assert.equal(updates.length, 1, "exactly one username UPDATE statement (editMemberUsername)");
  });
});
