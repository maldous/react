# Phase 5 — event bus + durable workers + DLQ/redrive (delivery evidence)

- **Action:** ADR-ACT-0259 — governing ADR: ADR-0059 (workflow/event/queue, **Accepted** for the event-bus + durable-worker + DLQ/redrive foundation; workflow engine, scheduled jobs, and a composed Redis/NATS bus remain **Proposed** sub-decisions; notifications split to ADR-0068).
- **Date:** 2026-06-13
- **Status of this document:** delivery evidence. The Universal Service Foundation is **not** complete. Phase 5 is the internal event substrate only; no workflow engine and no composed bus are delivered.

## Proof classification

**Live-proven** against the local Compose Postgres (real RLS) — proofs run repos as the non-superuser `platform_app` role, create + clean up their own test orgs, and SKIP honestly (exit 0) if Postgres is unavailable:

- `proof:event-bus` — publish persists; **idempotent publish** dedups on (org, type, key); tenant id preserved; **secret-bearing payload rejected** at publish; **RLS** hides a tenant's events from a foreign tenant context; no secret-bearing columns.
- `proof:event-worker` — worker **claims + processes** a pending event (→ processed); a **processed event is never re-claimed** (idempotent processing); a failing handler **retries then dead-letters at max_attempts**; the dead letter is in the DLQ; the worker **heartbeat** is recorded + visible with a liveness status.
- `proof:event-redrive` — invokes the **real route handlers**: dead-letter route lists the dead letter; operator **redrive** requeues it; the requeued event is processed on the next worker tick; events route requires `organisationId`; invalid id rejected; workers route returns 200; access-control metadata asserted.

In-memory `node:test` suite (`events`, 8 cases) covers publish idempotency, secret rejection, claim/process, retry→DLQ, unknown-type-not-dropped, redrive, tenant preservation, heartbeat.

## Delivered

1. **Event model** — `platform_events` (migration 027): tenant-scoped, **RLS enabled + forced** (canonical predicate), `status`/`attempts`/`max_attempts`/`available_at`, **idempotent** `UNIQUE (organisation_id, event_type, idempotency_key)`; `event_dead_letters` (RLS); `worker_heartbeats` (global infra, no tenant column).
2. **Ports** — `EventBusPort` (publish/claimBatch/markProcessed/recordFailure/listEvents/listDeadLetters/redrive) + `WorkerRegistryPort` (heartbeat/listWorkers).
3. **Adapters** — `PostgresEventBus` (idempotent `ON CONFLICT DO NOTHING` publish; claim via **`FOR UPDATE SKIP LOCKED`**; `recordFailure` increments attempts → dead-letters at `max_attempts`; `redrive` re-enqueues with a redrive-suffixed key) + `PostgresWorkerRegistry` (heartbeat upsert).
4. **Events usecase** — `publishEvent` (rejects secret payloads), `processNext` (claim → dispatch → ack/retry/dead-letter; unknown type ⇒ failure, never silently dropped; idempotent), `getEvents`, `getDeadLetters`, `redriveEvent` (operator-only, **audit-before-change** `event.redriven`), `listWorkers` (derived liveness), `recordHeartbeat`.
5. **Routes** (+ OpenAPI): `GET /api/admin/events`, `GET /api/admin/events/dead-letter`, `POST /api/admin/events/:eventId/redrive`, `GET /api/admin/workers` (operator-only).
6. **Permissions** — `platform.events.read|write` + `platform.workers.read` (operator-only) in `domain-identity`.
7. **UI** — `/admin/events`: worker-runtime table + per-tenant events/dead-letter tables + redrive. Operator-only. React renders BFF state only.
8. **Contracts** — event/dead-letter/worker schemas in `@platform/contracts-admin`; `event` audit resource + `event.redriven` action.

## Enforced invariants (proven)

Durable, transactional, tenant-isolated (RLS) events; idempotent publish + idempotent processing (processed events never re-claimed); secret payloads rejected; handler failure retries then dead-letters at max_attempts; redrive requeues + is audited; unknown event types are not silently dropped; worker heartbeats persisted + surfaced; admin surfaces operator-global; no secret columns; Sentry Kafka / LocalStack are not the bus.

## Still NOT delivered (explicitly)

- **Composed event bus** (Redis Streams / NATS / Redpanda) — Phase 5.5, behind `EventBusPort` (high throughput / low latency).
- **Workflow engine** (Windmill / Temporal) + **scheduled jobs** — Phase 5.5+, **gated on this proven substrate** (no durable long-running orchestration yet).
- **Retry backoff schedule** — retry is currently immediate (no exponential delay); a backoff schedule is a Phase-5.x refinement.
- **Notifications** — split to ADR-0068 (Phase 6).

## Governance

- ADR-0059 **hardened to decision quality + Accepted** (Phase-5 event substrate) on Matt's authority; workflow engine + composed bus kept Proposed; notifications split to ADR-0068. CODEMAPS updated (ADR-0059 → Accepted).
- Registry: `event-bus-queues-dlq` + `background-workers-runtime` → **locally proven** (decision **build**). `delivery` gains a `phase-5` gate (requires ADR-0059 ready). Validator + matrix re-rendered.

## Commands run (green)

`npm run usf:validate`, `lint:md`, `test:architecture`, `tsc:check`, `openapi:drift`, `frontend:conventions`, `semgrep:gate`, `test:platform-api`, `test:frontend:run`, all prior proofs, `proof:event-bus` (live), `proof:event-worker` (live), `proof:event-redrive` (live), `audit:osv`, `audit:deps`, `make check`.
