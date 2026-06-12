import type { WebhookDeliveryStatus, WebhookEventType } from "@platform/contracts-admin";

// ---------------------------------------------------------------------------
// Webhook store port (ADR-0051 / ADR-ACT-0221)
//
// Tenant-scoped CRUD over webhook subscriptions + the delivery log. The signing
// secret is write-only at this boundary: `create`/`rotateSecret` accept a plaintext
// secret to encrypt-and-store; reads expose only `hasSecret`. `getSecret` is for
// server-side dispatch/signing ONLY and must never cross the HTTP boundary.
// ---------------------------------------------------------------------------

export interface WebhookSubscriptionRecord {
  id: string;
  url: string;
  enabled: boolean;
  eventTypes: WebhookEventType[];
  hasSecret: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface WebhookDeliveryRecord {
  id: string;
  event: WebhookEventType;
  status: WebhookDeliveryStatus;
  responseStatus: number | null;
  attempt: number;
  error: string | null;
  createdAt: string | null;
}

export interface CreateWebhookInput {
  organisationId: string;
  url: string;
  eventTypes: WebhookEventType[];
  enabled: boolean;
  /** Plaintext signing secret — encrypted at rest by the adapter; never returned. */
  secret: string;
}

export interface UpdateWebhookFields {
  url?: string;
  eventTypes?: WebhookEventType[];
  enabled?: boolean;
}

export interface RecordDeliveryInput {
  organisationId: string;
  subscriptionId: string;
  event: WebhookEventType;
  status: WebhookDeliveryStatus;
  responseStatus: number | null;
  attempt: number;
  error: string | null;
}

/** A delivery the worker has atomically claimed for an attempt (ADR-0052). */
export interface ClaimedDelivery {
  id: string;
  organisationId: string;
  subscriptionId: string;
  event: WebhookEventType;
  payload: string | null;
  attempt: number;
}

export interface DeliveryResult {
  status: WebhookDeliveryStatus | "processing";
  responseStatus: number | null;
  attempt: number;
  error: string | null;
  /** When the row is next due (retry); null for terminal results. */
  nextAttemptAt: Date | null;
}

export interface WebhookStore {
  list(organisationId: string): Promise<WebhookSubscriptionRecord[]>;
  get(organisationId: string, id: string): Promise<WebhookSubscriptionRecord | null>;
  create(input: CreateWebhookInput): Promise<WebhookSubscriptionRecord>;
  update(
    organisationId: string,
    id: string,
    fields: UpdateWebhookFields
  ): Promise<WebhookSubscriptionRecord | null>;
  delete(organisationId: string, id: string): Promise<boolean>;
  /** Replace the encrypted signing secret. Returns false when the id is unknown. */
  rotateSecret(organisationId: string, id: string, secret: string): Promise<boolean>;
  /** Decrypted secret for server-side signing ONLY. Null when unknown/undecryptable. */
  getSecret(organisationId: string, id: string): Promise<string | null>;
  recordDelivery(input: RecordDeliveryInput): Promise<void>;
  listDeliveries(
    organisationId: string,
    subscriptionId: string,
    limit: number
  ): Promise<WebhookDeliveryRecord[]>;
  counts(organisationId: string): Promise<{ total: number; enabled: number }>;

  // --- durable delivery queue (ADR-0052) ---
  /** Enqueue a pending delivery (due now) for the background worker. */
  enqueueDelivery(input: {
    organisationId: string;
    subscriptionId: string;
    event: WebhookEventType;
    payload: string;
  }): Promise<void>;
  /** Atomically claim up to `limit` due deliveries (pending/processing, due ≤ now). */
  claimDueDeliveries(limit: number, now: Date): Promise<ClaimedDelivery[]>;
  /** Record the outcome of a claimed delivery attempt (retry/terminal). */
  markDeliveryResult(id: string, result: DeliveryResult): Promise<void>;

  // --- metrics + dead-letter redrive (ADR-ACT-0226) ---
  /** Per-subscription delivery health (safe metadata only). */
  subscriptionMetrics(organisationId: string, subscriptionId: string): Promise<DeliveryMetrics>;
  /** Count of dead deliveries across the tenant (for readiness). */
  deadDeliveryCount(organisationId: string): Promise<number>;
  /** Requeue a single DEAD delivery as pending (attempt reset, due now). Returns true
   * when a dead row was requeued (idempotent: a non-dead/unknown id → false). */
  redriveDeadDelivery(organisationId: string, deliveryId: string): Promise<boolean>;
  /** Requeue ALL dead deliveries for a subscription. Returns the count requeued. */
  redriveDeadForSubscription(organisationId: string, subscriptionId: string): Promise<number>;
}

export interface DeliveryMetrics {
  total: number;
  delivered: number;
  failed: number;
  dead: number;
  pending: number;
  lastStatus: WebhookDeliveryStatus | null;
  lastDeliveryAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
}
