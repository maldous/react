import type pg from "pg";
import type { WebhookEventType, WebhookDeliveryStatus } from "@platform/contracts-admin";
import { createLogger } from "@platform/platform-logging";
import { encryptTenantSecret, decryptTenantSecret } from "./tenant-secret-crypto.ts";
import type {
  ClaimedDelivery,
  CreateWebhookInput,
  DeliveryResult,
  RecordDeliveryInput,
  UpdateWebhookFields,
  WebhookDeliveryRecord,
  WebhookStore,
  WebhookSubscriptionRecord,
} from "../ports/webhook-store.ts";

const log = createLogger({ name: "postgres-webhook-store" });

interface SubRow {
  id: string;
  url: string;
  enabled: boolean;
  event_types: string[];
  has_secret: boolean;
  created_at: Date | string | null;
  updated_at: Date | string | null;
}

const iso = (v: Date | string | null): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString();

function toRecord(r: SubRow): WebhookSubscriptionRecord {
  return {
    id: r.id,
    url: r.url,
    enabled: r.enabled,
    eventTypes: (r.event_types ?? []) as WebhookEventType[],
    hasSecret: r.has_secret,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

const SELECT_SUB =
  "id, url, enabled, event_types, (secret_enc IS NOT NULL) AS has_secret, created_at, updated_at";

/** Postgres webhook store (ADR-0051). Plain pool + explicit organisation_id filter
 * (public schema, like vanity_domain_challenges). The secret is AES-256-GCM encrypted;
 * reads never select `secret_enc` except `getSecret` (server-side signing only). */
export class PostgresWebhookStore implements WebhookStore {
  private readonly pool: pg.Pool;
  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async list(organisationId: string): Promise<WebhookSubscriptionRecord[]> {
    const { rows } = await this.pool.query<SubRow>(
      `SELECT ${SELECT_SUB} FROM public.tenant_webhook_subscriptions
        WHERE organisation_id = $1 ORDER BY created_at DESC`,
      [organisationId]
    );
    return rows.map(toRecord);
  }

  async get(organisationId: string, id: string): Promise<WebhookSubscriptionRecord | null> {
    const { rows } = await this.pool.query<SubRow>(
      `SELECT ${SELECT_SUB} FROM public.tenant_webhook_subscriptions
        WHERE organisation_id = $1 AND id = $2`,
      [organisationId, id]
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async create(input: CreateWebhookInput): Promise<WebhookSubscriptionRecord> {
    const { rows } = await this.pool.query<SubRow>(
      `INSERT INTO public.tenant_webhook_subscriptions
         (organisation_id, url, event_types, enabled, secret_enc)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${SELECT_SUB}`,
      [
        input.organisationId,
        input.url,
        input.eventTypes,
        input.enabled,
        encryptTenantSecret(input.secret),
      ]
    );
    return toRecord(rows[0]!);
  }

  async update(
    organisationId: string,
    id: string,
    fields: UpdateWebhookFields
  ): Promise<WebhookSubscriptionRecord | null> {
    const { rows } = await this.pool.query<SubRow>(
      `UPDATE public.tenant_webhook_subscriptions
          SET url         = COALESCE($3, url),
              event_types = COALESCE($4, event_types),
              enabled     = COALESCE($5, enabled),
              updated_at  = now()
        WHERE organisation_id = $1 AND id = $2
        RETURNING ${SELECT_SUB}`,
      [organisationId, id, fields.url ?? null, fields.eventTypes ?? null, fields.enabled ?? null]
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async delete(organisationId: string, id: string): Promise<boolean> {
    const res = await this.pool.query(
      `DELETE FROM public.tenant_webhook_subscriptions WHERE organisation_id = $1 AND id = $2`,
      [organisationId, id]
    );
    return (res.rowCount ?? 0) > 0;
  }

  async rotateSecret(organisationId: string, id: string, secret: string): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE public.tenant_webhook_subscriptions
          SET secret_enc = $3, updated_at = now()
        WHERE organisation_id = $1 AND id = $2`,
      [organisationId, id, encryptTenantSecret(secret)]
    );
    return (res.rowCount ?? 0) > 0;
  }

  async getSecret(organisationId: string, id: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ secret_enc: string }>(
      `SELECT secret_enc FROM public.tenant_webhook_subscriptions
        WHERE organisation_id = $1 AND id = $2`,
      [organisationId, id]
    );
    if (!rows[0]) return null;
    try {
      return decryptTenantSecret(rows[0].secret_enc);
    } catch (err) {
      log.error({ organisationId, id, err }, "webhook-store: failed to decrypt signing secret");
      return null;
    }
  }

  async recordDelivery(input: RecordDeliveryInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO public.tenant_webhook_deliveries
         (organisation_id, subscription_id, event, status, response_status, attempt, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.organisationId,
        input.subscriptionId,
        input.event,
        input.status,
        input.responseStatus,
        input.attempt,
        input.error,
      ]
    );
  }

  async listDeliveries(
    organisationId: string,
    subscriptionId: string,
    limit: number
  ): Promise<WebhookDeliveryRecord[]> {
    const { rows } = await this.pool.query<{
      id: string;
      event: string;
      status: string;
      response_status: number | null;
      attempt: number;
      error: string | null;
      created_at: Date | string | null;
    }>(
      `SELECT id, event, status, response_status, attempt, error, created_at
         FROM public.tenant_webhook_deliveries
        WHERE organisation_id = $1 AND subscription_id = $2
        ORDER BY created_at DESC LIMIT $3`,
      [organisationId, subscriptionId, limit]
    );
    return rows.map((r) => ({
      id: r.id,
      event: r.event as WebhookEventType,
      // `processing` is a transient internal claim state — surface it as `pending`.
      status: (r.status === "processing" ? "pending" : r.status) as WebhookDeliveryStatus,
      responseStatus: r.response_status,
      attempt: r.attempt,
      error: r.error,
      createdAt: iso(r.created_at),
    }));
  }

  async counts(organisationId: string): Promise<{ total: number; enabled: number }> {
    const { rows } = await this.pool.query<{ total: number; enabled: number }>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE enabled)::int AS enabled
         FROM public.tenant_webhook_subscriptions WHERE organisation_id = $1`,
      [organisationId]
    );
    return { total: rows[0]?.total ?? 0, enabled: rows[0]?.enabled ?? 0 };
  }

  // --- durable delivery queue (ADR-0052) ---

  async enqueueDelivery(input: {
    organisationId: string;
    subscriptionId: string;
    event: string;
    payload: string;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO public.tenant_webhook_deliveries
         (organisation_id, subscription_id, event, status, attempt, payload, next_attempt_at)
       VALUES ($1, $2, $3, 'pending', 0, $4, now())`,
      [input.organisationId, input.subscriptionId, input.event, input.payload]
    );
  }

  async claimDueDeliveries(limit: number, now: Date): Promise<ClaimedDelivery[]> {
    // Atomic claim: flip due pending/processing rows to `processing` and return them.
    // FOR UPDATE SKIP LOCKED makes this safe under multiple workers; leaving
    // next_attempt_at <= now means a crashed tick's `processing` row is re-claimable.
    const { rows } = await this.pool.query<{
      id: string;
      organisation_id: string;
      subscription_id: string;
      event: string;
      payload: string | null;
      attempt: number;
    }>(
      `UPDATE public.tenant_webhook_deliveries
          SET status = 'processing'
        WHERE id IN (
          SELECT id FROM public.tenant_webhook_deliveries
           WHERE status IN ('pending', 'processing') AND next_attempt_at <= $2
           ORDER BY next_attempt_at
           LIMIT $1
           FOR UPDATE SKIP LOCKED
        )
        RETURNING id, organisation_id, subscription_id, event, payload, attempt`,
      [limit, now]
    );
    return rows.map((r) => ({
      id: r.id,
      organisationId: r.organisation_id,
      subscriptionId: r.subscription_id,
      event: r.event as WebhookEventType,
      payload: r.payload,
      attempt: r.attempt,
    }));
  }

  async markDeliveryResult(id: string, result: DeliveryResult): Promise<void> {
    await this.pool.query(
      `UPDATE public.tenant_webhook_deliveries
          SET status = $2, response_status = $3, attempt = $4, error = $5, next_attempt_at = $6
        WHERE id = $1`,
      [id, result.status, result.responseStatus, result.attempt, result.error, result.nextAttemptAt]
    );
  }
}
