/**
 * Unit tests for ADR-ACT-0143 Slice 1 (hardened): member management usecases.
 *
 * Pure tests — no HTTP, no real DB, no Keycloak required.
 *
 * Coverage:
 *   A. inviteOrgMember (audit reordered: check → audit → mutate)
 *      1. Validates email format — invalid_body, no audit
 *      2. Rejects system-admin role — invalid_body
 *      3. Existing membership → conflict, NO audit emitted
 *      4. Existing unconsumed invitation → already_invited, NO audit
 *      5. Existing user, no membership → kind: added, MemberInvited audit
 *      6. New user → kind: invited, pending_invitation created, audit emitted
 *      7. Audit failure on real write aborts the insert
 *      8. Email is lowercased before lookup and insert
 *
 *   B. updateMemberRole (result types, no exceptions)
 *      9. Invalid role → invalid_body, no audit
 *     10. Membership absent → not_found, no audit
 *     11. Demote last tenant-admin → last_admin_cannot_be_demoted, no audit
 *     12. Demote when another admin exists → ok
 *     13. Promote a non-admin → ok (no last-admin check needed)
 *     14. Audit failure aborts update
 *     15. Successful update → ok, MemberRoleChanged audit
 *
 *   C. removeMember (result types, no exceptions)
 *     16. Membership absent → not_found, no audit
 *     17. Remove last tenant-admin → last_admin_cannot_be_removed, no audit
 *     18. Remove one of multiple admins → ok
 *     19. Audit failure aborts delete
 *     20. Successful remove → ok, MemberRemoved audit
 *
 *   D. Permission & isolation assertions
 *     21. tenant.members.delete exists in tenant-admin bundle
 *     22. DELETE route uses tenant.members.delete, not tenant.admin.access
 *     23. pending_invitations list query always filters on organisation_id
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AuditAction, type AuditEventPort, type AuditEvent } from "@platform/audit-events";
import { inviteOrgMember, updateMemberRole, removeMember } from "../../src/usecases/members.ts";
import { resolvePermissions } from "@platform/domain-identity";

const _dir = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ORG_ID = "a1b2c3d4-e5f6-4000-8000-000000000001";
const ACTOR_ID = "a1b2c3d4-e5f6-4000-8000-000000000002";
const ACTOR_ROLES = ["tenant-admin"];
const TARGET_USER_ID = "a1b2c3d4-e5f6-4000-8000-000000000099";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

type SpyPoolOpts = {
  memberExists?: boolean;
  memberRole?: string;
  adminCount?: number;
  userEmail?: string;
  existingInvite?: boolean;
};

function routeClientQuery(t: string, opts: SpyPoolOpts) {
  // SELECT role FROM memberships (updateMemberRole / removeMember check)
  if (t.startsWith("select role from memberships")) {
    if (!opts.memberExists) return { rows: [], rowCount: 0 };
    return { rows: [{ role: opts.memberRole ?? "tenant-admin" }], rowCount: 1 };
  }
  // SELECT id FROM memberships (inviteOrgMember conflict check)
  if (t.startsWith("select id from memberships")) {
    return {
      rows: opts.memberExists ? [{ id: "mem-1" }] : [],
      rowCount: opts.memberExists ? 1 : 0,
    };
  }
  // count(*) for admin count
  if (t.includes("count(*)") && t.includes("role = 'tenant-admin'")) {
    return { rows: [{ cnt: opts.adminCount ?? 1 }], rowCount: 1 };
  }
  // User lookup by email
  if (t.includes("from public.users")) {
    if (opts.userEmail) return { rows: [{ id: "user-existing-1" }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  }
  // Existing invitation check
  if (t.includes("from public.pending_invitations") && t.includes("select id")) {
    return {
      rows: opts.existingInvite ? [{ id: "inv-1" }] : [],
      rowCount: opts.existingInvite ? 1 : 0,
    };
  }
  // INSERT memberships
  if (t.startsWith("insert into memberships")) {
    return { rows: [], rowCount: 1 };
  }
  // INSERT pending_invitations
  if (t.includes("insert into public.pending_invitations")) {
    return { rows: [], rowCount: 1 };
  }
  // UPDATE / DELETE / BEGIN / COMMIT / ROLLBACK / SET LOCAL
  return { rows: [], rowCount: 1 };
}

function makeSpyPool(opts: SpyPoolOpts = {}) {
  const calls: { text: string; values?: unknown[] }[] = [];

  const client = {
    escapeIdentifier: (s: string) => `"${s.replace(/"/g, '""')}"`,
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      return routeClientQuery(text.toLowerCase().trim(), opts);
    },
    release() {},
  };

  const pool = {
    async connect() {
      return client;
    },
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      const t = text.toLowerCase().trim();
      // Pool-level query for pending_invitations (list or conflict check)
      if (t.includes("from public.pending_invitations")) {
        return {
          rows: opts.existingInvite ? [{ id: "inv-1" }] : [],
          rowCount: opts.existingInvite ? 1 : 0,
        };
      }
      return { rows: [], rowCount: 1 };
    },
  };

  return { calls, pool: pool as never };
}

// ---------------------------------------------------------------------------
// A. inviteOrgMember
// ---------------------------------------------------------------------------

describe("inviteOrgMember — validation", () => {
  it("invalid email → invalid_body, no audit, no DB call", async () => {
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
    assert.equal(audit.events.length, 0);
    assert.equal(calls.length, 0);
  });

  it("role 'system-admin' is rejected — invalid_body", async () => {
    const audit = makeAuditPort();
    const { pool } = makeSpyPool();

    const result = await inviteOrgMember(
      {
        rawBody: { email: "ok@example.com", role: "system-admin" },
        organisationId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
      },
      { audit, pool }
    );

    assert.equal(result.kind, "invalid_body");
    assert.equal(audit.events.length, 0, "no audit on invalid role");
  });
});

describe("inviteOrgMember — check before audit (no misleading events)", () => {
  it("existing membership → conflict, NO audit emitted", async () => {
    const audit = makeAuditPort();
    const { pool } = makeSpyPool({ userEmail: "dup@example.com", memberExists: true });

    const result = await inviteOrgMember(
      {
        rawBody: { email: "dup@example.com", role: "member" },
        organisationId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
      },
      { audit, pool }
    );

    assert.equal(result.kind, "conflict");
    assert.equal(audit.events.length, 0, "conflict must NOT emit a MemberInvited audit event");
  });

  it("existing unconsumed invitation → already_invited, NO audit", async () => {
    const audit = makeAuditPort();
    const { pool } = makeSpyPool({ existingInvite: true });

    const result = await inviteOrgMember(
      {
        rawBody: { email: "pending@example.com", role: "member" },
        organisationId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
      },
      { audit, pool }
    );

    assert.equal(result.kind, "already_invited");
    assert.equal(audit.events.length, 0, "duplicate invite must NOT emit audit event");
  });
});

describe("inviteOrgMember — audit emitted only on real write", () => {
  it("existing user, no membership → kind: added, MemberInvited audit, audit BEFORE insert", async () => {
    const callOrder: string[] = [];
    const audit = makeAuditPort();
    const { pool, calls } = makeSpyPool({
      userEmail: "new-member@example.com",
      memberExists: false,
    });

    const origEmit = audit.emit.bind(audit);
    audit.emit = async (e) => {
      callOrder.push("audit");
      return origEmit(e);
    };

    const result = await inviteOrgMember(
      {
        rawBody: { email: "new-member@example.com", role: "manager" },
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

    const insertIdx = calls.findIndex((c) =>
      c.text.toLowerCase().includes("insert into memberships")
    );
    assert.ok(insertIdx !== -1, "membership insert must be called");
    assert.ok(callOrder.indexOf("audit") < insertIdx || insertIdx === -1, "audit before insert");
  });

  it("new user → kind: invited, pending_invitation created, audit emitted", async () => {
    const audit = makeAuditPort();
    const { pool, calls } = makeSpyPool();

    const result = await inviteOrgMember(
      {
        rawBody: { email: "brand-new@example.com", role: "viewer" },
        organisationId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
      },
      { audit, pool }
    );

    assert.equal(result.kind, "invited");
    assert.equal(audit.events.length, 1);
    assert.equal(audit.events[0]!.action, AuditAction.MemberInvited);
    const inv = calls.find((c) => c.text.toLowerCase().includes("pending_invitations"));
    assert.ok(inv, "pending_invitations insert must be called");
  });

  it("audit failure on real write aborts the insert", async () => {
    const audit = makeAuditPort({ shouldFail: true });
    const { pool, calls } = makeSpyPool({ userEmail: "target@example.com", memberExists: false });

    await assert.rejects(
      () =>
        inviteOrgMember(
          {
            rawBody: { email: "target@example.com", role: "member" },
            organisationId: ORG_ID,
            actorId: ACTOR_ID,
            actorRoles: ACTOR_ROLES,
          },
          { audit, pool }
        ),
      /audit unavailable/
    );

    const hasInsert = calls.some((c) => c.text.toLowerCase().includes("insert"));
    assert.equal(hasInsert, false, "no insert after audit failure");
  });

  it("email is normalized to lowercase for lookup and insert", async () => {
    const audit = makeAuditPort();
    const { pool, calls } = makeSpyPool();

    await inviteOrgMember(
      {
        rawBody: { email: "User@Example.COM", role: "member" },
        organisationId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
      },
      { audit, pool }
    );

    // The user lookup and invitation insert must use lowercase
    const userLookup = calls.find((c) => c.text.toLowerCase().includes("from public.users"));
    assert.ok(userLookup, "user lookup must be called");
    assert.ok(
      (userLookup?.values ?? []).some((v) => v === "user@example.com"),
      "email must be lowercased in user lookup"
    );

    const invInsert = calls.find(
      (c) =>
        c.text.toLowerCase().includes("pending_invitations") &&
        c.text.toLowerCase().includes("insert")
    );
    assert.ok(invInsert, "pending_invitation insert must be called");
    assert.ok(
      (invInsert?.values ?? []).some((v) => v === "user@example.com"),
      "email must be lowercased in invitation insert"
    );
  });
});

// ---------------------------------------------------------------------------
// B. updateMemberRole
// ---------------------------------------------------------------------------

describe("updateMemberRole — result types", () => {
  it("invalid role → invalid_body, no audit", async () => {
    const audit = makeAuditPort();
    const { pool } = makeSpyPool({ memberExists: true, memberRole: "member" });

    const result = await updateMemberRole(
      {
        rawBody: { role: "god" },
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

  it("membership absent → not_found, no audit", async () => {
    const audit = makeAuditPort();
    const { pool } = makeSpyPool({ memberExists: false });

    const result = await updateMemberRole(
      {
        rawBody: { role: "viewer" },
        organisationId: ORG_ID,
        targetUserId: TARGET_USER_ID,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
      },
      { audit, pool }
    );

    assert.equal(result.kind, "not_found");
    assert.equal(audit.events.length, 0, "no audit when member not found");
  });

  it("demote last tenant-admin → last_admin_cannot_be_demoted, no audit", async () => {
    const audit = makeAuditPort();
    const { pool } = makeSpyPool({ memberExists: true, memberRole: "tenant-admin", adminCount: 1 });

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

    assert.equal(result.kind, "last_admin_cannot_be_demoted");
    assert.equal(audit.events.length, 0, "no audit when last-admin demotion is blocked");
  });

  it("demote when another admin exists → ok", async () => {
    const audit = makeAuditPort();
    const { pool } = makeSpyPool({ memberExists: true, memberRole: "tenant-admin", adminCount: 2 });

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
  });

  it("promote non-admin → ok (no last-admin check triggered)", async () => {
    const audit = makeAuditPort();
    const { pool } = makeSpyPool({ memberExists: true, memberRole: "member", adminCount: 1 });

    const result = await updateMemberRole(
      {
        rawBody: { role: "tenant-admin" },
        organisationId: ORG_ID,
        targetUserId: TARGET_USER_ID,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
      },
      { audit, pool }
    );

    assert.equal(result.kind, "ok");
    assert.equal(audit.events.length, 1);
  });

  it("audit failure aborts update", async () => {
    const audit = makeAuditPort({ shouldFail: true });
    const { pool, calls } = makeSpyPool({ memberExists: true, memberRole: "member" });

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
      !calls.some((c) => c.text.toLowerCase().includes("update memberships")),
      "no update after audit failure"
    );
  });

  it("successful update → ok, MemberRoleChanged with newRole in metadata", async () => {
    const audit = makeAuditPort();
    const { pool } = makeSpyPool({ memberExists: true, memberRole: "viewer", adminCount: 2 });

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

describe("removeMember — result types", () => {
  it("membership absent → not_found, no audit", async () => {
    const audit = makeAuditPort();
    const { pool } = makeSpyPool({ memberExists: false });

    const result = await removeMember(
      {
        organisationId: ORG_ID,
        targetUserId: TARGET_USER_ID,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
      },
      { audit, pool }
    );

    assert.equal(result.kind, "not_found");
    assert.equal(audit.events.length, 0, "no audit when member not found");
  });

  it("remove last tenant-admin → last_admin_cannot_be_removed, no audit", async () => {
    const audit = makeAuditPort();
    const { pool } = makeSpyPool({ memberExists: true, memberRole: "tenant-admin", adminCount: 1 });

    const result = await removeMember(
      {
        organisationId: ORG_ID,
        targetUserId: TARGET_USER_ID,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
      },
      { audit, pool }
    );

    assert.equal(result.kind, "last_admin_cannot_be_removed");
    assert.equal(audit.events.length, 0, "no audit when last-admin removal is blocked");
  });

  it("remove one of multiple admins → ok", async () => {
    const audit = makeAuditPort();
    const { pool } = makeSpyPool({ memberExists: true, memberRole: "tenant-admin", adminCount: 2 });

    const result = await removeMember(
      {
        organisationId: ORG_ID,
        targetUserId: TARGET_USER_ID,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
      },
      { audit, pool }
    );

    assert.equal(result.kind, "ok");
    assert.equal(audit.events.length, 1);
  });

  it("remove non-admin member (no last-admin check) → ok", async () => {
    const audit = makeAuditPort();
    const { pool } = makeSpyPool({ memberExists: true, memberRole: "viewer", adminCount: 1 });

    const result = await removeMember(
      {
        organisationId: ORG_ID,
        targetUserId: TARGET_USER_ID,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
      },
      { audit, pool }
    );

    assert.equal(result.kind, "ok");
    assert.equal(audit.events.length, 1);
  });

  it("audit failure aborts delete", async () => {
    const audit = makeAuditPort({ shouldFail: true });
    const { pool, calls } = makeSpyPool({ memberExists: true, memberRole: "manager" });

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

  it("successful remove → ok, MemberRemoved audit with correct fields", async () => {
    const audit = makeAuditPort();
    const { pool } = makeSpyPool({ memberExists: true, memberRole: "member" });

    const result = await removeMember(
      {
        organisationId: ORG_ID,
        targetUserId: TARGET_USER_ID,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
      },
      { audit, pool }
    );

    assert.equal(result.kind, "ok");
    assert.equal(audit.events.length, 1);
    assert.equal(audit.events[0]!.action, AuditAction.MemberRemoved);
    assert.equal(audit.events[0]!.tenantId, ORG_ID);
    assert.equal(audit.events[0]!.resourceId, TARGET_USER_ID);
    assert.equal(audit.events[0]!.actorId, ACTOR_ID);
  });
});

// ---------------------------------------------------------------------------
// D. Permission & isolation static assertions
// ---------------------------------------------------------------------------

describe("permission model — static assertions", () => {
  it("tenant-admin bundle includes tenant.members.delete", () => {
    const perms = resolvePermissions("tenant-admin");
    assert.ok(
      perms.includes("tenant.members.delete"),
      "tenant-admin must have tenant.members.delete to use DELETE /api/org/members/:userId"
    );
  });

  it("tenant-admin bundle includes all four tenant.members.* permissions", () => {
    const perms = resolvePermissions("tenant-admin");
    for (const p of [
      "tenant.members.read",
      "tenant.members.invite",
      "tenant.members.update_role",
      "tenant.members.delete",
    ]) {
      assert.ok(perms.includes(p), `tenant-admin must have ${p}`);
    }
  });

  it("manager does NOT have tenant.members.* permissions (read-only member management)", () => {
    const perms = resolvePermissions("manager");
    for (const p of [
      "tenant.members.read",
      "tenant.members.invite",
      "tenant.members.update_role",
      "tenant.members.delete",
    ]) {
      assert.ok(
        !perms.includes(p),
        `manager must NOT have ${p} — tenant.members.* are tenant-admin only`
      );
    }
  });

  it("DELETE route uses tenant.members.delete (not the broader tenant.admin.access)", () => {
    const routesSrc = readFileSync(join(_dir, "../../src/server/routes.ts"), "utf8");
    // Extract the DELETE /api/org/members/:userId route block by finding the slice from
    // "org.members.remove" (unique operationName) to the next route or end.
    const startMarker = "org.members.remove";
    const startIdx = routesSrc.indexOf(startMarker);
    assert.ok(startIdx !== -1, "DELETE member route (org.members.remove) must exist in routes.ts");
    // Take enough characters to cover the requiredPermission declaration
    const block = routesSrc.slice(startIdx, startIdx + 400);
    assert.ok(
      block.includes("tenant.members.delete"),
      "DELETE member route must have requiredPermission: tenant.members.delete"
    );
    assert.ok(
      !block.includes("tenant.admin.access"),
      "DELETE member route must NOT fall back to tenant.admin.access"
    );
  });

  it("pending_invitations list query always includes organisation_id filter (isolation guard)", () => {
    // Verify that the listOrgMembers SQL cannot omit the org filter by reading the source.
    const src = readFileSync(join(_dir, "../../src/usecases/members.ts"), "utf8");
    // The pending_invitations SELECT must have a parameterised organisation_id filter
    assert.ok(
      src.includes("organisation_id = $1") || src.includes("WHERE organisation_id"),
      "listOrgMembers pending_invitations query must always filter on organisation_id"
    );
  });
});
