/**
 * PostgresEventBus + PostgresWorkerRegistry (ADR-0059 / ADR-ACT-0259).
 *
 * Built-in durable outbox over public.platform_events + public.event_dead_letters
 * (migration 027), RLS-enabled. Idempotent publish (ON CONFLICT DO NOTHING). The
 * worker claims due pending events with FOR UPDATE SKIP LOCKED, processes, and either
 * marks processed or records a failure (retry, or dead-letter at max_attempts).
 * Publish/claim/process/operator-reads use withSystemAdmin (the worker is cross-tenant
 * system infra; tenant isolation is still enforced for tenant-context reads via RLS).
 * worker_heartbeats is global infra (no tenant column). No secret payload fields.
 */

import { withSystemAdmin } from "@platform/adapters-postgres";
import type {
  ClaimedEvent,
  DeadLetterRow,
  EventBusPort,
  EventRow,
  PublishEventInput,
  WorkerRecord,
  WorkerRegistryPort,
} from "../ports/event-bus.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgPool = { connect(): Promise<any> };

function iso(v: Date | string | null): string | null {
  if (v == null) return null;
  return typeof v === "string" ? v : v.toISOString();
}

export class PostgresEventBus implements EventBusPort {
  private readonly pool: PgPool;
  constructor(pool: PgPool) {
    this.pool = pool;
  }

  async publish(input: PublishEventInput): Promise<{ published: boolean; deduplicated: boolean }> {
    const payload = JSON.stringify(input.payload ?? {});
    const r = await withSystemAdmin(this.pool as never, (client) =>
      client.query(
        `INSERT INTO public.platform_events
           (organisation_id, event_type, payload, idempotency_key, max_attempts)
         VALUES ($1, $2, $3::jsonb, $4, COALESCE($5, 5))
         ON CONFLICT (organisation_id, event_type, idempotency_key) DO NOTHING`,
        [
          input.organisationId,
          input.eventType,
          payload,
          input.idempotencyKey,
          input.maxAttempts ?? null,
        ]
      )
    );
    const published = (r.rowCount ?? 0) > 0;
    return { published, deduplicated: !published };
  }

  async claimBatch(limit: number): Promise<ClaimedEvent[]> {
    const r = await withSystemAdmin(this.pool as never, (client) =>
      client.query(
        `UPDATE public.platform_events SET status='processing', updated_at=now()
          WHERE id IN (
            SELECT id FROM public.platform_events
             WHERE status='pending' AND available_at <= now()
             ORDER BY created_at
             LIMIT $1
             FOR UPDATE SKIP LOCKED
          )
        RETURNING id, organisation_id, event_type, idempotency_key, payload, attempts, max_attempts`,
        [limit]
      )
    );
    return (
      r.rows as {
        id: string;
        organisation_id: string;
        event_type: string;
        idempotency_key: string;
        payload: Record<string, unknown>;
        attempts: number;
        max_attempts: number;
      }[]
    ).map((row) => ({
      id: row.id,
      organisationId: row.organisation_id,
      eventType: row.event_type,
      idempotencyKey: row.idempotency_key,
      payload: row.payload ?? {},
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
    }));
  }

  async markProcessed(eventId: string): Promise<void> {
    await withSystemAdmin(this.pool as never, (client) =>
      client.query(
        `UPDATE public.platform_events
            SET status='processed', processed_at=now(), updated_at=now()
          WHERE id=$1`,
        [eventId]
      )
    );
  }

