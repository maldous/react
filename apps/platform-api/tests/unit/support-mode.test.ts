/**
 * Unit tests for ADR-ACT-0187: explicit audited system-admin support mode.
 *
 * Two test surfaces — both pure, no HTTP or Redis required:
 *
 * A. canAccessTenantFqdn predicate (pipeline.ts)
 *    - normal system-admin blocked on any tenant FQDN
 *    - support-mode system-admin allowed only on matching effective tenant
 *    - support-mode system-admin blocked on wrong tenant
 *    - regular tenant user allowed on own tenant, blocked on other
 *
 * B. enterSupportMode usecase (usecases/support.ts)
 *    - creates support session and returns supportSessionId
 *    - emits audit event before creating session
 *    - audit failure prevents session creation
 *    - empty reason rejected
 *    - empty targetOrganisationId rejected
 *    - non-system-admin rejected (defence-in-depth)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canAccessTenantFqdn } from "../../src/server/pipeline.ts";
import {
  enterSupportMode,
  requestSupportApproval,
  approveSupportApproval,
} from "../../src/usecases/support.ts";
import type { SessionActor } from "@platform/contracts-auth";
import type { AuditEventPort, AuditEvent } from "@platform/audit-events";
import type { SessionStore, SessionRecord, CreateSessionCommand } from "@platform/session-runtime";
import { InMemoryWorkflowOrchestrator } from "../../src/adapters/in-memory-workflow-orchestrator.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TARGET_ORG = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER_ORG = "bbbbbbbb-0000-4000-8000-000000000002";
const ACTOR_ORG = "cccccccc-0000-4000-8000-000000000003";

function makeSystemAdmin(overrides: Partial<SessionActor> = {}): SessionActor {
  return {
    userId: "user-sysadmin",
    tenantId: "",
    organisationId: "",
    roles: ["system-admin"],
    permissions: ["platform.admin.access"],
    displayName: "Sys Admin",
    ...overrides,
  };
}

function makeTenantUser(orgId: string): SessionActor {
  return {
    userId: "user-tenant",
    tenantId: orgId,
    organisationId: orgId,
    roles: ["tenant-admin"],
    permissions: ["tenant.admin.access"],
    displayName: "Tenant Admin",
  };
}

function makeSupportActor(effectiveOrgId: string): SessionActor {
  return {
    ...makeSystemAdmin({ organisationId: effectiveOrgId, tenantId: effectiveOrgId }),
    supportMode: true,
    effectiveOrganisationId: effectiveOrgId,
    supportAccessReason: "investigating reported issue",
  };
}

// ---------------------------------------------------------------------------
// A. canAccessTenantFqdn
// ---------------------------------------------------------------------------

describe("canAccessTenantFqdn", () => {
  it("blocks normal system-admin on any tenant FQDN", () => {
    const actor = makeSystemAdmin();
    assert.equal(canAccessTenantFqdn(actor, TARGET_ORG), false);
    assert.equal(canAccessTenantFqdn(actor, OTHER_ORG), false);
  });

  it("allows support-mode system-admin on matching effective tenant", () => {
    const actor = makeSupportActor(TARGET_ORG);
    assert.equal(canAccessTenantFqdn(actor, TARGET_ORG), true);
  });

  it("blocks support-mode system-admin on wrong tenant FQDN", () => {
    const actor = makeSupportActor(TARGET_ORG);
    assert.equal(canAccessTenantFqdn(actor, OTHER_ORG), false);
  });

  it("blocks system-admin with supportMode but no effectiveOrganisationId", () => {
    const actor: SessionActor = { ...makeSystemAdmin(), supportMode: true };
    assert.equal(canAccessTenantFqdn(actor, TARGET_ORG), false);
  });

  it("allows regular tenant user on their own tenant", () => {
    const actor = makeTenantUser(ACTOR_ORG);
    assert.equal(canAccessTenantFqdn(actor, ACTOR_ORG), true);
  });

  it("blocks regular tenant user on a different tenant FQDN", () => {
    const actor = makeTenantUser(ACTOR_ORG);
    assert.equal(canAccessTenantFqdn(actor, TARGET_ORG), false);
  });
});

// ---------------------------------------------------------------------------
// B. enterSupportMode usecase
// ---------------------------------------------------------------------------

function makeAuditPort(opts: { shouldFail?: boolean } = {}): AuditEventPort & {
  events: AuditEvent[];
} {
  const events: AuditEvent[] = [];
  return {
    events,
    async emit(event) {
      if (opts.shouldFail) throw new Error("audit store unavailable");
      events.push(event);
    },
    async query() {
      return [];
    },
  };
}

function makeSessionStore(opts: { shouldFail?: boolean } = {}): SessionStore & {
  created: CreateSessionCommand[];
} {
  const created: CreateSessionCommand[] = [];
  return {
    created,
    async create(cmd) {
      if (opts.shouldFail) throw new Error("redis unavailable");
      created.push(cmd);
      return "support-session-id-" + Math.random().toString(36).slice(2);
    },
    async find(_id: string): Promise<SessionRecord | null> {
      return null;
    },
    async refresh() {},
    async destroy() {},
  };
}

describe("enterSupportMode usecase", () => {
  it("creates support session and returns supportSessionId", async () => {
    const audit = makeAuditPort();
    const sessions = makeSessionStore();

    const result = await enterSupportMode(
      {
        actorUserId: "user-sysadmin",
        actorRoles: ["system-admin"],
        actorDisplayName: "Sys Admin",
        targetOrganisationId: TARGET_ORG,
        targetTenantId: TARGET_ORG,
        supportAccessReason: "investigating reported issue",
      },
      { sessions, audit }
    );

    assert.ok(result.supportSessionId.length > 0);
    assert.equal(result.targetOrganisationId, TARGET_ORG);
    assert.equal(result.supportAccessReason, "investigating reported issue");

    // Session created with support fields
    assert.equal(sessions.created.length, 1);
    const cmd = sessions.created[0]!;
    assert.equal(cmd.supportMode, true);
    assert.equal(cmd.effectiveOrganisationId, TARGET_ORG);
    assert.equal(cmd.organisationId, TARGET_ORG);
  });

  it("emits audit event before creating session — audit fields correct", async () => {
    const audit = makeAuditPort();
    const sessions = makeSessionStore();

    await enterSupportMode(
      {
        actorUserId: "user-sysadmin",
        actorRoles: ["system-admin"],
        actorDisplayName: "Sys Admin",
        targetOrganisationId: TARGET_ORG,
        targetTenantId: TARGET_ORG,
        supportAccessReason: "incident review",
      },
      { sessions, audit }
    );

    assert.equal(audit.events.length, 1);
    const evt = audit.events[0]!;
    assert.equal(evt.action, "support_session.created");
    assert.equal(evt.actorId, "user-sysadmin");
    assert.equal(evt.resourceId, TARGET_ORG);
    assert.equal(evt.tenantId, "platform");
    assert.deepEqual(evt.metadata?.["targetOrganisationId"], TARGET_ORG);
  });

  it("audit failure prevents session creation", async () => {
    const audit = makeAuditPort({ shouldFail: true });
    const sessions = makeSessionStore();

    await assert.rejects(
      () =>
        enterSupportMode(
          {
            actorUserId: "user-sysadmin",
            actorRoles: ["system-admin"],
            actorDisplayName: "Sys Admin",
            targetOrganisationId: TARGET_ORG,
            targetTenantId: TARGET_ORG,
            supportAccessReason: "test",
          },
          { sessions, audit }
        ),
      /audit store unavailable/
    );

    // No session created
    assert.equal(sessions.created.length, 0);
  });

  it("empty supportAccessReason is rejected", async () => {
    const audit = makeAuditPort();
    const sessions = makeSessionStore();

    await assert.rejects(
      () =>
        enterSupportMode(
          {
            actorUserId: "user-sysadmin",
            actorRoles: ["system-admin"],
            actorDisplayName: "Sys Admin",
            targetOrganisationId: TARGET_ORG,
            targetTenantId: TARGET_ORG,
            supportAccessReason: "   ",
          },
          { sessions, audit }
        ),
      /reason_required/
    );

    assert.equal(audit.events.length, 0);
    assert.equal(sessions.created.length, 0);
  });

  it("whitespace-only reason is rejected", async () => {
    const audit = makeAuditPort();
    const sessions = makeSessionStore();

    await assert.rejects(
      () =>
        enterSupportMode(
          {
            actorUserId: "user-sysadmin",
            actorRoles: ["system-admin"],
            actorDisplayName: "Sys Admin",
            targetOrganisationId: TARGET_ORG,
            targetTenantId: TARGET_ORG,
            supportAccessReason: "\t\n  ",
          },
          { sessions, audit }
        ),
      /reason_required/
    );
  });

  it("non-system-admin is rejected (defence-in-depth)", async () => {
    const audit = makeAuditPort();
    const sessions = makeSessionStore();

    await assert.rejects(
      () =>
        enterSupportMode(
          {
            actorUserId: "user-tenant",
            actorRoles: ["tenant-admin"],
            actorDisplayName: "Tenant Admin",
            targetOrganisationId: TARGET_ORG,
            targetTenantId: TARGET_ORG,
            supportAccessReason: "trying to escalate",
          },
          { sessions, audit }
        ),
      /support_mode\.forbidden/
    );

    assert.equal(audit.events.length, 0);
    assert.equal(sessions.created.length, 0);
  });

  it("empty targetOrganisationId is rejected", async () => {
    const audit = makeAuditPort();
    const sessions = makeSessionStore();

    await assert.rejects(
      () =>
        enterSupportMode(
          {
            actorUserId: "user-sysadmin",
            actorRoles: ["system-admin"],
            actorDisplayName: "Sys Admin",
            targetOrganisationId: "  ",
            targetTenantId: "",
            supportAccessReason: "valid reason",
          },
          { sessions, audit }
        ),
      /invalid_target/
    );
  });

  it("supports a two-step approval workflow", async () => {
    const audit = makeAuditPort();
    const sessions = makeSessionStore();
    const workflows = new InMemoryWorkflowOrchestrator();
    const workflowId = "wf-support-approval-1";

    const requested = await requestSupportApproval(
      {
        actorUserId: "user-sysadmin",
        actorRoles: ["system-admin"],
        actorDisplayName: "Sys Admin",
        targetOrganisationId: TARGET_ORG,
        targetTenantId: TARGET_ORG,
        supportAccessReason: "investigating issue",
        workflowId,
      },
      { sessions, audit, workflows }
    );

    assert.equal(requested.workflowId, workflowId);
    assert.equal((await workflows.getWorkflowStatus(workflowId)).status, "waiting");

    const approved = await approveSupportApproval(
      {
        actorUserId: "user-sysadmin",
        actorRoles: ["system-admin"],
        actorDisplayName: "Sys Admin",
        targetOrganisationId: TARGET_ORG,
        targetTenantId: TARGET_ORG,
        supportAccessReason: "investigating issue",
        workflowId,
        approvedBy: "user-approver",
      },
      { sessions, audit, workflows }
    );

    assert.ok(approved.supportSessionId.length > 0);
    assert.equal((await workflows.getWorkflowStatus(workflowId)).status, "completed");
    assert.equal(sessions.created.length, 1);
  });
});
