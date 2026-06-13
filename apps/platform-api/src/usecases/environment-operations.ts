// ---------------------------------------------------------------------------
// Environment operations usecase (ADR-0072 / ADR-ACT-0274).
//
// Wraps the EnvironmentOperationPort with authorization + audit. Every operation:
//   - requires a platform.environment.* permission (system/operator only);
//   - is audited (EnvironmentOperationInvoked) BEFORE execution;
//   - is dry-run capable (the port resolves the whitelisted argv without running).
// The port itself guarantees no arbitrary command / shell / docker socket.
// ---------------------------------------------------------------------------

import { ForbiddenError } from "@platform/platform-errors";
import { AuditAction, createAuditEvent, type AuditEventPort } from "@platform/audit-events";
import type {
  EnvironmentOperationKind,
  EnvironmentOperationPort,
  EnvironmentOperationRequest,
  EnvironmentOperationResult,
} from "../ports/environment-operation.ts";
import { ENVIRONMENT_PERMISSIONS, type EnvironmentActor } from "./environment-registry.ts";

// Which permission each operation kind requires.
const PERMISSION_FOR_KIND: Record<EnvironmentOperationKind, string> = {
  generateRuntimeEnv: ENVIRONMENT_PERMISSIONS.operate,
  bootstrapEnvironment: ENVIRONMENT_PERMISSIONS.bootstrap,
  seedSecrets: ENVIRONMENT_PERMISSIONS.bootstrap,
  seedProviderConfig: ENVIRONMENT_PERMISSIONS.bootstrap,
  seedManagedConfig: ENVIRONMENT_PERMISSIONS.bootstrap,
  createGlobalAdmin: ENVIRONMENT_PERMISSIONS.bootstrap,
  rotateSecret: ENVIRONMENT_PERMISSIONS.rotateSecret,
  reconcileProvider: ENVIRONMENT_PERMISSIONS.operate,
  startProviderProfile: ENVIRONMENT_PERMISSIONS.operate,
  stopProviderProfile: ENVIRONMENT_PERMISSIONS.operate,
  restartProviderProfile: ENVIRONMENT_PERMISSIONS.operate,
  runMigrations: ENVIRONMENT_PERMISSIONS.operate,
  runReadinessProbe: ENVIRONMENT_PERMISSIONS.read,
  runProof: ENVIRONMENT_PERMISSIONS.operate,
};

export interface EnvironmentOperationsDeps {
  operations: EnvironmentOperationPort;
  audit: AuditEventPort;
}

export function requiredPermissionFor(kind: EnvironmentOperationKind): string {
  return PERMISSION_FOR_KIND[kind];
}

export async function runEnvironmentOperation(
  deps: EnvironmentOperationsDeps,
  actor: EnvironmentActor,
  req: EnvironmentOperationRequest
): Promise<EnvironmentOperationResult> {
  const required = PERMISSION_FOR_KIND[req.kind];
  if (!required || !actor.actorPermissions?.includes(required)) {
    throw new ForbiddenError("api.error.environmentPermissionDenied", {
      safeDetails: { required: required ?? "unknown", kind: req.kind },
    });
  }
  await deps.audit.emit(
    createAuditEvent({
      actorId: actor.actorId,
      actorRoles: actor.actorRoles,
      tenantId: actor.actorId, // operator-global: no tenant; actor id stands in
      action: AuditAction.EnvironmentOperationInvoked,
      resource: "environment_operation",
      resourceId: `${req.environmentId}:${req.kind}`,
      metadata: {
        kind: req.kind,
        environmentId: req.environmentId,
        profile: req.profile,
        dryRun: req.dryRun === true,
      },
      sourceHost: actor.sourceHost,
    })
  );
  return deps.operations.execute(req);
}
