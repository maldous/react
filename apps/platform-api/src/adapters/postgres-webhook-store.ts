import type pg from "pg";
import type { WebhookEventType, WebhookDeliveryStatus } from "@platform/contracts-admin";
import { createLogger } from "@platform/platform-logging";
import { encryptTenantSecret, decryptTenantSecret } from "./tenant-secret-crypto.ts";
import type {
  ClaimedDelivery,
  CreateWebhookInput,
  DeliveryMetrics,
  DeliveryResult,
  RecordDeliveryInput,
  UpdateWebhookFields,
  WebhookDeliveryRecord,
  WebhookStore,
  WebhookSubscriptionRecord,
} from "../ports/webhook-store.ts";

const log = createLogger({ name: "postgres-webhook-store" });

type DbTimestamp = Date | string | null;

export const postgresWebhookStoreReliabilityEvidence = {
  provider: "postgres-webhook-store",
  configSource:
    "Postgres pool is injected from process.env-backed POSTGRES_URL/POSTGRES_APP_URL configuration before adapter construction",
  secretSource:
    "webhook signing secrets enter only through create/rotateSecret, are encrypted with tenant-secret-crypto, and are read only by getSecret for server-side signing",
  timeout:
    "all webhook store operations are bounded by operationTimeoutMs through withOperationTimeout",
  retry:
    "delivery retry is explicit in the worker/usecase via attempt and next_attempt_at; adapter database writes are single attempts",
  degradedMode:
    "healthCheck returns degraded when subscription or delivery tables cannot be queried; mutation paths throw instead of fabricating webhook state",
  failClosed:
    "CRUD, delivery queue, metrics, and redrive database errors throw; getSecret returns null on decrypt failure so signing cannot continue with bad secret material",
  fallbackRationale:
    "no alternate webhook store fallback is attempted because Postgres is the durable webhook subscription and delivery queue provider",
  healthCheck:
    "healthCheck probes public.tenant_webhook_subscriptions and public.tenant_webhook_deliveries through the injected Postgres pool",
  operatorRecovery:
    "operators recover by repairing Postgres connectivity/migrations/encryption key state, checking health, and rerunning proof:webhooks proof:webhook-worker proof:webhook-redrive",
  unavailableProof: "apps/platform-api/scripts/postgres-webhook-store-runtime-proof.ts",
  misconfiguredProof: "apps/platform-api/scripts/postgres-webhook-store-runtime-proof.ts",
} as const;

const DEFAULT_WEBHOOK_STORE_OPERATION_TIMEOUT_MS = 5000;

async function withOperationTimeout<T>(
  operation: string,
  timeoutMs: number,
  promise: Promise<T>
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`postgres_webhook_store_timeout:${operation}`)),
      timeoutMs
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface SubRow {
  id: string;
  url: string;
  enabled: boolean;
  event_types: string[];
  has_secret: boolean;
  created_at: DbTimestamp;
  updated_at: DbTimestamp;
}

