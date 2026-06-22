import { createAuditEvent, AuditAction, type AuditEventPort } from "@platform/audit-events";
import { createLogger } from "@platform/platform-logging";
import { createTracer, withSpan } from "@platform/platform-observability";
import type { SessionStore } from "@platform/session-runtime";
import type { WorkflowOrchestratorPort } from "../ports/workflow-orchestrator.ts";

// ---------------------------------------------------------------------------
// enterSupportMode — explicit audited system-admin support session (ADR-ACT-0187)
//
// Creates a short-lived support session scoped to a single target tenant.
// The audit event is emitted BEFORE the session is created — if audit fails,
// no session is created and the error propagates. This ensures every support
// session has a corresponding audit record.
//
// The caller must be a system-admin (roles includes "system-admin").
// A non-system-admin caller receives a ForbiddenError at the route layer via
// platform.admin.access permission check, but we enforce it here too as
// defence-in-depth.
// ---------------------------------------------------------------------------

export interface EnterSupportModeInput {
  actorUserId: string;
  actorRoles: string[];
  actorDisplayName: string;
  targetOrganisationId: string;
  targetTenantId: string;
  supportAccessReason: string;
  sourceHost?: string;
  ipAddress?: string;
}

export interface EnterSupportModeDeps {
  sessions: SessionStore;
  audit: AuditEventPort;
}

export interface SupportApprovalDeps extends EnterSupportModeDeps {
  workflows: WorkflowOrchestratorPort;
}

export interface RequestSupportApprovalInput extends EnterSupportModeInput {
  workflowId: string;
}

export interface SupportSessionResult {
  supportSessionId: string;
  targetOrganisationId: string;
  supportAccessReason: string;
}

export const SUPPORT_APPROVAL_STATE_MACHINE = {
  initial: "requested",
  states: ["requested", "waiting", "completed", "cancelled", "failed"] as const,
  idempotencyKey: "workflowId",
  allowedTransitions: [
    ["requested", "waiting"],
    ["waiting", "completed"],
    ["waiting", "cancelled"],
    ["waiting", "failed"],
  ] as const,
  forbiddenTransitions: [
    ["completed", "waiting"],
    ["cancelled", "completed"],
    ["failed", "completed"],
  ] as const,
  operatorRecovery: ["cancelSupportApproval", "retrySupportApprovalWorkflowStep"] as const,
};

const SUPPORT_WORKFLOW_TIMEOUT_MS = 5_000;
const SUPPORT_WORKFLOW_RETRY_ATTEMPTS = 2;

const log = createLogger({
  name: "support-mode-usecase",
  service: "platform-api",
  packageName: "support-mode",
  boundedContext: "support",
});
const tracer = createTracer("support-mode");
const supportWorkflowMetrics = {
  enterAttempts: 0,
  approvalRequests: 0,
  approvals: 0,
  cancellations: 0,
  retries: 0,
  failures: 0,
};

export function getSupportWorkflowMetric(name: keyof typeof supportWorkflowMetrics): number {
  return supportWorkflowMetrics[name];
}

async function withTimeout<T>(operation: Promise<T>, operationName: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`support_workflow.timeout: ${operationName}`)),
          SUPPORT_WORKFLOW_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function retrySupportApprovalWorkflowStep<T>(
  operationName: string,
  operation: () => Promise<T>
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= SUPPORT_WORKFLOW_RETRY_ATTEMPTS; attempt++) {
    try {
      return await withTimeout(operation(), operationName);
    } catch (err) {
      lastError = err;
      supportWorkflowMetrics.failures += 1;
      if (attempt >= SUPPORT_WORKFLOW_RETRY_ATTEMPTS) break;
      supportWorkflowMetrics.retries += 1;
      log.warn({ operationName, attempt, err }, "support.approval.workflow.retry");
    }
  }
  throw lastError;
}

export async function enterSupportMode(
  input: EnterSupportModeInput,
  deps: EnterSupportModeDeps
): Promise<SupportSessionResult> {
  supportWorkflowMetrics.enterAttempts += 1;
  return withSpan(
    tracer,
    "support.enter",
    async () => {
      // Defence-in-depth: only system-admin may create support sessions.
      if (!input.actorRoles.includes("system-admin")) {
        supportWorkflowMetrics.failures += 1;
        throw new Error("support_mode.forbidden: only system-admin may create support sessions");
      }

      // Non-empty reason is required.
      const reason = input.supportAccessReason.trim();
      if (!reason) {
        supportWorkflowMetrics.failures += 1;
        throw new Error("support_mode.reason_required: supportAccessReason must not be empty");
      }

      // Validate target org ID is non-empty.
      if (!input.targetOrganisationId.trim()) {
        supportWorkflowMetrics.failures += 1;
        throw new Error("support_mode.invalid_target: targetOrganisationId must not be empty");
      }

      // Emit audit event BEFORE creating the session.
      // If this throws, the session is NOT created — no unaudited support access.
      const auditEvent = createAuditEvent({
        actorId: input.actorUserId,
        actorRoles: input.actorRoles,
        tenantId: "platform",
        action: AuditAction.SupportSessionCreated,
        resource: "support_session",
        resourceId: input.targetOrganisationId,
        metadata: {
          targetOrganisationId: input.targetOrganisationId,
          supportAccessReason: reason,
        },
        sourceHost: input.sourceHost,
        ipAddress: input.ipAddress,
      });

      await deps.audit.emit(auditEvent);

      // Create the support session. The actor's organisationId is set to the
      // target tenant so the FQDN cross-check allows access. supportMode=true
      // ensures canAccessTenantFqdn enforces the system-admin path.
      const supportSessionId = await deps.sessions.create({
        userId: input.actorUserId,
        tenantId: input.targetTenantId,
        organisationId: input.targetOrganisationId,
        roles: input.actorRoles,
        // Support sessions carry no tenant-scoped permissions — system-admin
        // already has platform.* permissions and the session is read-only for
        // support visibility. Tenant permissions are not granted.
        permissions: [],
        displayName: input.actorDisplayName,
        ttlSeconds: 3600, // 1-hour support window
        supportMode: true,
        effectiveOrganisationId: input.targetOrganisationId,
        supportAccessReason: reason,
      });

      log.info(
        { supportSessionId, targetOrganisationId: input.targetOrganisationId },
        "support.session.created"
      );

      return {
        supportSessionId,
        targetOrganisationId: input.targetOrganisationId,
        supportAccessReason: reason,
      };
    },
    {
      "support.target_organisation_id": input.targetOrganisationId,
      "support.actor_user_id": input.actorUserId,
    }
  );
}

