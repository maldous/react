# ADR-0059: Workflow, event, and queue architecture

## Status

Proposed

## Date

2026-06-13

## Decision owner

Architecture owner / technical lead

## Consulted

Engineering; operations; AI assistant (drafting, human review required).

## Context

The repo has a proven outbound webhook substrate (durable delivery worker, dead-letter, redrive, per-subscription metrics; ADR-0051/0052) and port-only scaffolds for `queue-runtime`, `worker-runtime`, and `notification-runtime`. There is no general internal event bus, pub/sub, workflow engine, scheduler, approval workflow, or multi-channel notification delivery. Sentry's Kafka is Sentry-only and must not be treated as the platform bus.

## Decision

1. **Internal eventing + durable queues (build):** generalise the proven webhook substrate onto Redis Streams (already composed); scale to NATS/Redpanda only if throughput demands prove it.
2. **Workflow engine (compose):** Windmill (light, OSS) by default; Temporal (OSS) if durable long-running guarantees are required. Per-environment; tenant-scoped namespaces.
3. **Scheduled jobs / job runner (build):** built on `worker-runtime` + the queue.
4. **Notifications (compose + build):** Novu (OSS) for in-app/push, reusing the proven email channel (Brevo/SMTP/Mailpit) and per-user preferences.
5. Approval workflows and operator redrive are first-class and audited.

## Consequences

Positive: reuses a proven, audited substrate; avoids heavy infrastructure until justified; multi-channel notifications unlocked.

Negative: workflow engine adds operational burden; eventing generalisation must preserve tenant isolation and idempotency.

Neutral / operational: DLQ/redrive patterns extend from webhooks to internal events.

## Validation / evidence

Evidence level: Medium–High. Existing proof: `proof:webhooks`, `proof:webhook-redrive`, `proof:webhook-worker`. New engines require their own readiness + tenant-isolation proofs.

## Follow-up actions

Coordinated in `docs/adr/ACTION-REGISTER.md` (ADR-ACT-0243, ADR-ACT-0249).

## References

ADR-0047, ADR-0051, ADR-0052, ADR-0053, ADR-0055.

## Notes

Remains **Proposed** (NOT accepted in ADR-ACT-0254): too broad — it bundles internal eventing + durable queues + workflow engine + scheduler + notifications. It must be **split** (or carry per-capability acceptance criteria) and the Windmill-vs-Temporal spike resolved before acceptance.
