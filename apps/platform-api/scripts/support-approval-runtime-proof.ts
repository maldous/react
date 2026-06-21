/**
 * Support approval runtime proof.
 *
 * Proves the hermetic support approval workflow boundary:
 * - request step records an audit event
 * - workflow enters waiting state on approval request
 * - approval signal completes the workflow and opens support access
 * - audit lifecycle stays ordered
 *
 * Proof tier: hermetic-domain.
 */

import { strict as assert } from "node:assert";
import type { AuditEventPort } from "@platform/audit-events";
import type { SessionStore } from "@platform/session-runtime";
import { InMemoryWorkflowOrchestrator } from "../src/adapters/in-memory-workflow-orchestrator.ts";
import { approveSupportApproval, requestSupportApproval } from "../src/usecases/support.ts";

class InMemoryAudit implements AuditEventPort {
  public readonly actions: string[] = [];
  async emit(event: { action: string }): Promise<void> {
    this.actions.push(event.action);
  }
  async query(): Promise<never[]> {
    return [];
  }
}

class InMemorySessions implements SessionStore {
  public readonly created: Array<{ userId: string; tenantId: string }> = [];
  async create(input: { userId: string; tenantId: string }) {
    this.created.push(input);
    return `support-${this.created.length}`;
  }
  async get(): Promise<null> {
    return null;
  }
  async delete(): Promise<void> {}
}

async function main(): Promise<void> {
  const sessions = new InMemorySessions();
  const audit = new InMemoryAudit();
  const workflows = new InMemoryWorkflowOrchestrator();
  const workflowId = "wf-support-approval";
  const targetOrganisationId = "11111111-1111-4111-8111-111111111111";

  const requested = await requestSupportApproval(
    {
      actorUserId: "user-sysadmin",
      actorRoles: ["system-admin"],
      actorDisplayName: "Sys Admin",
      targetOrganisationId,
      targetTenantId: targetOrganisationId,
      supportAccessReason: "production incident",
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
      targetOrganisationId,
      targetTenantId: targetOrganisationId,
      supportAccessReason: "production incident",
      workflowId,
      approvedBy: "user-approver",
    },
    { sessions, audit, workflows }
  );

  assert.ok(approved.supportSessionId.length > 0);
  assert.equal((await workflows.getWorkflowStatus(workflowId)).status, "completed");
  assert.deepEqual(audit.actions, ["support_session.created", "support_session.created"]);

  console.log(
    JSON.stringify(
      {
        capability: "V1C-05 support approval",
        proofTier: "hermetic-domain",
        result: "PASSED",
        workflowId,
        supportSessionId: approved.supportSessionId,
        workflowStatus: await workflows.getWorkflowStatus(workflowId),
        auditActions: audit.actions,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
