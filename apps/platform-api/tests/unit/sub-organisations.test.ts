/**
 * Unit tests for ADR-ACT-0143 Slice 3: sub-organisation usecases.
 * Pure — no HTTP, no real DB.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AuditAction, type AuditEventPort, type AuditEvent } from "@platform/audit-events";
import { resolvePermissions } from "@platform/domain-identity";
import {
  createSubOrg,
  updateSubOrg,
  deactivateSubOrg,
} from "../../src/usecases/sub-organisations.ts";

const ORG_ID = "a1b2c3d4-e5f6-4000-8000-000000000001";
const ACTOR_ID = "a1b2c3d4-e5f6-4000-8000-000000000002";
const SUB_ORG_ID = "c3d4e5f6-a7b8-4000-8000-000000000003";

function makeAudit(opts: { fail?: boolean } = {}): AuditEventPort & { events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  return {
    events,
    async emit(e) {
      if (opts.fail) throw new Error("audit fail");
      events.push(e);
    },
    async query() {
      return [];
    },
  };
}

function makePool(opts: { slugExists?: boolean; subOrgExists?: boolean } = {}) {
  const calls: { text: string; values?: unknown[] }[] = [];
  const client = {
    escapeIdentifier: (s: string) => `"${s.replace(/"/g, '""')}"`,
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      const t = text.toLowerCase().trim();
      if (t.includes("select id from public.organisations where slug")) {
        return {
          rows: opts.slugExists ? [{ id: "eid" }] : [],
          rowCount: opts.slugExists ? 1 : 0,
        };
      }
      if (t.includes("select id from public.organisations where id")) {
        return {
          rows: opts.subOrgExists ? [{ id: SUB_ORG_ID }] : [],
          rowCount: opts.subOrgExists ? 1 : 0,
        };
      }
      if (
        t.includes("select id, slug, display_name") &&
        t.includes("from public.organisations where id")
      ) {
        if (!opts.subOrgExists) return { rows: [], rowCount: 0 };
        return {
          rows: [
            {
              id: SUB_ORG_ID,
              slug: "sub-a",
              display_name: "Sub A",
              is_active: true,
              created_at: new Date(),
              updated_at: new Date(),
            },
          ],
          rowCount: 1,
        };
      }
      if (t.includes("insert into public.organisations")) {
        return {
          rows: [
            {
              id: SUB_ORG_ID,
              slug: "new-sub",
              display_name: "New Sub",
              is_active: true,
              created_at: new Date(),
              updated_at: new Date(),
            },
          ],
          rowCount: 1,
        };
      }
      if (t.includes("update public.organisations")) {
        return {
          rows: [
            {
              id: SUB_ORG_ID,
              slug: "sub-a",
              display_name: "Updated",
              is_active: true,
              created_at: new Date(),
              updated_at: new Date(),
            },
          ],
          rowCount: 1,
        };
      }
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
      const t = text.toLowerCase().trim();
      if (t.includes("select id from public.organisations where slug")) {
        return { rows: opts.slugExists ? [{ id: "eid" }] : [], rowCount: opts.slugExists ? 1 : 0 };
      }
      // Full-row SELECT used by updateSubOrg/deactivateSubOrg
      if (t.includes("select id, slug, display_name") && t.includes("from public.organisations")) {
        if (!opts.subOrgExists) return { rows: [], rowCount: 0 };
        return {
          rows: [
            {
              id: SUB_ORG_ID,
              slug: "sub-a",
              display_name: "Sub A",
              is_active: true,
              created_at: new Date(),
              updated_at: new Date(),
            },
          ],
          rowCount: 1,
        };
      }
      if (t.includes("select id from public.organisations where id")) {
        return {
          rows: opts.subOrgExists ? [{ id: SUB_ORG_ID }] : [],
          rowCount: opts.subOrgExists ? 1 : 0,
        };
      }
      if (t.includes("insert into public.organisations")) {
        return {
          rows: [
            {
              id: SUB_ORG_ID,
              slug: "new-sub",
              display_name: "New Sub",
              is_active: true,
              created_at: new Date(),
              updated_at: new Date(),
            },
          ],
          rowCount: 1,
        };
      }
      if (t.includes("update public.organisations")) {
        return {
          rows: [
            {
              id: SUB_ORG_ID,
              slug: "sub-a",
              display_name: "Updated",
              is_active: true,
              created_at: new Date(),
              updated_at: new Date(),
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  return { calls, pool: pool as never };
}

describe("createSubOrg — validation and pre-conditions", () => {
  it("invalid slug → invalid_body, no audit", async () => {
    const audit = makeAudit();
    const { pool } = makePool();
    const result = await createSubOrg(
      {
        rawBody: { slug: "BAD!slug", displayName: "A" },
        parentOrgId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ["tenant-admin"],
      },
      { audit, pool }
    );
    assert.equal(result.kind, "invalid_body");
    assert.equal(audit.events.length, 0);
  });

  it("reserved slug → reserved_slug, no audit", async () => {
    const audit = makeAudit();
    const { pool } = makePool();
    const result = await createSubOrg(
      {
        rawBody: { slug: "admin", displayName: "Admin" },
        parentOrgId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ["tenant-admin"],
      },
      { audit, pool }
    );
    assert.equal(result.kind, "reserved_slug");
    assert.equal(audit.events.length, 0);
  });

  it("duplicate slug → conflict, no audit", async () => {
    const audit = makeAudit();
    const { pool } = makePool({ slugExists: true });
    const result = await createSubOrg(
      {
        rawBody: { slug: "existing", displayName: "Existing" },
        parentOrgId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ["tenant-admin"],
      },
      { audit, pool }
    );
    assert.equal(result.kind, "conflict");
    assert.equal(audit.events.length, 0);
  });

  it("success → ok, SubOrganisationCreated audit BEFORE insert", async () => {
    const callOrder: string[] = [];
    const audit = makeAudit();
    const origEmit = audit.emit.bind(audit);
    audit.emit = async (e) => {
      callOrder.push("audit");
      return origEmit(e);
    };
    const { pool, calls } = makePool();

    const result = await createSubOrg(
      {
        rawBody: { slug: "new-sub", displayName: "New Sub" },
        parentOrgId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ["tenant-admin"],
      },
      { audit, pool }
    );

    assert.equal(result.kind, "ok");
    assert.equal(audit.events.length, 1);
    assert.equal(audit.events[0]!.action, AuditAction.SubOrganisationCreated);
    const insertIdx = calls.findIndex((c) => c.text.toLowerCase().includes("insert"));
    assert.ok(insertIdx !== -1 && callOrder.indexOf("audit") < insertIdx, "audit before insert");
  });

  it("audit failure aborts insert", async () => {
    const audit = makeAudit({ fail: true });
    const { pool, calls } = makePool();
    await assert.rejects(
      () =>
        createSubOrg(
          {
            rawBody: { slug: "new-sub", displayName: "Sub Org" },
            parentOrgId: ORG_ID,
            actorId: ACTOR_ID,
            actorRoles: ["tenant-admin"],
          },
          { audit, pool }
        ),
      /audit fail/
    );
    assert.ok(!calls.some((c) => c.text.toLowerCase().includes("insert")));
  });
});

describe("updateSubOrg", () => {
  it("not found → not_found, no audit", async () => {
    const audit = makeAudit();
    const { pool } = makePool({ subOrgExists: false });
    const result = await updateSubOrg(
      {
        rawBody: { displayName: "New" },
        parentOrgId: ORG_ID,
        subOrgId: SUB_ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ["tenant-admin"],
      },
      { audit, pool }
    );
    assert.equal(result.kind, "not_found");
    assert.equal(audit.events.length, 0);
  });

  it("success → ok, SubOrganisationUpdated audit BEFORE update", async () => {
    const callOrder: string[] = [];
    const audit = makeAudit();
    const origEmit = audit.emit.bind(audit);
    audit.emit = async (e) => {
      callOrder.push("audit");
      return origEmit(e);
    };
    const { pool, calls } = makePool({ subOrgExists: true });

    const result = await updateSubOrg(
      {
        rawBody: { displayName: "Updated" },
        parentOrgId: ORG_ID,
        subOrgId: SUB_ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ["tenant-admin"],
      },
      { audit, pool }
    );

    assert.equal(result.kind, "ok");
    assert.equal(audit.events[0]!.action, AuditAction.SubOrganisationUpdated);
    const updateIdx = calls.findIndex((c) =>
      c.text.toLowerCase().includes("update public.organisations set")
    );
    assert.ok(updateIdx !== -1 && callOrder.indexOf("audit") < updateIdx, "audit before update");
  });

  it("audit failure aborts update", async () => {
    const audit = makeAudit({ fail: true });
    const { pool, calls } = makePool({ subOrgExists: true });
    await assert.rejects(
      () =>
        updateSubOrg(
          {
            rawBody: { displayName: "Updated Name" },
            parentOrgId: ORG_ID,
            subOrgId: SUB_ORG_ID,
            actorId: ACTOR_ID,
            actorRoles: ["tenant-admin"],
          },
          { audit, pool }
        ),
      /audit fail/
    );
    assert.ok(
      !calls.some((c) => c.text.toLowerCase().includes("update public.organisations set")),
      "no UPDATE after audit failure"
    );
  });
});

describe("deactivateSubOrg", () => {
  it("not found → not_found, no audit", async () => {
    const audit = makeAudit();
    const { pool } = makePool({ subOrgExists: false });
    const result = await deactivateSubOrg(
      {
        parentOrgId: ORG_ID,
        subOrgId: SUB_ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ["tenant-admin"],
      },
      { audit, pool }
    );
    assert.equal(result.kind, "not_found");
    assert.equal(audit.events.length, 0);
  });

  it("success → ok, SubOrganisationDeactivated audit BEFORE deactivate", async () => {
    const callOrder: string[] = [];
    const audit = makeAudit();
    const origEmit = audit.emit.bind(audit);
    audit.emit = async (e) => {
      callOrder.push("audit");
      return origEmit(e);
    };
    const { pool, calls } = makePool({ subOrgExists: true });

    const result = await deactivateSubOrg(
      {
        parentOrgId: ORG_ID,
        subOrgId: SUB_ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ["tenant-admin"],
      },
      { audit, pool }
    );

    assert.equal(result.kind, "ok");
    assert.equal(audit.events[0]!.action, AuditAction.SubOrganisationDeactivated);
    const updateIdx = calls.findIndex((c) => c.text.toLowerCase().includes("update"));
    assert.ok(
      updateIdx !== -1 && callOrder.indexOf("audit") < updateIdx,
      "audit before deactivate"
    );
  });

  it("audit failure aborts deactivate", async () => {
    const audit = makeAudit({ fail: true });
    const { pool, calls } = makePool({ subOrgExists: true });
    await assert.rejects(
      () =>
        deactivateSubOrg(
          {
            parentOrgId: ORG_ID,
            subOrgId: SUB_ORG_ID,
            actorId: ACTOR_ID,
            actorRoles: ["tenant-admin"],
          },
          { audit, pool }
        ),
      /audit fail/
    );
    assert.ok(!calls.some((c) => c.text.toLowerCase().includes("update")));
  });
});

describe("permission model — sub-organisations", () => {
  it("tenant-admin has all four tenant.suborgs.* permissions", () => {
    const perms = resolvePermissions("tenant-admin");
    for (const p of [
      "tenant.suborgs.read",
      "tenant.suborgs.create",
      "tenant.suborgs.update",
      "tenant.suborgs.delete",
    ]) {
      assert.ok(perms.includes(p), `tenant-admin must have ${p}`);
    }
  });

  it("manager has none of tenant.suborgs.*", () => {
    const perms = resolvePermissions("manager");
    for (const p of [
      "tenant.suborgs.read",
      "tenant.suborgs.create",
      "tenant.suborgs.update",
      "tenant.suborgs.delete",
    ]) {
      assert.ok(!perms.includes(p), `manager must NOT have ${p}`);
    }
  });
});