  async recordFailure(eventId: string, error: string): Promise<"retry" | "dead_lettered"> {
    return withSystemAdmin(this.pool as never, async (client) => {
      const upd = await client.query(
        `UPDATE public.platform_events
            SET attempts = attempts + 1,
                last_error = $2,
                status = CASE WHEN attempts + 1 >= max_attempts THEN 'failed' ELSE 'pending' END,
                available_at = now(),
                updated_at = now()
          WHERE id = $1
        RETURNING organisation_id, event_type, payload, idempotency_key, attempts, status`,
        [eventId, error.slice(0, 1000)]
      );
      const row = upd.rows[0] as
        | {
            organisation_id: string;
            event_type: string;
            payload: Record<string, unknown>;
            idempotency_key: string;
            attempts: number;
            status: string;
          }
        | undefined;
      if (!row) return "retry";
      if (row.status === "failed") {
        await client.query(
          `INSERT INTO public.event_dead_letters
             (event_id, organisation_id, event_type, payload, idempotency_key, attempts, last_error)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
          [
            eventId,
            row.organisation_id,
            row.event_type,
            JSON.stringify(row.payload ?? {}),
            row.idempotency_key,
            row.attempts,
            error.slice(0, 1000),
          ]
        );
        return "dead_lettered";
      }
      return "retry";
    });
  }

  async listEvents(organisationId: string, limit: number): Promise<EventRow[]> {
    const r = await withSystemAdmin(this.pool as never, (client) =>
      client.query(
        `SELECT id, organisation_id, event_type, status, attempts, max_attempts, last_error, created_at, processed_at
           FROM public.platform_events WHERE organisation_id=$1 ORDER BY created_at DESC LIMIT $2`,
        [organisationId, limit]
      )
    );
    return (r.rows as Record<string, unknown>[]).map((row) => ({
      id: row["id"] as string,
      organisationId: row["organisation_id"] as string,
      eventType: row["event_type"] as string,
      status: row["status"] as string,
      attempts: Number(row["attempts"]),
      maxAttempts: Number(row["max_attempts"]),
      lastError: (row["last_error"] as string | null) ?? null,
      createdAt: iso(row["created_at"] as Date) ?? "",
      processedAt: iso(row["processed_at"] as Date | null),
    }));
  }

  async listDeadLetters(organisationId: string, limit: number): Promise<DeadLetterRow[]> {
    const r = await withSystemAdmin(this.pool as never, (client) =>
      client.query(
        `SELECT id, event_id, organisation_id, event_type, attempts, last_error, dead_at, redriven_at
           FROM public.event_dead_letters WHERE organisation_id=$1 ORDER BY dead_at DESC LIMIT $2`,
        [organisationId, limit]
      )
    );
    return (r.rows as Record<string, unknown>[]).map((row) => ({
      id: row["id"] as string,
      eventId: row["event_id"] as string,
      organisationId: row["organisation_id"] as string,
      eventType: row["event_type"] as string,
      attempts: Number(row["attempts"]),
      lastError: (row["last_error"] as string | null) ?? null,
      deadAt: iso(row["dead_at"] as Date) ?? "",
      redrivenAt: iso(row["redriven_at"] as Date | null),
    }));
  }

  async redrive(deadLetterId: string): Promise<{ eventId: string } | null> {
    return withSystemAdmin(this.pool as never, async (client) => {
      const dl = await client.query(
        `SELECT organisation_id, event_type, payload, idempotency_key
           FROM public.event_dead_letters WHERE id=$1 AND redriven_at IS NULL`,
        [deadLetterId]
      );
      const row = dl.rows[0] as
        | {
            organisation_id: string;
            event_type: string;
            payload: Record<string, unknown>;
            idempotency_key: string;
          }
        | undefined;
      if (!row) return null;
      // Re-enqueue with a redrive-suffixed idempotency key so the unique constraint
      // (the original event still exists as 'failed') does not silently drop the requeue.
      const newKey = `${row.idempotency_key}:redrive:${deadLetterId}`;
      const ins = await client.query(
        `INSERT INTO public.platform_events
           (organisation_id, event_type, payload, idempotency_key)
         VALUES ($1, $2, $3::jsonb, $4)
         ON CONFLICT (organisation_id, event_type, idempotency_key) DO NOTHING
         RETURNING id`,
        [row.organisation_id, row.event_type, JSON.stringify(row.payload ?? {}), newKey]
      );
      const eventId = (ins.rows[0] as { id: string } | undefined)?.id;
      if (!eventId) return null;
      await client.query(`UPDATE public.event_dead_letters SET redriven_at=now() WHERE id=$1`, [
        deadLetterId,
      ]);
      return { eventId };
    });
  }
}

export class PostgresWorkerRegistry implements WorkerRegistryPort {
  private readonly pool: PgPool;
  constructor(pool: PgPool) {
    this.pool = pool;
  }

  async heartbeat(workerId: string, workerKind: string, status = "alive"): Promise<void> {
    await withSystemAdmin(this.pool as never, (client) =>
      client.query(
        `INSERT INTO public.worker_heartbeats (worker_id, worker_kind, status, last_heartbeat_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (worker_id) DO UPDATE SET
           worker_kind = EXCLUDED.worker_kind,
           status = EXCLUDED.status,
           last_heartbeat_at = now()`,
        [workerId, workerKind, status]
      )
    );
  }

  async listWorkers(): Promise<WorkerRecord[]> {
    const r = await withSystemAdmin(this.pool as never, (client) =>
      client.query(
        `SELECT worker_id, worker_kind, status, last_heartbeat_at
           FROM public.worker_heartbeats ORDER BY last_heartbeat_at DESC`
      )
    );
    return (r.rows as Record<string, unknown>[]).map((row) => ({
      workerId: row["worker_id"] as string,
      workerKind: row["worker_kind"] as string,
      status: row["status"] as string,
      lastHeartbeatAt: iso(row["last_heartbeat_at"] as Date) ?? "",
    }));
  }
}