export async function requestSupportApproval(
  input: RequestSupportApprovalInput,
  deps: SupportApprovalDeps
): Promise<{ workflowId: string }> {
  supportWorkflowMetrics.approvalRequests += 1;
  return withSpan(
    tracer,
    "support.approval.request",
    async () => {
      const reason = input.supportAccessReason.trim();
      if (!reason) {
        supportWorkflowMetrics.failures += 1;
        throw new Error("support_mode.reason_required: supportAccessReason must not be empty");
      }
      if (!input.targetOrganisationId.trim()) {
        supportWorkflowMetrics.failures += 1;
        throw new Error("support_mode.invalid_target: targetOrganisationId must not be empty");
      }

      await deps.audit.emit(
        createAuditEvent({
          actorId: input.actorUserId,
          actorRoles: input.actorRoles,
          tenantId: "platform",
          action: AuditAction.SupportSessionCreated,
          resource: "support_session",
          resourceId: input.targetOrganisationId,
          metadata: {
            targetOrganisationId: input.targetOrganisationId,
            supportAccessReason: reason,
            supportWorkflowId: input.workflowId,
            approvalState: "requested",
            stateMachine: SUPPORT_APPROVAL_STATE_MACHINE.initial,
          },
          sourceHost: input.sourceHost,
          ipAddress: input.ipAddress,
        })
      );

      await retrySupportApprovalWorkflowStep("support.approval.start", () =>
        deps.workflows.startWorkflow({
          workflowKey: "support.approval",
          tenantId: input.targetOrganisationId,
          workflowId: input.workflowId,
          payload: {
            targetOrganisationId: input.targetOrganisationId,
            supportAccessReason: reason,
            requestedBy: input.actorUserId,
          },
        })
      );

      await retrySupportApprovalWorkflowStep("support.approval.requested", () =>
        deps.workflows.signalWorkflow(input.workflowId, "approval.requested", {
          requestedBy: input.actorUserId,
        })
      );

      log.info({ workflowId: input.workflowId }, "support.approval.requested");
      return { workflowId: input.workflowId };
    },
    {
      "support.workflow_id": input.workflowId,
      "support.target_organisation_id": input.targetOrganisationId,
    }
  );
}

export async function approveSupportApproval(
  input: RequestSupportApprovalInput & { approvedBy: string; actorRoles: string[] },
  deps: SupportApprovalDeps
): Promise<SupportSessionResult> {
  supportWorkflowMetrics.approvals += 1;
  return withSpan(
    tracer,
    "support.approval.approve",
    async () => {
      await retrySupportApprovalWorkflowStep("support.approval.granted", () =>
        deps.workflows.signalWorkflow(input.workflowId, "approval.granted", {
          approvedBy: input.approvedBy,
        })
      );
      return enterSupportMode(input, deps);
    },
    {
      "support.workflow_id": input.workflowId,
      "support.approved_by": input.approvedBy,
    }
  );
}

export async function cancelSupportApproval(
  input: RequestSupportApprovalInput & { cancelledBy: string },
  deps: SupportApprovalDeps
): Promise<{ workflowId: string; status: "cancelled" }> {
  supportWorkflowMetrics.cancellations += 1;
  return withSpan(
    tracer,
    "support.approval.cancel",
    async () => {
      await deps.audit.emit(
        createAuditEvent({
          actorId: input.actorUserId,
          actorRoles: input.actorRoles,
          tenantId: "platform",
          action: AuditAction.SupportSessionCreated,
          resource: "support_session",
          resourceId: input.targetOrganisationId,
          metadata: {
            targetOrganisationId: input.targetOrganisationId,
            supportWorkflowId: input.workflowId,
            approvalState: "cancelled",
            cancelledBy: input.cancelledBy,
          },
          sourceHost: input.sourceHost,
          ipAddress: input.ipAddress,
        })
      );
      await retrySupportApprovalWorkflowStep("support.approval.cancel", () =>
        deps.workflows.cancelWorkflow(input.workflowId)
      );
      log.info({ workflowId: input.workflowId }, "support.approval.cancelled");
      return { workflowId: input.workflowId, status: "cancelled" };
    },
    {
      "support.workflow_id": input.workflowId,
      "support.cancelled_by": input.cancelledBy,
    }
  );
}
