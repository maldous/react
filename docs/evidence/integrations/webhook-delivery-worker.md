# Webhook Durable Delivery Worker — Evidence (ADR-0052 / ADR-ACT-0222)

Date: 2026-06-12. Owner: Architecture owner / technical lead.
AI assistance: Claude Opus 4.8 (implementation), human-reviewed.

## Scope delivered

Completes the ADR-0051 deferred async-retry follow-up — webhook delivery is now durable:

- **Data**: migration 020 adds `next_attempt_at` + `payload` to
  `tenant_webhook_deliveries` (+ a partial due-index on `status IN (pending,processing)`).
- **Store port + adapter**: `enqueueDelivery`, `claimDueDeliveries` (atomic
  `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED) RETURNING`, flipping to a
  transient `processing`), `markDeliveryResult`. `listDeliveries` surfaces `processing`
  as `pending`.
- **Worker** (`usecases/webhook-worker.ts`): `processDueDeliveries` claims due rows,
  re-signs per attempt, dispatches, and on failure reschedules with `WEBHOOK_RETRY_POLICY`
  backoff until `maxAttempts`, then dead-letters (`dead`); `emitWebhookEvent` fans an event
  out to enabled+subscribed subscriptions as pending deliveries.
- **Scheduler** (`server/webhook-worker-runtime.ts`): a `setInterval` started ONLY from the
  server bootstrap (`http.ts`), best-effort (a bad tick is logged, never thrown),
  non-overlapping, `unref`'d, and disabled with `WEBHOOK_WORKER_DISABLED=true`.
- **Event source**: `org.config.set` fans out `tenant.config.changed` (best-effort — never
  blocks the config mutation).
- **Contract**: delivery-status vocabulary gains `dead`; i18n label added.

## Decisions

- The immediate `POST .../test` path (ADR-0051) is unchanged — a synchronous probe that
  records one terminal row. Real events go through the durable enqueue → worker path.
- The delivery row id is the stable event id (receiver idempotency key); each attempt is
  re-signed with a fresh timestamp.
- Atomic claim-to-`processing` + `next_attempt_at`-based re-claim → at-least-once delivery
  that survives a crashed tick without double-delivering a live one (SKIP LOCKED →
  multi-instance-safe).
- A disabled/deleted subscription's queued delivery is dead-lettered (never delivered).
- Capability `integrations_webhooks` promoted `partial` → **implemented**.

## Tests run (with proof layer)

- `node:test` (platform-api) — `webhook-worker.test.ts`: `emitWebhookEvent` fans out only
  to enabled+subscribed subs; `processDueDeliveries` delivers on success; retries on
  failure with backoff then delivers on a later tick (attempt 2); dead-letters after
  `maxAttempts`; dead-letters a disabled/deleted subscription; does not claim not-yet-due
  rows; signs each attempt over `<timestamp>.<body>` with the subscription secret + uses
  the delivery id as the stable event id.
- `node:test` — `capability-registry.test.ts`: `integrations_webhooks` is now
  `implemented`; readiness still honest + optional.
- OpenAPI drift: unchanged at 89 routes (no new routes — background worker + internal
  fan-out).
- Full suites green: `test:platform-api` 514, `test:frontend:run` 165.

## Runtime proof (executed)

`apps/platform-api/scripts/webhook-worker-runtime-proof.ts` (`npm run proof:webhook-worker`).
Drives real worker ticks against live Postgres with a fail-then-succeed receiver and an
always-fail receiver.

```bash
make compose-up-default
npm run db:migrate
npm run proof:webhook-worker
```

Executed output (local Postgres + local receivers, dev profile, 2026-06-12):

```text
# Webhook durable delivery worker runtime proof

PASS  event fan-out enqueued one delivery
PASS  tick 1 retries the failing delivery — {"claimed":1,"delivered":0,"retried":1,"dead":0}
PASS  tick 2 delivers after the receiver recovers — {"claimed":1,"delivered":1,"retried":0,"dead":0}
PASS  receiver saw exactly 2 attempts — hits=2
PASS  always-failing delivery is dead-lettered after maxAttempts
PASS  cleanup removed the temp webhooks

# ALL CHECKS PASSED
```

## Proven live vs unit/MSW only

- Live-proven (against Postgres + local receivers): event fan-out → enqueue → worker tick
  retry → delivery after recovery (receiver saw 2 attempts) → dead-letter on persistent
  failure → cleanup.
- Unit-proven (`node:test`): the claim/dispatch/retry/dead-letter/fan-out/signing logic
  with a fake store + dispatch + injected time.
- NOT proven here: long real-world backoff timing (the policy is honoured but the proof
  uses zero backoff for determinism), and a dead-letter replay action (future follow-up).

## Capability map changes

`integrations_webhooks`: **partial → implemented** (durable delivery worker + real event
fan-out). Readiness signal unchanged (`webhooksReadiness` count-based; optional, non-blocking).

## Known deferrals

- Additional first-class event sources beyond `tenant.config.changed` + `platform.test`.
- A dead-letter replay/redrive action and per-subscription delivery metrics.

## No-secret guarantee

Each attempt is signed server-side; the secret is read only for signing and never logged,
returned, or placed in the payload body (asserted in `webhook-worker.test.ts` + the proof).

## No-fake-readiness guarantee

`implemented` is claimed only because durable delivery is real and a retried delivery +
dead-letter are live-proven. Asserted by `webhook-worker.test.ts` and the runtime proof.

## ACTION-REGISTER linkage

ADR-ACT-0222 (Source ADR-0052). Evidence: this file.
