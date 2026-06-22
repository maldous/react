import { createAuditEvent, AuditAction, type AuditEventPort } from "@platform/audit-events";
import { createLogger } from "@platform/platform-logging";
import { createTracer, withSpan } from "@platform/platform-observability";
import type pg from "pg";

export interface SupportTicketInput {
  idempotencyKey?: string;
  organisationId: string;
  subject: string;
  body: string;
  actorId: string;
  actorRoles: string[];
}

export const SUPPORT_TICKET_STATE_MACHINE = {
  initial: "created",
  states: ["created", "cancelled", "failed"] as const,
  idempotencyKey: "idempotencyKey",
  allowedTransitions: [
    ["created", "cancelled"],
    ["created", "failed"],
  ] as const,
  forbiddenTransitions: [
    ["cancelled", "created"],
    ["failed", "created"],
  ] as const,
  operatorRecovery: ["cancelSupportTicket", "retrySupportTicketOperation"] as const,
};

const SUPPORT_TICKET_TIMEOUT_MS = 5_000;
const SUPPORT_TICKET_RETRY_ATTEMPTS = 2;
const log = createLogger({
  name: "support-tickets-usecase",
  service: "platform-api",
  packageName: "support-tickets",
  boundedContext: "support",
});
const tracer = createTracer("support-tickets");
const supportTicketMetrics = {
  createAttempts: 0,
  listAttempts: 0,
  healthChecks: 0,
  cancellations: 0,
  retries: 0,
  failures: 0,
};

export function getSupportTicketMetric(name: keyof typeof supportTicketMetrics): number {
  return supportTicketMetrics[name];
}

async function withTimeout<T>(operation: Promise<T>, operationName: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`support_ticket.timeout: ${operationName}`)),
          SUPPORT_TICKET_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function retrySupportTicketOperation<T>(
  operationName: string,
  operation: () => Promise<T>
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= SUPPORT_TICKET_RETRY_ATTEMPTS; attempt++) {
    try {
      return await withTimeout(operation(), operationName);
    } catch (err) {
      lastError = err;
      supportTicketMetrics.failures += 1;
      if (attempt >= SUPPORT_TICKET_RETRY_ATTEMPTS) break;
      supportTicketMetrics.retries += 1;
      log.warn({ operationName, attempt, err }, "support_ticket.operation.retry");
    }
  }
  throw lastError;
}

export async function createSupportTicket(
  input: SupportTicketInput,
  deps: { pool: pg.Pool; audit: AuditEventPort }
): Promise<{ id: string; subject: string }> {
  supportTicketMetrics.createAttempts += 1;
  return withSpan(
    tracer,
    "support-ticket.create",
    async () => {
      await deps.audit.emit(
        createAuditEvent({
          actorId: input.actorId,
          actorRoles: input.actorRoles,
          tenantId: input.organisationId,
          action: AuditAction.NotificationTested,
          resource: "support_ticket",
          resourceId: input.idempotencyKey ?? input.subject,
          metadata: {
            subject: input.subject,
            idempotencyKey: input.idempotencyKey,
            state: SUPPORT_TICKET_STATE_MACHINE.initial,
          },
        })
      );
      const result = await retrySupportTicketOperation("support-ticket.create", () =>
        input.idempotencyKey
          ? deps.pool.query<{ id: string }>(
              `INSERT INTO public.support_tickets (id, organisation_id, subject, body, created_by)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (id) DO UPDATE
                 SET subject = public.support_tickets.subject
               RETURNING id`,
              [input.idempotencyKey, input.organisationId, input.subject, input.body, input.actorId]
            )
          : deps.pool.query<{ id: string }>(
              `INSERT INTO public.support_tickets (organisation_id, subject, body, created_by)
               VALUES ($1, $2, $3, $4)
               RETURNING id`,
              [input.organisationId, input.subject, input.body, input.actorId]
            )
      );
      log.info(
        { ticketId: result.rows[0]!.id, organisationId: input.organisationId },
        "support_ticket.created"
      );
      return { id: result.rows[0]!.id, subject: input.subject };
    },
    {
      "support.organisation_id": input.organisationId,
      "support.ticket_idempotency_key": input.idempotencyKey ?? "generated",
    }
  );
}

export async function listSupportTickets(
  organisationId: string,
  deps: { pool: pg.Pool }
): Promise<
  Array<{ id: string; subject: string; body: string; createdBy: string; createdAt: string }>
> {
  supportTicketMetrics.listAttempts += 1;
  const result = await withSpan(
    tracer,
    "support-ticket.list",
    () =>
      retrySupportTicketOperation("support-ticket.list", () =>
        deps.pool.query(
          `SELECT id, subject, body, created_by, created_at
             FROM public.support_tickets
            WHERE organisation_id = $1
            ORDER BY created_at DESC`,
          [organisationId]
        )
      ),
    { "support.organisation_id": organisationId }
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
  supportTicketMetrics.healthChecks += 1;
  const [{ rows: ticketRows }, { rows: usageRows }] = await withSpan(
    tracer,
    "support-ticket.health",
    () =>
      retrySupportTicketOperation("support-ticket.health", () =>
        Promise.all([
          deps.pool.query(
            `SELECT COUNT(*)::int AS count FROM public.support_tickets WHERE organisation_id = $1`,
            [organisationId]
          ),
          deps.pool.query(
            `SELECT COALESCE(SUM(quantity),0)::int AS count FROM public.meter_events WHERE organisation_id = $1`,
            [organisationId]
          ),
        ])
      ),
    { "support.organisation_id": organisationId }
  );
  const tickets = ticketRows[0]?.count ?? 0;
  const usage = usageRows[0]?.count ?? 0;
  return {
    organisationId,
    score: Math.max(0, 100 - tickets * 10 - Math.floor(usage / 1000)),
    signals: { tickets, usage },
  };
}

export async function cancelSupportTicket(
  input: { organisationId: string; ticketId: string; actorId: string; actorRoles: string[] },
  deps: { pool: pg.Pool; audit: AuditEventPort }
): Promise<{ id: string; status: "cancelled" | "not_found" }> {
  supportTicketMetrics.cancellations += 1;
  return withSpan(
    tracer,
    "support-ticket.cancel",
    async () => {
      await deps.audit.emit(
        createAuditEvent({
          actorId: input.actorId,
          actorRoles: input.actorRoles,
          tenantId: input.organisationId,
          action: AuditAction.NotificationTested,
          resource: "support_ticket",
          resourceId: input.ticketId,
          metadata: { state: "cancelled", compensation: true },
        })
      );
      const result = await retrySupportTicketOperation("support-ticket.cancel", () =>
        deps.pool.query<{ id: string }>(
          `DELETE FROM public.support_tickets
            WHERE organisation_id = $1 AND id = $2
            RETURNING id`,
          [input.organisationId, input.ticketId]
        )
      );
      const found = result.rows[0]?.id;
      return found
        ? { id: found, status: "cancelled" as const }
        : { id: input.ticketId, status: "not_found" as const };
    },
    {
      "support.organisation_id": input.organisationId,
      "support.ticket_id": input.ticketId,
    }
  );
}
