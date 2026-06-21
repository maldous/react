import type pg from "pg";
import { createAuditEvent, AuditAction, type AuditEventPort } from "@platform/audit-events";

export interface TenantLifecycleDeps {
  pool: pg.Pool;
  audit: AuditEventPort;
}

export async function suspendTenant(
  organisationId: string,
  actor: { actorId: string; actorRoles: string[] },
  deps: TenantLifecycleDeps
): Promise<{ organisationId: string; suspended: boolean }> {
  await deps.audit.emit(
    createAuditEvent({
      actorId: actor.actorId,
      actorRoles: actor.actorRoles,
      tenantId: "platform",
      action: AuditAction.OrganisationUpdated,
      resource: "organisation",
      resourceId: organisationId,
      metadata: { transition: "suspend" },
    })
  );
  await deps.pool.query(`UPDATE public.organisations SET is_active = false WHERE id = $1`, [
    organisationId,
  ]);
  return { organisationId, suspended: true };
}

export async function deleteTenant(
  organisationId: string,
  actor: { actorId: string; actorRoles: string[] },
  deps: TenantLifecycleDeps
): Promise<{ organisationId: string; deleted: boolean }> {
  await deps.audit.emit(
    createAuditEvent({
      actorId: actor.actorId,
      actorRoles: actor.actorRoles,
      tenantId: "platform",
      action: AuditAction.OrganisationUpdated,
      resource: "organisation",
      resourceId: organisationId,
      metadata: { transition: "delete" },
    })
  );
  await deps.pool
    .query(`UPDATE public.organisations SET is_active = false, deleted_at = NOW() WHERE id = $1`, [
      organisationId,
    ])
    .catch(async () => {
      await deps.pool.query(`UPDATE public.organisations SET is_active = false WHERE id = $1`, [
        organisationId,
      ]);
    });
  return { organisationId, deleted: true };
}
