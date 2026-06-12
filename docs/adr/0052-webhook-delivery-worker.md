# ADR-0052: Webhook Durable Delivery Worker + Event Fan-out

## Status

Accepted

## Date

2026-06-12

## Decision owner

Architecture owner / technical lead

## Consulted

ADR-0040 (audit trail), ADR-0045 (capability map), ADR-0051 (webhooks plumbing — this
completes its deferred async-retry follow-up). Claude Opus 4.8 (implementation
assistance, human-reviewed).

## Context

ADR-0051 shipped webhook subscriptions, a reveal-once HMAC signing secret, an immediate
single-attempt test dispatch, and a delivery log — but the capability was honestly
**partial**: there was no durable delivery (real platform events did not fan out to
subscriptions, and a failed delivery was never retried). This ADR closes that gap.

Constraints and risks:

- platform-api is request/response; a retry worker needs a background loop that does not
  leak into tests or block request handlers.
- Long backoffs (minutes) mean retries cannot be inline in a request — they must be queued.
- A crashed worker tick must not lose or double-deliver a delivery.
- Signing must happen per attempt; the secret must never be logged.

## Decision drivers

- Honesty: move `integrations_webhooks` `partial` → `implemented` only once delivery is
  durable end-to-end and a retried delivery is proven.
- Reuse the ADR-0051 store + signing + dispatch port.
- Bounded, crash-tolerant, single-instance-safe (and multi-instance-safe) claiming.

## Options considered

### Option A: DB-backed delivery queue + a polling background worker (chosen)

Extend `tenant_webhook_deliveries` (migration 020) with `next_attempt_at` + `payload`.
`emitWebhookEvent` enqueues a `pending` delivery per enabled+subscribed subscription. A
background worker (`processDueDeliveries`), scheduled by a `setInterval` started only in
the server bootstrap, atomically claims due rows (`UPDATE … WHERE id IN (SELECT … FOR
UPDATE SKIP LOCKED) RETURNING`, flipping to a transient `processing`), dispatches a freshly
signed payload, and on failure reschedules with backoff (`WEBHOOK_RETRY_POLICY`) until
`maxAttempts`, then dead-letters (`dead`). The `org.config.set` route fans out
`tenant.config.changed` as the first real event source (best-effort).

Pros: no new infra (reuses Postgres); crash-tolerant (a stuck `processing` row whose
`next_attempt_at` is in the past is re-claimed); multi-instance-safe (SKIP LOCKED). Cons:
polling latency (interval-bounded). Risks: outbound HTTP (already bounded by the ADR-0051
dispatcher timeout).

### Option B: External queue/broker (Redis/SQS) + worker

Pros: scalable. Cons: new infra dependency + operational surface; rejected for this pass.

### Option C: Inline retry in the request handler

Pros: trivial. Cons: long backoffs cannot be inline; rejected (a token short-wait retry
would be dishonest about durability).

## Decision

Adopt **Option A**. The immediate `POST .../test` path is unchanged (a synchronous probe
that records one terminal row). Real events are durable: `emitWebhookEvent` enqueues; the
worker delivers with backoff + dead-letter. The delivery-status vocabulary gains `dead`.
The worker is best-effort (a bad tick is logged, never thrown) and disabled with
`WEBHOOK_WORKER_DISABLED=true`. The capability map promotes `integrations_webhooks`
`partial` → **implemented**.

## Rationale

The delivery row id is the stable event id (a receiver idempotency key); each attempt is
re-signed with a fresh timestamp over the body. Atomic claim-to-`processing` with
`FOR UPDATE SKIP LOCKED` and `next_attempt_at`-based re-claim gives at-least-once delivery
that survives a crashed tick without double-processing a live one. Backoff + a bounded
`maxAttempts` with a terminal `dead` state make exhaustion explicit, not silent.

## Consequences

Positive: real, durable, retried, dead-lettered webhook delivery; honest `implemented`
status. Negative: interval-bounded delivery latency; a background loop in the server
process. Neutral: a `proof:webhook-worker` script proves retry-then-deliver and
dead-letter against live Postgres with a fail-then-succeed receiver.

## AI-assistance record

AI used: Yes. Tool/model: Claude Opus 4.8 (1M context), Claude Code. Scope: implementation,
tests, runtime proof, this ADR. Human review: required before merge.

## Validation / evidence

Evidence level: High. Evidence: `docs/evidence/integrations/webhook-delivery-worker.md`.

## Impacted areas

- Architecture: new worker use case + scheduler runtime; extended webhook store port +
  adapter; `org.config.set` route fans out an event.
- Data: migration 020 (`next_attempt_at` + `payload` on `tenant_webhook_deliveries`).
- API: no new routes (background worker + internal fan-out).
- Security: per-attempt HMAC signing; secret never logged; best-effort fan-out never
  blocks the core mutation.
- Testing: backend unit (worker retry/dead-letter/fan-out/signing) + runtime proof.
- UX: the existing `/admin/webhooks` deliveries view now shows worker outcomes incl. `dead`.
- Documentation: capability map, i18n (`dead` label), CODEMAPS, ACTION-REGISTER.

## Follow-up actions

Tracked in:

```text
docs/adr/ACTION-REGISTER.md
```

ADR-ACT-0222 covers this slice. Future actions: more first-class event sources
(`tenant.member.invited` etc.), a dead-letter replay action, and per-subscription
delivery metrics.

## Review date

2026-12-12

## Supersedes

None.

## Superseded by

None.

## References

- ADR-0051 integrations / webhooks plumbing (this completes its async-retry follow-up)
- ADR-0040 administrative audit trail
- ADR-0045 enterprise capability map

## Notes

Delivery statuses: `pending` → `processing` (transient, surfaced as `pending`) →
`delivered` | (retry → `pending`) | `dead`. Backoff via `WEBHOOK_RETRY_POLICY`
(`maxAttempts` = 5, `backoffSeconds` = [0, 30, 120, 600, 3600]); the worker interval is
`WEBHOOK_WORKER_INTERVAL_MS` (default 5000). The immediate test-dispatch path (ADR-0051)
is unchanged.
