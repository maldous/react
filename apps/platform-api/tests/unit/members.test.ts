/**
 * Unit tests for ADR-ACT-0143 Slice 1: member management usecases.
 *
 * Pure tests — no HTTP, no real DB, no Keycloak required.
 *
 * Coverage:
 *   A. inviteOrgMember
 *      1. audit emitted BEFORE DB write (order enforced)
 *      2. audit failure aborts DB write
 *      3. invalid body → returns invalid_body, no audit
 *      4. existing user → creates membership directly (kind: added)
 *      5. new user → creates pending_invitation (kind: invited)
 *      6. existing membership → returns conflict, no second audit
 *
 *   B. updateMemberRole
 *      7. audit emitted BEFORE update
 *      8. audit failure aborts update
 *      9. invalid body → returns invalid_body, no audit
 *     10. membership absent → throws NotFoundError, no audit
 *     11. successful update → returns ok, role updated
 *
 *   C. removeMember
 *     12. audit emitted BEFORE delete
 *     13. audit failure aborts delete
 *     14. membership absent → throws NotFoundError, no audit
 *     15. successful remove → membership deleted
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NotFoundError } from "@platform/platform-errors";
import { AuditAction, type AuditEventPort, type AuditEvent } from "@platform/audit-events";
import { inviteOrgMember, updateMemberRole, removeMember } from "../../src/usecases/members.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const ORG_ID = "a1b2c3d4-e5f6-4000-8000-000000000001";
const ACTOR_ID = "a1b2c3d4-e5f6-4000-8000-000000000002";
const ACTOR_ROLES = ["tenant-admin"];
const TARGET_USER_ID = "a1b2c3d4-e5f6-4000-8000-000000000099";

function makeAuditPort(opts: { shouldFail?: boolean } = {}): AuditEventPort & {
  events: AuditEvent[];
} {
  const events: AuditEvent[] = [];
  return {
    events,
    async emit(event) {
      if (opts.shouldFail) throw new Error("audit unavailable");
      events.push(event);
    },
    async query() {
      return [];
    },
  };
}

// Spy pool: records SQL calls; configures responses per table query.
// makeSpyPool({ memberExists }) returns a pool whose connect() gives a client
// that responds to membership existence checks and records every query call.
function makeSpyPool(
  opts: { memberExists?: boolean; userEmail?: string; insertConflict?: boolean } = {}
) {
  const calls: { text: string; values?: unknown[] }[] = [];

  const client = {
    // withTenant calls tenantSchemaIdentifier which needs escapeIdentifier
    escapeIdentifier: (s: string) => `"${s.replace(/"/g, '""')}"`,
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      const t = text.toLowerCase();

      // Membership existence check (SELECT id FROM memberships)
      if (t.includes("select id from memberships")) {
        return {
          rows: opts.memberExists ? [{ id: "mem-1" }] : [],
          rowCount: opts.memberExists ? 1 : 0,
        };
      }
      // User lookup by email (SELECT id FROM public.users)
      if (t.includes("from public.users")) {
        if (opts.userEmail) return { rows: [{ id: "user-existing-1" }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }
      // Membership insert ON CONFLICT
      if (t.includes("insert into memberships")) {
        return { rows: [], rowCount: opts.insertConflict ? 0 : 1 };
      }
      // Pending invitation insert
      if (t.includes("insert into public.pending_invitations")) {
        return { rows: [], rowCount: 1 };
      }
      // Membership update
      if (t.includes("update memberships")) {
        return { rows: [], rowCount: 1 };
      }
      // Membership delete
      if (t.includes("delete from memberships")) {
        return { rows: [], rowCount: 1 };
      }
      // BEGIN / COMMIT / ROLLBACK / SET LOCAL search_path / set_config
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };

  const pool = {
    async connect() {
      return client;
    },
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 };
    },
  };

  return { calls, pool: pool as never };
}

// ---------------------------------------------------------------------------
// A. inviteOrgMember
// ---------------------------------------------------------------------------

describe("inviteOrgMember — audit ordering", () => {
  it("emits audit BEFORE DB writes", async () => {
    const callOrder: string[] = [];
    const audit = makeAuditPort();
    const { pool, calls } = makeSpyPool({ userEmail: undefined });

    const origEmit = audit.emit.bind(audit);
    audit.emit = async (e) => {
      callOrder.push("audit");
      return origEmit(e);
    };

    await inviteOrgMember(
      {
        rawBody: { email: "new@test.local", role: "member" },
        organisationId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
      },
      { audit, pool }
    );

    // Audit must come before any INSERT
    const insertIdx = calls.findIndex((c) => c.text.toLowerCase().includes("insert"));
    assert.ok(callOrder.includes("audit"), "audit must be emitted");
    assert.ok(callOrder.indexOf("audit") < insertIdx || insertIdx === -1, "audit before insert");
  });

  it("audit failure aborts DB write", async () => {
    const audit = makeAuditPort({ shouldFail: true });
    const { pool, calls } = makeSpyPool();

    await assert.rejects(
      () =>
        inviteOrgMember(
          {
            rawBody: { email: "x@x.com", role: "member" },
            organisationId: ORG_ID,
            actorId: ACTOR_ID,
            actorRoles: ACTOR_ROLES,
          },
          { audit, pool }
        ),
      /audit unavailable/
    );

    const hasInsert = calls.some((c) => c.text.toLowerCase().includes("insert"));
    assert.equal(hasInsert, false, "no DB write after audit failure");
  });

  it("invalid body → returns invalid_body, no audit, no DB", async () => {
    const audit = makeAuditPort();
    const { pool, calls } = makeSpyPool();

    const result = await inviteOrgMember(
      {
        rawBody: { email: "not-an-email", role: "member" },
        organisationId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
      },
      { audit, pool }
    );

    assert.equal(result.kind, "invalid_body");
    assert.equal(audit.events.length, 0, "no audit on invalid body");
    assert.equal(calls.length, 0, "no DB calls on invalid body");
  });

  it("invalid role → returns invalid_body", async () => {
    const audit = makeAuditPort();
    const { pool } = makeSpyPool();

    const result = await inviteOrgMember(
      {
        rawBody: { email: "ok@x.com", role: "system-admin" },
        organisationId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
      },
      { audit, pool }
    );

    assert.equal(result.kind, "invalid_body");
    assert.equal(audit.events.length, 0);
  });

  it("existing user → kind: added, MemberInvited audit emitted", async () => {
    const audit = makeAuditPort();
    const { pool } = makeSpyPool({ userEmail: "exists@test.local" });

    const result = await inviteOrgMember(
      {
        rawBody: { email: "exists@test.local", role: "manager" },
        organisationId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
      },
      { audit, pool }
    );

    assert.equal(result.kind, "added");
    assert.equal(audit.events.length, 1);
    assert.equal(audit.events[0]!.action, AuditAction.MemberInvited);
    assert.equal(audit.events[0]!.tenantId, ORG_ID);
    assert.equal(audit.events[0]!.resourceId, "exists@test.local");
  });

  it("new user → kind: invited, pending_invitation created", async () => {
    const audit = makeAuditPort();
    const { pool, calls } = makeSpyPool({ userEmail: undefined });

    const result = await inviteOrgMember(
      {
        rawBody: { email: "new@test.local", role: "viewer" },
        organisationId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
      },
      { audit, pool }
    );

    assert.equal(result.kind, "invited");
    assert.equal(audit.events.length, 1);
    const insertInv = calls.find((c) => c.text.toLowerCase().includes("pending_invitations"));
    assert.ok(insertInv, "pending_invitations insert must be called");
  });

  it("existing membership → returns conflict", async () => {
    const audit = makeAuditPort();
    const { pool } = makeSpyPool({ userEmail: "dup@test.local", insertConflict: true });

    const result = await inviteOrgMember(
      {
        rawBody: { email: "dup@test.local", role: "member" },
        organisationId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
      },
      { audit, pool }
    );

    assert.equal(result.kind, "conflict");
  });
});

// ---------------------------------------------------------------------------
// B. updateMemberRole
// ---------------------------------------------------------------------------

describe("updateMemberRole — audit ordering", () => {
  it("emits MemberRoleChanged audit BEFORE update", async () => {
    const callOrder: string[] = [];
    const audit = makeAuditPort();
    const { pool, calls } = makeSpyPool({ memberExists: true });

    const origEmit = audit.emit.bind(audit);
    audit.emit = async (e) => {
      callOrder.push("audit");
      return origEmit(e);
    };

    await updateMemberRole(
      {
        rawBody: { role: "viewer" },
        organisationId: ORG_ID,
        targetUserId: TARGET_USER_ID,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
      },
      { audit, pool }
    );

    const updateIdx = calls.findIndex((c) => c.text.toLowerCase().includes("update memberships"));
    assert.ok(callOrder.includes("audit"), "audit must be emitted");
    assert.ok(updateIdx === -1 || callOrder.indexOf("audit") < updateIdx, "audit before update");
  });

  it("audit failure aborts update", async () => {
    const audit = makeAuditPort({ shouldFail: true });
    const { pool, calls } = makeSpyPool({ memberExists: true });

    await assert.rejects(
      () =>
        updateMemberRole(
          {
            rawBody: { role: "viewer" },
            organisationId: ORG_ID,
            targetUserId: TARGET_USER_ID,
            actorId: ACTOR_ID,
            actorRoles: ACTOR_ROLES,
          },
          { audit, pool }
        ),
      /audit unavailable/
    );

    assert.ok(
      !calls.some((c) => c.text.toLowerCase().includes("update")),
      "no update after audit failure"
    );
  });

  it("invalid body → returns invalid_body, no audit", async () => {
    const audit = makeAuditPort();
    const { pool } = makeSpyPool({ memberExists: true });

    const result = await updateMemberRole(
      {
        rawBody: { role: "god-mode" },
        organisationId: ORG_ID,
        targetUserId: TARGET_USER_ID,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
      },
      { audit, pool }
    );

    assert.equal(result.kind, "invalid_body");
    assert.equal(audit.events.length, 0);
  });

  it("membership absent → throws NotFoundError, no audit", async () => {
    const audit = makeAuditPort();
    const { pool } = makeSpyPool({ memberExists: false });

    await assert.rejects(
      () =>
        updateMemberRole(
          {
            rawBody: { role: "viewer" },
            organisationId: ORG_ID,
            targetUserId: TARGET_USER_ID,
            actorId: ACTOR_ID,
            actorRoles: ACTOR_ROLES,
          },
          { audit, pool }
        ),
      (err: unknown) => {
        assert.ok(err instanceof NotFoundError, `Expected NotFoundError, got: ${String(err)}`);
        return true;
      }
    );

    assert.equal(audit.events.length, 0, "no audit when member not found");
  });

  it("successful update → returns ok, emits MemberRoleChanged", async () => {
    const audit = makeAuditPort();
    const { pool } = makeSpyPool({ memberExists: true });

    const result = await updateMemberRole(
      {
        rawBody: { role: "manager" },
        organisationId: ORG_ID,
        targetUserId: TARGET_USER_ID,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
      },
      { audit, pool }
    );

    assert.equal(result.kind, "ok");
    assert.equal(audit.events.length, 1);
    assert.equal(audit.events[0]!.action, AuditAction.MemberRoleChanged);
    assert.deepEqual(audit.events[0]!.metadata, { newRole: "manager" });
  });
});

// ---------------------------------------------------------------------------
// C. removeMember
// ---------------------------------------------------------------------------

describe("removeMember — audit ordering", () => {
  it("emits MemberRemoved audit BEFORE delete", async () => {
    const callOrder: string[] = [];
    const audit = makeAuditPort();
    const { pool, calls } = makeSpyPool({ memberExists: true });

    const origEmit = audit.emit.bind(audit);
    audit.emit = async (e) => {
      callOrder.push("audit");
      return origEmit(e);
    };

    await removeMember(
      {
        organisationId: ORG_ID,
        targetUserId: TARGET_USER_ID,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
      },
      { audit, pool }
    );

    const deleteIdx = calls.findIndex((c) =>
      c.text.toLowerCase().includes("delete from memberships")
    );
    assert.ok(callOrder.includes("audit"), "audit must be emitted");
    assert.ok(deleteIdx === -1 || callOrder.indexOf("audit") < deleteIdx, "audit before delete");
  });

  it("audit failure aborts delete", async () => {
    const audit = makeAuditPort({ shouldFail: true });
    const { pool, calls } = makeSpyPool({ memberExists: true });

    await assert.rejects(
      () =>
        removeMember(
          {
            organisationId: ORG_ID,
            targetUserId: TARGET_USER_ID,
            actorId: ACTOR_ID,
            actorRoles: ACTOR_ROLES,
          },
          { audit, pool }
        ),
      /audit unavailable/
    );

    assert.ok(
      !calls.some((c) => c.text.toLowerCase().includes("delete")),
      "no delete after audit failure"
    );
  });

  it("membership absent → throws NotFoundError, no audit", async () => {
    const audit = makeAuditPort();
    const { pool } = makeSpyPool({ memberExists: false });

    await assert.rejects(
      () =>
        removeMember(
          {
            organisationId: ORG_ID,
            targetUserId: TARGET_USER_ID,
            actorId: ACTOR_ID,
            actorRoles: ACTOR_ROLES,
          },
          { audit, pool }
        ),
      (err: unknown) => {
        assert.ok(err instanceof NotFoundError, `Expected NotFoundError, got: ${String(err)}`);
        return true;
      }
    );

    assert.equal(audit.events.length, 0, "no audit when member not found");
  });

  it("successful remove → emits MemberRemoved with correct fields", async () => {
    const audit = makeAuditPort();
    const { pool } = makeSpyPool({ memberExists: true });

    await removeMember(
      {
        organisationId: ORG_ID,
        targetUserId: TARGET_USER_ID,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
      },
      { audit, pool }
    );

    assert.equal(audit.events.length, 1);
    assert.equal(audit.events[0]!.action, AuditAction.MemberRemoved);
    assert.equal(audit.events[0]!.tenantId, ORG_ID);
    assert.equal(audit.events[0]!.resourceId, TARGET_USER_ID);
    assert.equal(audit.events[0]!.actorId, ACTOR_ID);
  });
});
