# ADR-0059: Workflow, event, and queue architecture

## Status

Accepted (2026-06-13, ADR-ACT-0259 — Phase 5 event bus + durable workers + DLQ/redrive; accepted on Matt's authority per the directive). The **workflow engine** (Windmill/Temporal), **scheduled jobs**, and a **composed Redis/NATS event bus** remain **Proposed** sub-decisions within this ADR (not delivered). Multi-channel **notifications** are split out to a dedicated Phase-6 ADR.

## Date

2026-06-13

## Decision owner

Architecture owner / technical lead

## Consulted

Engineering; operations; AI assistant (drafting, human review required).

## Context

The repo has a proven outbound webhook substrate (durable delivery worker, dead-letter, redrive, per-subscription metrics; ADR-0051/0052) and port-only scaffolds for `queue-runtime`, `worker-runtime`, and `notification-runtime`. There was no general internal event bus, durable worker runtime, DLQ/redrive for internal events, workflow engine, or scheduler. Sentry's Kafka is Sentry-only and must not be treated as the platform bus. Phase 5 delivers the **internal event substrate** — the foundation the workflow engine and multi-channel notifications depend on.

## Decision (Phase 5 — accepted)

1. **Internal event bus (build, local-first):** a **Postgres outbox** (`platform_events`, migration 027) behind an `EventBusPort`: tenant-scoped (RLS), **idempotent by (org, event_type, idempotency_key)**, transactional, durable. Publishing + worker ticks are server-internal (not exposed on HTTP). No secret payload fields (rejected at publish).
2. **Durable worker runtime (build):** the worker claims due pending events with `FOR UPDATE SKIP LOCKED`, dispatches to a registered handler, and **marks processed** (a processed event is never re-claimed — idempotent processing), or **records a failure** (retry, then **dead-letter at max_attempts**). A `WorkerRegistryPort` persists worker **heartbeats** with a derived liveness status.
3. **DLQ + redrive (build):** failed events land in `event_dead_letters`; operators **redrive** (re-enqueue as a fresh pending event), audited (`event.redriven`). Operator read surfaces for events, dead letters, and workers.
4. **Server-authoritative + operator-only surfaces:** the event/DLQ/worker routes are operator-only (`platform.events.read/write`, `platform.workers.read`); tenants never see the bus directly.

## Decision (Proposed sub-decisions — NOT delivered)

1. **Composed event bus (Phase 5.5, build/compose, deferred):** generalise onto **Redis Streams** (already composed) or NATS/Redpanda only if throughput demands prove it — behind the same `EventBusPort`. Sentry's Kafka is never the platform bus; LocalStack SQS is mock-only.
2. **Workflow engine (Phase 5.5+, compose, deferred):** Windmill (light, OSS) by default; Temporal (OSS) for durable long-running guarantees. **Gated on this proven event substrate.** Per-environment; tenant-scoped namespaces. Approval workflows + scheduled jobs build on `worker-runtime` + the bus.
3. **Notifications** are a separate Phase-6 decision (dedicated ADR): built-in email/webhook first; Novu/Knock/Courier as future provider adapters.

### Alternatives considered

1. **Postgres outbox + durable worker now; composed bus/workflow later behind the port (chosen).** Reuses the proven webhook DLQ/redrive pattern + RLS isolation; transactional with the writes that produce events; fully live-provable; honest about the scale/engine follow-ups.
2. **Redis Streams now.** Higher throughput, but adds a hard runtime dependency on the event path and loses transactional coupling with the producing write; deferred to Phase 5.5 behind the port.
3. **Workflow engine now.** Heavy operational burden before a proven event substrate; explicitly gated until the bus is stable + proven.

### Rejected alternatives (required)

- **In-memory-only event bus** — rejected: not durable; events lost on restart.
- **Sentry Kafka reuse** — rejected: Sentry-only; not the platform bus.
- **LocalStack as a production bus** — rejected: mock-only (dev/test).
- **Event payloads with secret fields** — rejected: publish rejects secret-bearing payload keys.
- **Worker success without idempotency** — rejected: a processed event is never re-claimed; publish dedups on (org, type, key).
- **DLQ without redrive** — rejected: redrive is first-class + audited.
- **Workflow engine before a durable event substrate** — rejected: the engine is gated on this proven bus.

### Accepted decision

Adopt option 1 for Phase 5: Postgres-outbox event bus, durable worker runtime with heartbeats, DLQ + audited redrive, operator surfaces. Composed bus, workflow engine, and scheduled jobs remain Proposed; notifications move to a dedicated Phase-6 ADR.

## Implementation phases

1. **Event substrate (Phase 5, done):** migration 027 (`platform_events`, `event_dead_letters`, `worker_heartbeats`), `EventBusPort` + `WorkerRegistryPort` + Postgres adapters, `events` usecase (publish/processNext/getEvents/getDeadLetters/redrive/listWorkers; secret-payload rejection; idempotent processing; retry→DLQ).
2. **Surfaces (Phase 5, done):** `GET /api/admin/events`, `GET /api/admin/events/dead-letter`, `POST /api/admin/events/:eventId/redrive`, `GET /api/admin/workers` (+ OpenAPI); `/admin/events` UI (workers + per-tenant events/DLQ + redrive).
3. **Composed bus / workflow / scheduler (Phase 5.5+, future):** behind the same ports; gated on this substrate.

## Acceptance criteria

- Publish persists + is idempotent; tenant id preserved; secret payloads rejected; events RLS-isolated per tenant. Worker consumes + marks processed; a processed event is not re-claimed; handler failure retries then dead-letters at max_attempts; redrive requeues; heartbeats visible; admin routes operator-global.
- `proof:event-bus`, `proof:event-worker`, `proof:event-redrive` pass against live Postgres (SKIP honestly if unavailable).

## Proof requirements

`proof:event-bus`, `proof:event-worker`, `proof:event-redrive` (live Postgres) + the existing `proof:webhooks`/`proof:webhook-redrive`. In-memory `node:test` suite (`events`). No registry status upgrade from a skipped proof.

## Production blockers

- High-throughput / very-low-latency eventing should move to a composed bus (Phase 5.5) behind the port.
- The workflow engine + scheduler are not delivered; durable long-running orchestration is unavailable until Phase 5.5+.
- Retry backoff is currently immediate (no exponential delay); a backoff schedule is a Phase-5.x refinement.

## Consequences

Positive: durable, transactional, tenant-isolated internal eventing with DLQ/redrive + worker heartbeats; reuses the proven webhook pattern; fully live-proven; unblocks notifications + workflow.

Negative: Postgres outbox is not ideal for very high throughput (mitigated by the Phase-5.5 composed path); no workflow engine yet.

Neutral / operational: DLQ/redrive patterns now extend from webhooks to internal events.

## Validation / evidence

Evidence level: Medium–High. Local proof via the three Phase-5 proofs + the `events` node:test suite. Evidence: `docs/evidence/platform/phase-5-events-workers.md`.

## Follow-up actions

Coordinated in `docs/adr/ACTION-REGISTER.md` (ADR-ACT-0259; ADR-ACT-0243 eventing discovery; notifications are a separate Phase-6 decision).

## References

ADR-0051, ADR-0052, ADR-0053, ADR-0055.

## Notes

Accepted on 2026-06-13 (ADR-ACT-0259) on Matt's authority per the directive. The workflow engine, scheduled jobs, and a composed Redis/NATS bus are explicitly NOT delivered here — Phase 5.5+, behind the same ports.
