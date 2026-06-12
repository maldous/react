import crypto from "node:crypto";
import { AuditAction, createAuditEvent, type AuditEventPort } from "@platform/audit-events";
import type {
  CreateWebhookSubscriptionRequest,
  CreateWebhookSubscriptionResponse,
  UpdateWebhookSubscriptionRequest,
  WebhookDeliveryStatus,
  WebhookReadinessResponse,
  WebhookSubscriptionSummary,
  WebhookTestResult,
} from "@platform/contracts-admin";
import type { WebhookStore, WebhookSubscriptionRecord } from "../ports/webhook-store.ts";

// ---------------------------------------------------------------------------
// Webhooks orchestration (ADR-0051 / ADR-ACT-0221)
//
// Pure HMAC signing + tenant-scoped subscription lifecycle. The signing secret is
// generated server-side, stored encrypted, and revealed ONCE (create + rotate).
// Mutations are audit-first with safe metadata only (url + event types — never the
// secret, never the payload). A test dispatch is a single immediate attempt recorded
// in the delivery log; the async retry worker is documented config only (deferred).
// ---------------------------------------------------------------------------

/** Documented retry policy (config only — no background worker this pass). */
export const WEBHOOK_RETRY_POLICY = {
  maxAttempts: 5,
  backoffSeconds: [0, 30, 120, 600, 3600],
  timeoutMs: 5000,
} as const;

/** HMAC-SHA-256 over `<timestamp>.<body>` (hex). */
export function signWebhookBody(secret: string, timestamp: number, body: string): string {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/** `X-Platform-Signature` header value with a timestamp for replay protection. */
export function webhookSignatureHeader(secret: string, timestamp: number, body: string): string {
  return `t=${timestamp},v1=${signWebhookBody(secret, timestamp, body)}`;
}

const defaultGenSecret = (): string => `whsec_${crypto.randomBytes(32).toString("hex")}`;

export interface WebhookDispatchRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}
export interface WebhookDispatchResult {
  ok: boolean;
  status: number | null;
  error: string | null;
}
export interface WebhookDispatchPort {
  dispatch(req: WebhookDispatchRequest): Promise<WebhookDispatchResult>;
}

export interface WebhookActor {
  actorId: string;
  actorRoles: string[];
  sourceHost?: string | undefined;
}
export interface WebhookDeps {
  store: WebhookStore;
  audit: AuditEventPort;
}

