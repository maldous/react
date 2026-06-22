import type pg from "pg";
import { createAuditEvent, AuditAction, type AuditEventPort } from "@platform/audit-events";

export interface TenantLifecycleActor {
  actorId: string;
  actorRoles: string[];
}

export interface TenantLifecycleExportResult {
  digest: string;
  keyRef?: string;
}

export interface TenantLifecycleCoordinator {
  exportTenant(
    organisationId: string,
    actor: TenantLifecycleActor
  ): Promise<TenantLifecycleExportResult>;
  suspendData(organisationId: string): Promise<void>;
  suspendStorage(organisationId: string): Promise<void>;
  suspendRealm(organisationId: string): Promise<void>;
  suspendDsr(organisationId: string, actor: TenantLifecycleActor): Promise<void>;
  deleteData(organisationId: string): Promise<void>;
  deleteStorage(organisationId: string): Promise<void>;
  deleteRealm(organisationId: string): Promise<void>;
  deleteDsr(organisationId: string, actor: TenantLifecycleActor): Promise<void>;
}

export interface TenantLifecycleDeps {
  pool: pg.Pool;
  audit: AuditEventPort;
  coordinator: TenantLifecycleCoordinator;
}

async function auditTransition(
  organisationId: string,
  transition: "suspend" | "delete",
  actor: TenantLifecycleActor,
  deps: Pick<TenantLifecycleDeps, "audit">,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  await deps.audit.emit(
    createAuditEvent({
      actorId: actor.actorId,
      actorRoles: actor.actorRoles,
      tenantId: "platform",
      action: AuditAction.OrganisationUpdated,
      resource: "organisation",
      resourceId: organisationId,
      metadata: { transition, ...metadata },
    })
  );
}

export async function suspendTenant(
  organisationId: string,
  actor: TenantLifecycleActor,
  deps: TenantLifecycleDeps
): Promise<{ organisationId: string; suspended: boolean; coordinated: string[] }> {
  await auditTransition(organisationId, "suspend", actor, deps);
  const coordinated: string[] = [];
  await deps.coordinator.suspendData(organisationId);
  coordinated.push("data");
  await deps.coordinator.suspendStorage(organisationId);
  coordinated.push("storage");
  await deps.coordinator.suspendRealm(organisationId);
  coordinated.push("realm");
  await deps.coordinator.suspendDsr(organisationId, actor);
  coordinated.push("dsr");
  return { organisationId, suspended: true, coordinated };
}

export async function deleteTenant(
  organisationId: string,
  actor: TenantLifecycleActor,
  deps: TenantLifecycleDeps
): Promise<{
  organisationId: string;
  deleted: boolean;
  export: TenantLifecycleExportResult;
  coordinated: string[];
}> {
  const exportResult = await deps.coordinator.exportTenant(organisationId, actor);
  await auditTransition(organisationId, "delete", actor, deps, {
    exportDigest: exportResult.digest,
  });
  const coordinated: string[] = ["export"];
  await deps.coordinator.deleteStorage(organisationId);
  coordinated.push("storage");
  await deps.coordinator.deleteRealm(organisationId);
  coordinated.push("realm");
  await deps.coordinator.deleteDsr(organisationId, actor);
  coordinated.push("dsr");
  await deps.coordinator.deleteData(organisationId);
  coordinated.push("data");
  return { organisationId, deleted: true, export: exportResult, coordinated };
}
