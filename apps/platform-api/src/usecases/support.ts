import { createAuditEvent, AuditAction, type AuditEventPort } from "@platform/audit-events";
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

export async function enterSupportMode(
  input: EnterSupportModeInput,
  deps: EnterSupportModeDeps
): Promise<SupportSessionResult> {
  // Defence-in-depth: only system-admin may create support sessions.
  if (!input.actorRoles.includes("system-admin")) {
    throw new Error("support_mode.forbidden: only system-admin may create support sessions");
  }

  // Non-empty reason is required.
  const reason = input.supportAccessReason.trim();
  if (!reason) {
    throw new Error("support_mode.reason_required: supportAccessReason must not be empty");
  }

  // Validate target org ID is non-empty.
  if (!input.targetOrganisationId.trim()) {
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

  return {
    supportSessionId,
    targetOrganisationId: input.targetOrganisationId,
    supportAccessReason: reason,
  };
}

export async function requestSupportApproval(
  input: RequestSupportApprovalInput,
  deps: SupportApprovalDeps
): Promise<{ workflowId: string }> {
  const reason = input.supportAccessReason.trim();
  if (!reason)
    throw new Error("support_mode.reason_required: supportAccessReason must not be empty");
  if (!input.targetOrganisationId.trim()) {
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
      },
      sourceHost: input.sourceHost,
      ipAddress: input.ipAddress,
    })
  );

  await deps.workflows.startWorkflow({
    workflowKey: "support.approval",
    tenantId: input.targetOrganisationId,
    workflowId: input.workflowId,
    payload: {
      targetOrganisationId: input.targetOrganisationId,
      supportAccessReason: reason,
      requestedBy: input.actorUserId,
    },
  });

  await deps.workflows.signalWorkflow(input.workflowId, "approval.requested", {
    requestedBy: input.actorUserId,
  });

  return { workflowId: input.workflowId };
}

export async function approveSupportApproval(
  input: RequestSupportApprovalInput & { approvedBy: string; actorRoles: string[] },
  deps: SupportApprovalDeps
): Promise<SupportSessionResult> {
  await deps.workflows.signalWorkflow(input.workflowId, "approval.granted", {
    approvedBy: input.approvedBy,
  });
  return enterSupportMode(input, deps);
}