function toSummary(r: WebhookSubscriptionRecord): WebhookSubscriptionSummary {
  return {
    id: r.id,
    url: r.url,
    enabled: r.enabled,
    eventTypes: r.eventTypes,
    hasSecret: r.hasSecret,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

async function audit(
  deps: WebhookDeps,
  organisationId: string,
  actor: WebhookActor,
  action: string,
  resourceId: string,
  metadata: Record<string, unknown>
): Promise<void> {
  await deps.audit.emit(
    createAuditEvent({
      actorId: actor.actorId,
      actorRoles: actor.actorRoles,
      tenantId: organisationId,
      action,
      resource: "webhook",
      resourceId,
      metadata,
      sourceHost: actor.sourceHost,
    })
  );
}

export async function listWebhooks(
  organisationId: string,
  store: WebhookStore
): Promise<WebhookSubscriptionSummary[]> {
  return (await store.list(organisationId)).map(toSummary);
}

export async function createWebhook(
  input: { organisationId: string; data: CreateWebhookSubscriptionRequest; actor: WebhookActor },
  deps: WebhookDeps & { genSecret?: () => string }
): Promise<CreateWebhookSubscriptionResponse> {
  const secret = (deps.genSecret ?? defaultGenSecret)();
  const enabled = input.data.enabled ?? true;
  // Audit-first (intent): url + event types only — never the secret.
  await audit(deps, input.organisationId, input.actor, AuditAction.WebhookCreated, input.data.url, {
    operation: "create",
    url: input.data.url,
    eventTypes: input.data.eventTypes,
    enabled,
  });
  const rec = await deps.store.create({
    organisationId: input.organisationId,
    url: input.data.url,
    eventTypes: input.data.eventTypes,
    enabled,
    secret,
  });
  return { subscription: toSummary(rec), secret };
}

export type WebhookMutationResult =
  | { kind: "ok"; subscription: WebhookSubscriptionSummary }
  | { kind: "not_found" };

export async function updateWebhook(
  input: {
    organisationId: string;
    id: string;
    data: UpdateWebhookSubscriptionRequest;
    actor: WebhookActor;
  },
  deps: WebhookDeps
): Promise<WebhookMutationResult> {
  await audit(deps, input.organisationId, input.actor, AuditAction.WebhookUpdated, input.id, {
    operation: "update",
    ...(input.data.url ? { url: input.data.url } : {}),
    ...(input.data.eventTypes ? { eventTypes: input.data.eventTypes } : {}),
    ...(input.data.enabled !== undefined ? { enabled: input.data.enabled } : {}),
  });
  const rec = await deps.store.update(input.organisationId, input.id, input.data);
  return rec ? { kind: "ok", subscription: toSummary(rec) } : { kind: "not_found" };
}

export async function deleteWebhook(
  input: { organisationId: string; id: string; actor: WebhookActor },
  deps: WebhookDeps
): Promise<{ kind: "ok" } | { kind: "not_found" }> {
  await audit(deps, input.organisationId, input.actor, AuditAction.WebhookDeleted, input.id, {
    operation: "delete",
  });
  return (await deps.store.delete(input.organisationId, input.id))
    ? { kind: "ok" }
    : { kind: "not_found" };
}

export async function rotateWebhookSecret(
  input: { organisationId: string; id: string; actor: WebhookActor },
  deps: WebhookDeps & { genSecret?: () => string }
): Promise<{ kind: "ok"; secret: string } | { kind: "not_found" }> {
  const secret = (deps.genSecret ?? defaultGenSecret)();
  await audit(deps, input.organisationId, input.actor, AuditAction.WebhookSecretRotated, input.id, {
    operation: "rotate-secret", // never the secret itself
  });
  const ok = await deps.store.rotateSecret(input.organisationId, input.id, secret);
  return ok ? { kind: "ok", secret } : { kind: "not_found" };
}

export async function listWebhookDeliveries(
  organisationId: string,
  id: string,
  store: WebhookStore
): Promise<
  | { kind: "ok"; deliveries: import("../ports/webhook-store.ts").WebhookDeliveryRecord[] }
  | {
      kind: "not_found";
    }
> {
  const sub = await store.get(organisationId, id);
  if (!sub) return { kind: "not_found" };
  return { kind: "ok", deliveries: await store.listDeliveries(organisationId, id, 50) };
}

export async function testWebhook(
  input: { organisationId: string; id: string; actor: WebhookActor; now?: number },
  deps: WebhookDeps & { dispatch: WebhookDispatchPort }
): Promise<{ kind: "ok"; result: WebhookTestResult } | { kind: "not_found" }> {
  const sub = await deps.store.get(input.organisationId, input.id);
  if (!sub) return { kind: "not_found" };

  const secret = await deps.store.getSecret(input.organisationId, input.id);
  const timestamp = input.now ?? Date.now();
  const payload = { id: crypto.randomUUID(), event: "platform.test", timestamp, data: {} };
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-platform-event": "platform.test",
    ...(secret ? { "x-platform-signature": webhookSignatureHeader(secret, timestamp, body) } : {}),
  };

  let res: WebhookDispatchResult;
  try {
    res = await deps.dispatch.dispatch({ url: sub.url, headers, body });
  } catch (err) {
    res = {
      ok: false,
      status: null,
      error: err instanceof Error ? err.message : "dispatch failed",
    };
  }
  const status: WebhookDeliveryStatus = res.ok ? "delivered" : "failed";

  await audit(deps, input.organisationId, input.actor, AuditAction.WebhookTested, input.id, {
    operation: "test",
    event: "platform.test",
    status,
    responseStatus: res.status,
  });
  await deps.store.recordDelivery({
    organisationId: input.organisationId,
    subscriptionId: input.id,
    event: "platform.test",
    status,
    responseStatus: res.status,
    attempt: 1,
    error: res.error,
  });

  return { kind: "ok", result: { status, responseStatus: res.status } };
}

/** Pure: classify subscription + dead-delivery counts → readiness (ADR-ACT-0226). */
export function classifyWebhookReadiness(counts: {
  total: number;
  enabled: number;
  dead: number;
}): WebhookReadinessResponse["status"] {
  if (counts.total === 0) return "no_subscriptions";
  if (counts.dead > 0) return "has_dead_deliveries";
  return counts.enabled > 0 ? "configured" : "no_subscriptions";
}

export async function getWebhookReadiness(
  organisationId: string,
  store: WebhookStore
): Promise<WebhookReadinessResponse> {
  try {
    const counts = await store.counts(organisationId);
    const dead = await store.deadDeliveryCount(organisationId);
    return {
      status: classifyWebhookReadiness({ ...counts, dead }),
      total: counts.total,
      enabled: counts.enabled,
      deadDeliveries: dead,
    };
  } catch {
    return { status: "degraded", total: 0, enabled: 0, deadDeliveries: 0 };
  }
}

/** `GET /api/org/webhooks/:id/metrics` — null when the subscription is unknown. */
export async function getSubscriptionMetrics(
  organisationId: string,
  subscriptionId: string,
  store: WebhookStore
): Promise<import("@platform/contracts-admin").WebhookSubscriptionMetrics | null> {
  const sub = await store.get(organisationId, subscriptionId);
  if (!sub) return null;
  const m = await store.subscriptionMetrics(organisationId, subscriptionId);
  return { subscriptionId, ...m };
}

/**
 * Redrive dead deliveries (ADR-ACT-0226). Audit-first; requeues only `dead` rows as
 * pending (attempt reset, due now) — idempotent (a non-dead/unknown delivery → 0). When
 * `deliveryId` is given, redrives that one; otherwise all dead for the subscription.
 */
export async function redriveDeadDeliveries(
  input: {
    organisationId: string;
    subscriptionId: string;
    deliveryId?: string;
    actor: WebhookActor;
  },
  deps: WebhookDeps
): Promise<{ kind: "ok"; redriven: number } | { kind: "not_found" }> {
  const sub = await deps.store.get(input.organisationId, input.subscriptionId);
  if (!sub) return { kind: "not_found" };
  await audit(
    deps,
    input.organisationId,
    input.actor,
    AuditAction.WebhookRedriven,
    input.subscriptionId,
    {
      operation: "redrive",
      scope: input.deliveryId ? "single" : "subscription",
      ...(input.deliveryId ? { deliveryId: input.deliveryId } : {}),
    }
  );
  const redriven = input.deliveryId
    ? (await deps.store.redriveDeadDelivery(input.organisationId, input.deliveryId))
      ? 1
      : 0
    : await deps.store.redriveDeadForSubscription(input.organisationId, input.subscriptionId);
  return { kind: "ok", redriven };
}