function iso(v: DbTimestamp): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  return new Date(v).toISOString();
}

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
  private readonly operationTimeoutMs: number;

  constructor(pool: pg.Pool, operationTimeoutMs = DEFAULT_WEBHOOK_STORE_OPERATION_TIMEOUT_MS) {
    this.pool = pool;
    this.operationTimeoutMs = operationTimeoutMs;
  }

  private execute<T>(operation: string, query: Promise<T>): Promise<T> {
    return withOperationTimeout(operation, this.operationTimeoutMs, query);
  }

  async list(organisationId: string): Promise<WebhookSubscriptionRecord[]> {
    const { rows } = await this.execute(
      "list",
      this.pool.query<SubRow>(
        `SELECT ${SELECT_SUB} FROM public.tenant_webhook_subscriptions
        WHERE organisation_id = $1 ORDER BY created_at DESC`,
        [organisationId]
      )
    );
    return rows.map(toRecord);
  }

  async get(organisationId: string, id: string): Promise<WebhookSubscriptionRecord | null> {
    const { rows } = await this.execute(
      "get",
      this.pool.query<SubRow>(
        `SELECT ${SELECT_SUB} FROM public.tenant_webhook_subscriptions
        WHERE organisation_id = $1 AND id = $2`,
        [organisationId, id]
      )
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async create(input: CreateWebhookInput): Promise<WebhookSubscriptionRecord> {
    const { rows } = await this.execute(
      "create",
      this.pool.query<SubRow>(
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
      )
    );
    return toRecord(rows[0]!);
  }

  async update(
    organisationId: string,
    id: string,
    fields: UpdateWebhookFields
  ): Promise<WebhookSubscriptionRecord | null> {
    const { rows } = await this.execute(
      "update",
      this.pool.query<SubRow>(
        `UPDATE public.tenant_webhook_subscriptions
          SET url         = COALESCE($3, url),
              event_types = COALESCE($4, event_types),
              enabled     = COALESCE($5, enabled),
              updated_at  = now()
        WHERE organisation_id = $1 AND id = $2
        RETURNING ${SELECT_SUB}`,
        [organisationId, id, fields.url ?? null, fields.eventTypes ?? null, fields.enabled ?? null]
      )
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async delete(organisationId: string, id: string): Promise<boolean> {
    const res = await this.execute(
      "delete",
      this.pool.query(
        `DELETE FROM public.tenant_webhook_subscriptions WHERE organisation_id = $1 AND id = $2`,
        [organisationId, id]
      )
    );
    return (res.rowCount ?? 0) > 0;
  }

  async rotateSecret(organisationId: string, id: string, secret: string): Promise<boolean> {
    const res = await this.execute(
      "rotateSecret",
      this.pool.query(
        `UPDATE public.tenant_webhook_subscriptions
          SET secret_enc = $3, updated_at = now()
        WHERE organisation_id = $1 AND id = $2`,
        [organisationId, id, encryptTenantSecret(secret)]
      )
    );
    return (res.rowCount ?? 0) > 0;
  }

  async getSecret(organisationId: string, id: string): Promise<string | null> {
    const { rows } = await this.execute(
      "getSecret",
      this.pool.query<{ secret_enc: string }>(
        `SELECT secret_enc FROM public.tenant_webhook_subscriptions
        WHERE organisation_id = $1 AND id = $2`,
        [organisationId, id]
      )
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
    await this.execute(
      "recordDelivery",
      this.pool.query(
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
      )
    );
  }

  async listDeliveries(
    organisationId: string,
    subscriptionId: string,
    limit: number
  ): Promise<WebhookDeliveryRecord[]> {
    const { rows } = await this.execute(
      "listDeliveries",
      this.pool.query<{
        id: string;
        event: string;
        status: string;
        response_status: number | null;
        attempt: number;
        error: string | null;
        created_at: DbTimestamp;
      }>(
        `SELECT id, event, status, response_status, attempt, error, created_at
         FROM public.tenant_webhook_deliveries
        WHERE organisation_id = $1 AND subscription_id = $2
        ORDER BY created_at DESC LIMIT $3`,
        [organisationId, subscriptionId, limit]
      )
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
    const { rows } = await this.execute(
      "counts",
      this.pool.query<{ total: number; enabled: number }>(
        `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE enabled)::int AS enabled
         FROM public.tenant_webhook_subscriptions WHERE organisation_id = $1`,
        [organisationId]
      )
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
    await this.execute(
      "enqueueDelivery",
      this.pool.query(
        `INSERT INTO public.tenant_webhook_deliveries
         (organisation_id, subscription_id, event, status, attempt, payload, next_attempt_at)
       VALUES ($1, $2, $3, 'pending', 0, $4, now())`,
        [input.organisationId, input.subscriptionId, input.event, input.payload]
      )
    );
  }

  async claimDueDeliveries(limit: number, now: Date): Promise<ClaimedDelivery[]> {
    // Atomic claim: flip due pending/processing rows to `processing` and return them.
    // FOR UPDATE SKIP LOCKED makes this safe under multiple workers; leaving
    // next_attempt_at <= now means a crashed tick's `processing` row is re-claimable.
    const { rows } = await this.execute(
      "claimDueDeliveries",
      this.pool.query<{
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
      )
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
    await this.execute(
      "markDeliveryResult",
      this.pool.query(
        `UPDATE public.tenant_webhook_deliveries
          SET status = $2, response_status = $3, attempt = $4, error = $5, next_attempt_at = $6
        WHERE id = $1`,
        [
          id,
          result.status,
          result.responseStatus,
          result.attempt,
          result.error,
          result.nextAttemptAt,
        ]
      )
    );
  }

  // --- metrics + dead-letter redrive (ADR-ACT-0226) ---

  async subscriptionMetrics(
    organisationId: string,
    subscriptionId: string
  ): Promise<DeliveryMetrics> {
    const { rows } = await this.execute(
      "subscriptionMetrics",
      this.pool.query<{
        total: number;
        delivered: number;
        failed: number;
        dead: number;
        pending: number;
        last_status: string | null;
        last_delivery_at: DbTimestamp;
        last_success_at: DbTimestamp;
        last_failure_at: DbTimestamp;
      }>(
        `SELECT
         count(*)::int AS total,
         count(*) FILTER (WHERE status = 'delivered')::int AS delivered,
         count(*) FILTER (WHERE status = 'failed')::int AS failed,
         count(*) FILTER (WHERE status = 'dead')::int AS dead,
         count(*) FILTER (WHERE status IN ('pending', 'processing'))::int AS pending,
         max(created_at) AS last_delivery_at,
         max(created_at) FILTER (WHERE status = 'delivered') AS last_success_at,
         max(created_at) FILTER (WHERE status IN ('failed', 'dead')) AS last_failure_at,
         (SELECT status FROM public.tenant_webhook_deliveries
           WHERE organisation_id = $1 AND subscription_id = $2
           ORDER BY created_at DESC LIMIT 1) AS last_status
       FROM public.tenant_webhook_deliveries
      WHERE organisation_id = $1 AND subscription_id = $2`,
        [organisationId, subscriptionId]
      )
    );
    const r = rows[0];
    const lastStatus = r?.last_status === "processing" ? "pending" : (r?.last_status ?? null);
    return {
      total: r?.total ?? 0,
      delivered: r?.delivered ?? 0,
      failed: r?.failed ?? 0,
      dead: r?.dead ?? 0,
      pending: r?.pending ?? 0,
      lastStatus: lastStatus as WebhookDeliveryStatus | null,
      lastDeliveryAt: iso(r?.last_delivery_at ?? null),
      lastSuccessAt: iso(r?.last_success_at ?? null),
      lastFailureAt: iso(r?.last_failure_at ?? null),
    };
  }

  async deadDeliveryCount(organisationId: string): Promise<number> {
    const { rows } = await this.execute(
      "deadDeliveryCount",
      this.pool.query<{ dead: number }>(
        `SELECT count(*)::int AS dead FROM public.tenant_webhook_deliveries
        WHERE organisation_id = $1 AND status = 'dead'`,
        [organisationId]
      )
    );
    return rows[0]?.dead ?? 0;
  }

  async redriveDeadDelivery(organisationId: string, deliveryId: string): Promise<boolean> {
    // Idempotent: only a row currently in `dead` is requeued (attempt reset, due now).
    const res = await this.execute(
      "redriveDeadDelivery",
      this.pool.query(
        `UPDATE public.tenant_webhook_deliveries
          SET status = 'pending', attempt = 0, error = NULL, next_attempt_at = now()
        WHERE organisation_id = $1 AND id = $2 AND status = 'dead'`,
        [organisationId, deliveryId]
      )
    );
    return (res.rowCount ?? 0) > 0;
  }

  async redriveDeadForSubscription(
    organisationId: string,
    subscriptionId: string
  ): Promise<number> {
    const res = await this.execute(
      "redriveDeadForSubscription",
      this.pool.query(
        `UPDATE public.tenant_webhook_deliveries
          SET status = 'pending', attempt = 0, error = NULL, next_attempt_at = now()
        WHERE organisation_id = $1 AND subscription_id = $2 AND status = 'dead'`,
        [organisationId, subscriptionId]
      )
    );
    return res.rowCount ?? 0;
  }

  async healthCheck(): Promise<{ status: "ready" | "degraded"; detail: string }> {
    try {
      await this.execute(
        "healthCheck",
        this.pool.query(
          `SELECT
             to_regclass('public.tenant_webhook_subscriptions') AS subscriptions_table,
             to_regclass('public.tenant_webhook_deliveries') AS deliveries_table`
        )
      );
      return { status: "ready", detail: "postgres-webhook-store:tables:ok" };
    } catch (err) {
      return {
        status: "degraded",
        detail: `postgres-webhook-store:${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
