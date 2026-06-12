import crypto from "node:crypto";
import type { WebhookEventType } from "@platform/contracts-admin";
import type { WebhookStore } from "../ports/webhook-store.ts";
import {
  WEBHOOK_RETRY_POLICY,
  webhookSignatureHeader,
  type WebhookDispatchPort,
} from "./webhooks.ts";

// ---------------------------------------------------------------------------
// Webhook durable delivery worker (ADR-0052 / ADR-ACT-0222)
//
// A background tick that claims due deliveries, dispatches a signed payload, and on
// failure reschedules with backoff until `maxAttempts`, then dead-letters. Pure of
// time/IO except the injected store + dispatch + `now`, so it is deterministically
// unit-tested. The signing secret is read server-side only and never logged.
// ---------------------------------------------------------------------------

export interface WorkerDeps {
  store: WebhookStore;
  dispatch: WebhookDispatchPort;
}

export interface WorkerOptions {
  now?: Date;
  batch?: number;
  maxAttempts?: number;
  /** Backoff seconds indexed by attempt count (clamped to the last entry). */
  backoffSeconds?: readonly number[];
}

export interface WorkerTickSummary {
  claimed: number;
  delivered: number;
  retried: number;
  dead: number;
}

function backoffFor(attempt: number, schedule: readonly number[]): number {
  if (schedule.length === 0) return 0;
  return schedule[Math.min(attempt, schedule.length - 1)] ?? 0;
}

/** Process one batch of due deliveries. Returns a summary; never throws per-row. */
export async function processDueDeliveries(
  deps: WorkerDeps,
  opts: WorkerOptions = {}
): Promise<WorkerTickSummary> {
  const now = opts.now ?? new Date();
  const batch = opts.batch ?? 20;
  const maxAttempts = opts.maxAttempts ?? WEBHOOK_RETRY_POLICY.maxAttempts;
  const backoff = opts.backoffSeconds ?? WEBHOOK_RETRY_POLICY.backoffSeconds;

  const claimed = await deps.store.claimDueDeliveries(batch, now);
  const summary: WorkerTickSummary = { claimed: claimed.length, delivered: 0, retried: 0, dead: 0 };

  for (const d of claimed) {
    const attempt = d.attempt + 1;
    const sub = await deps.store.get(d.organisationId, d.subscriptionId);

    // A deleted or disabled subscription cannot be delivered — dead-letter it.
    if (!sub || !sub.enabled) {
      await deps.store.markDeliveryResult(d.id, {
        status: "dead",
        responseStatus: null,
        attempt,
        error: sub ? "subscription disabled" : "subscription deleted",
        nextAttemptAt: null,
      });
      summary.dead += 1;
      continue;
    }

    const secret = await deps.store.getSecret(d.organisationId, d.subscriptionId);
    const timestamp = now.getTime();
    let data: unknown = {};
    try {
      data = d.payload ? JSON.parse(d.payload) : {};
    } catch {
      data = {};
    }
    // The delivery row id is the stable event id (idempotency key for receivers).
    const body = JSON.stringify({ id: d.id, event: d.event, timestamp, data });
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-platform-event": d.event,
      ...(secret
        ? { "x-platform-signature": webhookSignatureHeader(secret, timestamp, body) }
        : {}),
    };

    let ok = false;
    let responseStatus: number | null = null;
    let error: string | null = null;
    try {
      const res = await deps.dispatch.dispatch({ url: sub.url, headers, body });
      ok = res.ok;
      responseStatus = res.status;
      error = res.error;
    } catch (err) {
      error = err instanceof Error ? err.message : "dispatch failed";
    }

    if (ok) {
      await deps.store.markDeliveryResult(d.id, {
        status: "delivered",
        responseStatus,
        attempt,
        error: null,
        nextAttemptAt: null,
      });
      summary.delivered += 1;
    } else if (attempt < maxAttempts) {
      const nextAttemptAt = new Date(now.getTime() + backoffFor(attempt, backoff) * 1000);
      await deps.store.markDeliveryResult(d.id, {
        status: "pending",
        responseStatus,
        attempt,
        error,
        nextAttemptAt,
      });
      summary.retried += 1;
    } else {
      await deps.store.markDeliveryResult(d.id, {
        status: "dead",
        responseStatus,
        attempt,
        error,
        nextAttemptAt: null,
      });
      summary.dead += 1;
    }
  }

  return summary;
}

/**
 * Fan out a platform event to every enabled subscription subscribed to it, enqueueing
 * a durable delivery for the worker. Returns the number of deliveries enqueued.
 */
export async function emitWebhookEvent(
  organisationId: string,
  event: WebhookEventType,
  data: unknown,
  store: WebhookStore
): Promise<number> {
  const subs = (await store.list(organisationId)).filter(
    (s) => s.enabled && s.eventTypes.includes(event)
  );
  const payload = JSON.stringify(data ?? {});
  for (const sub of subs) {
    await store.enqueueDelivery({ organisationId, subscriptionId: sub.id, event, payload });
  }
  return subs.length;
}

/** A stable event id for callers that want to log the correlation (unused internally). */
export const newEventId = (): string => crypto.randomUUID();
