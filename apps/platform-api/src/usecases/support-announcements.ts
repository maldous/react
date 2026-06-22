import { createAuditEvent, type AuditEventPort, AuditAction } from "@platform/audit-events";
import { createLogger } from "@platform/platform-logging";
import { createTracer, withSpan } from "@platform/platform-observability";

export interface SupportAnnouncementInput {
  idempotencyKey?: string;
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

export const SUPPORT_ANNOUNCEMENT_STATE_MACHINE = {
  initial: "published",
  states: ["draft", "published", "cancelled", "failed"] as const,
  idempotencyKey: "idempotencyKey",
  allowedTransitions: [
    ["draft", "published"],
    ["published", "cancelled"],
    ["published", "failed"],
  ] as const,
  forbiddenTransitions: [
    ["cancelled", "published"],
    ["failed", "published"],
  ] as const,
  operatorRecovery: ["cancelSupportAnnouncement", "retrySupportAnnouncementOperation"] as const,
};

const SUPPORT_ANNOUNCEMENT_TIMEOUT_MS = 5_000;
const SUPPORT_ANNOUNCEMENT_RETRY_ATTEMPTS = 2;
const log = createLogger({
  name: "support-announcements-usecase",
  service: "platform-api",
  packageName: "support-announcements",
  boundedContext: "support",
});
const tracer = createTracer("support-announcements");
const supportAnnouncementMetrics = {
  publishAttempts: 0,
  listAttempts: 0,
  cancellations: 0,
  retries: 0,
  failures: 0,
};

export function getSupportAnnouncementMetric(
  name: keyof typeof supportAnnouncementMetrics
): number {
  return supportAnnouncementMetrics[name];
}

async function withTimeout<T>(operation: Promise<T>, operationName: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`support_announcement.timeout: ${operationName}`)),
          SUPPORT_ANNOUNCEMENT_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function retrySupportAnnouncementOperation<T>(
  operationName: string,
  operation: () => Promise<T>
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= SUPPORT_ANNOUNCEMENT_RETRY_ATTEMPTS; attempt++) {
    try {
      return await withTimeout(operation(), operationName);
    } catch (err) {
      lastError = err;
      supportAnnouncementMetrics.failures += 1;
      if (attempt >= SUPPORT_ANNOUNCEMENT_RETRY_ATTEMPTS) break;
      supportAnnouncementMetrics.retries += 1;
      log.warn({ operationName, attempt, err }, "support_announcement.operation.retry");
    }
  }
  throw lastError;
}

export async function createSupportAnnouncement(
  input: SupportAnnouncementInput,
  deps: SupportAnnouncementDeps
): Promise<{ id: string; subject: string }> {
  supportAnnouncementMetrics.publishAttempts += 1;
  return withSpan(
    tracer,
    "support-announcement.publish",
    async () => {
      await deps.audit.emit(
        createAuditEvent({
          actorId: input.actorId,
          actorRoles: input.actorRoles,
          tenantId: input.organisationId,
          action: AuditAction.NotificationTested,
          resource: "support_announcement",
          resourceId: input.idempotencyKey ?? input.subject,
          metadata: {
            subject: input.subject,
            idempotencyKey: input.idempotencyKey,
            state: SUPPORT_ANNOUNCEMENT_STATE_MACHINE.initial,
          },
        })
      );
      const result = await retrySupportAnnouncementOperation("support-announcement.publish", () =>
        input.idempotencyKey
          ? deps.pool.query<{ id: string }>(
              `INSERT INTO public.support_announcements
                 (id, organisation_id, subject, message, created_by)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (id) DO UPDATE
                 SET subject = public.support_announcements.subject
               RETURNING id`,
              [
                input.idempotencyKey,
                input.organisationId,
                input.subject,
                input.message,
                input.actorId,
              ]
            )
          : deps.pool.query<{ id: string }>(
              `INSERT INTO public.support_announcements
                 (organisation_id, subject, message, created_by)
               VALUES ($1, $2, $3, $4)
               RETURNING id`,
              [input.organisationId, input.subject, input.message, input.actorId]
            )
      );
      log.info(
        { announcementId: result.rows[0]!.id, organisationId: input.organisationId },
        "support_announcement.published"
      );
      return { id: result.rows[0]!.id, subject: input.subject };
    },
    {
      "support.organisation_id": input.organisationId,
      "support.announcement_idempotency_key": input.idempotencyKey ?? "generated",
    }
  );
}

export async function listSupportAnnouncements(
  organisationId: string,
  deps: SupportAnnouncementDeps,
  limit = 50
): Promise<
  Array<{ id: string; subject: string; message: string; createdBy: string; createdAt: string }>
> {
  supportAnnouncementMetrics.listAttempts += 1;
  const result = await withSpan(
    tracer,
    "support-announcement.list",
    () =>
      retrySupportAnnouncementOperation("support-announcement.list", () =>
        deps.pool.query<{
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
        )
      ),
    { "support.organisation_id": organisationId }
  );
  return result.rows.map((r) => ({
    id: r.id,
    subject: r.subject,
    message: r.message,
    createdBy: r.created_by,
    createdAt: r.created_at.toISOString(),
  }));
}

export async function cancelSupportAnnouncement(
  input: { organisationId: string; announcementId: string; actorId: string; actorRoles: string[] },
  deps: SupportAnnouncementDeps
): Promise<{ id: string; status: "cancelled" | "not_found" }> {
  supportAnnouncementMetrics.cancellations += 1;
  return withSpan(
    tracer,
    "support-announcement.cancel",
    async () => {
      await deps.audit.emit(
        createAuditEvent({
          actorId: input.actorId,
          actorRoles: input.actorRoles,
          tenantId: input.organisationId,
          action: AuditAction.NotificationTested,
          resource: "support_announcement",
          resourceId: input.announcementId,
          metadata: { state: "cancelled", compensation: true },
        })
      );
      const result = await retrySupportAnnouncementOperation("support-announcement.cancel", () =>
        deps.pool.query<{ id: string }>(
          `DELETE FROM public.support_announcements
            WHERE organisation_id = $1 AND id = $2
            RETURNING id`,
          [input.organisationId, input.announcementId]
        )
      );
      const found = result.rows[0]?.id;
      return found
        ? { id: found, status: "cancelled" as const }
        : { id: input.announcementId, status: "not_found" as const };
    },
    {
      "support.organisation_id": input.organisationId,
      "support.announcement_id": input.announcementId,
    }
  );
}
