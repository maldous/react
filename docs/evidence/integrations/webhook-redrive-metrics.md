# Webhook Dead-Letter Redrive + Per-Subscription Metrics — Evidence (ADR-ACT-0226)

Date: 2026-06-12. Owner: Architecture owner / technical lead.
AI assistance: Claude Opus 4.8 (implementation), human-reviewed.
Builds on ADR-0051 (webhooks plumbing) + ADR-0052 (durable delivery worker), which are
unchanged and still pass (`proof:webhooks`, `proof:webhook-worker`).

## Scope delivered

Operator-grade follow-up plumbing on top of the existing durable webhook worker:

- **Dead-letter redrive** — `POST /api/org/webhooks/:id/deliveries/:deliveryId/redrive`
  (single) and `POST /api/org/webhooks/:id/redrive-dead` (bulk for a subscription).
  Tenant-scoped (FQDN/session), `tenant.webhooks.write`, audit-first
  (`AuditAction.WebhookRedriven`, metadata = operation/scope/deliveryId only — never the
  secret). Requeues only `dead` rows → `pending` with `attempt` reset and `next_attempt_at
  = now()`; idempotent (a non-dead/unknown delivery requeues 0). The existing worker then
  delivers them on its next tick.
- **Per-subscription metrics** — `GET /api/org/webhooks/:id/metrics` →
  `{ total, delivered, failed, dead, pending, lastStatus, lastDeliveryAt, lastSuccessAt,
  lastFailureAt }`. Safe metadata only (counts + status/timestamps); NO payload body,
  headers, signing secret, or tenant data.
- **Readiness** — webhook readiness gains `has_dead_deliveries` (≥1 dead delivery awaiting
  redrive) + a `deadDeliveries` count. The capability is optional, so this maps to a
  cap-level `degraded` that does NOT block whole-tenant readiness.
- **Store** — `subscriptionMetrics`, `deadDeliveryCount`, `redriveDeadDelivery`,
  `redriveDeadForSubscription` on the Postgres webhook store (atomic, status-guarded).
- **UI** — `/admin/webhooks` shows per-subscription "Delivery health" (counts + last
  status/timestamps), a Redrive button on dead delivery rows, and a "Redrive all dead"
  action; all write controls are hidden in read-only mode; axe-clean.

## Decisions

- Redrive resets the attempt budget deterministically: `status='pending', attempt=0,
  error=NULL, next_attempt_at=now()` — the redriven delivery gets a fresh full retry
  cycle under the existing `WEBHOOK_RETRY_POLICY`.
- Idempotency: the SQL `WHERE … AND status='dead'` guard means redriving an
  already-requeued/delivered/unknown delivery is a safe no-op (`redriven: 0`).
- `has_dead_deliveries` is a distinct, honest readiness state (operator action needed),
  but optional → non-blocking overall (no ADR requires webhooks for tenant operation).
- `mapDomainRows`-style honesty: metrics are read-only aggregates; no fabricated values.

## Tests run (with proof layer)

- `node:test` (platform-api) — `webhooks.test.ts`: `classifyWebhookReadiness` incl.
  `has_dead_deliveries`; `getSubscriptionMetrics` (counts + last-status, null for unknown
  subscription, no payload/secret fields); `redriveDeadDeliveries` (single requeue
  audit-first + no secret in audit; idempotent 0 for non-dead; bulk requeues all dead;
  not_found for unknown subscription).
- `node:test` — `capability-registry.test.ts`: `has_dead_deliveries` → degraded,
  optional/non-blocking; `integrations_webhooks` stays `implemented`.
- Vitest (frontend) — `AdminWebhooksPage.test.tsx`: delivery-health metrics render,
  dead-delivery Redrive announces success, read-only exposes no redrive controls + axe.
- OpenAPI drift: 92 routes match (3 new paths).
- Full suites green: `test:platform-api`, `test:frontend:run` 169.

## Runtime proof (executed)

`apps/platform-api/scripts/webhook-redrive-runtime-proof.ts` (`npm run proof:webhook-redrive`).
Live Postgres + a local fail-then-recover receiver.

```bash
make compose-up-default
npm run proof:webhook-redrive
```

Executed output (dev profile, 2026-06-12):

```text
# Webhook dead-letter redrive + metrics runtime proof

PASS  delivery driven to dead — dead=1
PASS  metrics lastStatus reflects dead — lastStatus=dead
PASS  redrive requeued the dead delivery
PASS  after redrive: dead=0, pending=1 — dead=0 pending=1
PASS  redriven delivery now delivered — delivered=1 dead=0
PASS  metrics lastSuccessAt is set
PASS  metrics carry no secret

# ALL CHECKS PASSED
```

## Proven live vs unit/MSW only

- **Live-proven (Postgres + local receiver):** event fan-out → fail-to-dead → metrics
  show dead → redrive requeues → receiver recovers → worker delivers → metrics flip to
  delivered (dead=0); secret never present; temp org cleaned up.
- Unit-proven (`node:test`): metrics mapping, redrive idempotency + audit-no-secret,
  readiness `has_dead_deliveries`.
- MSW-proven (frontend): metrics panel, dead-row Redrive announce, read-only gating, axe.

## Known deferrals

- Scheduled/automatic redrive of dead deliveries (this is an explicit operator action).
- Redrive rate-limiting / max-redrive caps and a per-tenant dead-letter dashboard.
- Bulk redrive is per-subscription only (no cross-subscription tenant-wide bulk).

## No-secret guarantee

Redrive audit metadata is operation/scope/deliveryId only; metrics are counts +
status/timestamps. The signing secret, payload body, and headers are never returned,
logged, or audited — asserted in `webhooks.test.ts` and the runtime proof
("metrics carry no secret").

## No-fake-readiness guarantee

`has_dead_deliveries` requires a real dead-delivery count from the store; metrics are
real aggregates; redrive only acts on rows actually in `dead`. Asserted by
`webhooks.test.ts`, `capability-registry.test.ts`, and `proof:webhook-redrive`.

## ACTION-REGISTER linkage

ADR-ACT-0226 (Source ADR-0052). Evidence: this file. ADR-0051/0052 claims unchanged.
