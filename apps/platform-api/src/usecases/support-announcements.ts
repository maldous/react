import { createAuditEvent, type AuditEventPort, AuditAction } from "@platform/audit-events";

export interface SupportAnnouncementInput {
  organisationId: string;
  subject: string;
  message: string;
  actorId: string;
  actorRoles: string[];
}

export interface SupportAnnouncementDeps {
  pool: {
    query<T = { id: string }>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
  };
  audit: AuditEventPort;
}

export async function createSupportAnnouncement(
  input: SupportAnnouncementInput,
  deps: SupportAnnouncementDeps
): Promise<{ id: string; subject: string }> {
  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actorId,
      actorRoles: input.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.NotificationTested,
      resource: "support_announcement",
      resourceId: input.subject,
      metadata: { subject: input.subject },
    })
  );
  const result = await deps.pool.query<{ id: string }>(
    `INSERT INTO public.support_announcements
       (organisation_id, subject, message, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [input.organisationId, input.subject, input.message, input.actorId]
  );
  return { id: result.rows[0]!.id, subject: input.subject };
}

export async function listSupportAnnouncements(
  organisationId: string,
  deps: SupportAnnouncementDeps,
  limit = 50
): Promise<
  Array<{ id: string; subject: string; message: string; createdBy: string; createdAt: string }>
> {
  const result = await deps.pool.query<{
    id: string;
    subject: string;
    message: string;
    created_by: string;
    created_at: Date;
  }>(
    `SELECT id, subject, message, created_by, created_at
       FROM public.support_announcements
      WHERE organisation_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [organisationId, limit]
  );
  return result.rows.map((r) => ({
    id: r.id,
    subject: r.subject,
    message: r.message,
    createdBy: r.created_by,
    createdAt: r.created_at.toISOString(),
  }));
}
