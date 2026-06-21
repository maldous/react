import { createAuditEvent, AuditAction, type AuditEventPort } from "@platform/audit-events";
import type pg from "pg";

export interface SupportTicketInput {
  organisationId: string;
  subject: string;
  body: string;
  actorId: string;
  actorRoles: string[];
}

export async function createSupportTicket(
  input: SupportTicketInput,
  deps: { pool: pg.Pool; audit: AuditEventPort }
): Promise<{ id: string; subject: string }> {
  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actorId,
      actorRoles: input.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.NotificationTested,
      resource: "support_ticket",
      resourceId: input.subject,
      metadata: { subject: input.subject },
    })
  );
  const result = await deps.pool.query<{ id: string }>(
    `INSERT INTO public.support_tickets (organisation_id, subject, body, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [input.organisationId, input.subject, input.body, input.actorId]
  );
  return { id: result.rows[0]!.id, subject: input.subject };
}

export async function listSupportTickets(
  organisationId: string,
  deps: { pool: pg.Pool }
): Promise<
  Array<{ id: string; subject: string; body: string; createdBy: string; createdAt: string }>
> {
  const result = await deps.pool.query(
    `SELECT id, subject, body, created_by, created_at
       FROM public.support_tickets
      WHERE organisation_id = $1
      ORDER BY created_at DESC`,
    [organisationId]
  );
  return result.rows.map(
    (r: { id: string; subject: string; body: string; created_by: string; created_at: Date }) => ({
      id: r.id,
      subject: r.subject,
      body: r.body,
      createdBy: r.created_by,
      createdAt: r.created_at.toISOString(),
    })
  );
}

export async function getCustomerHealth(organisationId: string, deps: { pool: pg.Pool }) {
  const [{ rows: ticketRows }, { rows: usageRows }] = await Promise.all([
    deps.pool.query(
      `SELECT COUNT(*)::int AS count FROM public.support_tickets WHERE organisation_id = $1`,
      [organisationId]
    ),
    deps.pool.query(
      `SELECT COALESCE(SUM(quantity),0)::int AS count FROM public.meter_events WHERE organisation_id = $1`,
      [organisationId]
    ),
  ]);
  const tickets = ticketRows[0]?.count ?? 0;
  const usage = usageRows[0]?.count ?? 0;
  return {
    organisationId,
    score: Math.max(0, 100 - tickets * 10 - Math.floor(usage / 1000)),
    signals: { tickets, usage },
  };
}
