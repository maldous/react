# ADR-0051: Integrations / Webhooks Plumbing

## Status

Accepted

## Date

2026-06-12

## Decision owner

Architecture owner / technical lead

## Consulted

ADR-0029/0030 (tenant resolution + BFF boundary), ADR-0040 (audit trail), ADR-0041
(per-tenant AES-256-GCM encrypted-secret pattern), ADR-0045 (capability map),
ADR-0047 (email sender — encrypted write-only secret precedent), ADR-0048/0049/0050
(sibling readiness slices). Claude Opus 4.8 (implementation assistance, human-reviewed).

## Context

The ADR-0045 capability map listed `integrations_webhooks` as **deferred** — there was
no outbound webhook capability at all (the existing `contracts-ingestion` package is
_inbound_ ingestion, unrelated). Tenants need to subscribe their own endpoints to
platform events with signed, auditable, logged deliveries. This is the first genuinely
new subsystem in the readiness pass (vs. the promotions in ADR-0048/0049/0050).

Constraints and risks:

- The signing secret must never reach the SPA after creation, nor logs/audit/git; it
  must be stored encrypted (reuse the ADR-0041 `TENANT_SECRET_ENCRYPTION_KEY` pattern).
- Payloads must be signed so receivers can verify authenticity + resist replay.
- Outbound HTTP to tenant-supplied URLs is an SSRF surface — restrict schemes/hosts.
- Tenant authority from FQDN/session, never the body (ADR-0029/0030).
- A real background retry worker is out of scope; readiness must stay honest about it.

## Stakeholder concerns

- Product: a tenant can register an endpoint, choose events, send a test, and see deliveries.
- Security: reveal-once HMAC secret, encrypted at rest; HMAC-SHA-256 + replay timestamp;
  https-only (http for localhost only); audit-first mutations; no secret egress.
- Operations: classified, bounded single-attempt dispatch with a delivery log.
- Compliance/governance: capability map + ACTION-REGISTER + evidence in lock-step.

## Decision drivers

- Honesty: `partial` (sync dispatch + log implemented; async retry worker deferred).
- Reuse of the encrypted-secret + audit-first + tenant-scoping patterns.
- A real, repeatable local proof (a local HTTP receiver verifies a signed delivery).

## Options considered

### Option A: BFF-managed subscriptions + encrypted reveal-once secret + signed sync dispatch + delivery log (chosen)

Subscriptions + a delivery log in two new public tables (migration 019, explicit
`organisation_id` filter + FK cascade, like `vanity_domain_challenges`). The signing
secret is AES-256-GCM encrypted and revealed only on create/rotate. A `WebhookDispatchPort`
(real `HttpWebhookDispatcher` + a fake for tests) performs a single bounded, signed POST;
the result is recorded in the delivery log. A test event (`platform.test`) exercises the
path. The retry policy is documented config (`WEBHOOK_RETRY_POLICY`); the background
worker is deferred.

Pros: reuses proven patterns; honest; real local proof; bounded. Cons: a new subsystem
(two tables, a dispatch port). Risks: outbound HTTP (SSRF — mitigated by https/localhost
URL validation + a hard timeout).

### Option B: Full event bus + durable async retry worker now

Pros: production-grade delivery. Cons: far larger; the worker + queue are their own slice;
rejected for this pass (documented as deferred follow-up).

### Option C: Store the secret reveal-on-read

Pros: simpler UI. Cons: a readable secret store — rejected; reveal-once + encrypted only.

## Decision

Adopt **Option A**. Add per-tenant webhook subscriptions (`url`, `eventTypes`, `enabled`),
a reveal-once AES-256-GCM signing secret, HMAC-SHA-256 payload signing over
`<timestamp>.<body>` (replay-protected via the `X-Platform-Signature: t=…,v1=…` header),
a delivery log, and an immediate single-attempt test dispatch of a `platform.test` event.
Routes: `GET /api/org/webhooks`, `GET /api/org/webhooks/readiness`, `POST /api/org/webhooks`,
`PATCH /api/org/webhooks/:id`, `DELETE /api/org/webhooks/:id`,
`POST /api/org/webhooks/:id/rotate-secret`, `POST /api/org/webhooks/:id/test`,
`GET /api/org/webhooks/:id/deliveries` — gated by new `tenant.webhooks.read` /
`tenant.webhooks.write`; mutations audit-first (safe metadata only). URLs must be https
(http only for localhost). The capability map promotes `integrations_webhooks` from
`deferred` to **partial**: subscriptions + signing + sync dispatch + delivery log are
implemented; the async retry worker is deferred.

## Rationale

The secret is generated server-side, stored encrypted, and returned exactly once — the
SPA shows it in a dismissible block and never refetches it. Signing over the timestamped
body lets a receiver verify authenticity and reject replays. A single bounded attempt with
an honest delivery-log status (and a documented retry policy) avoids over-claiming durable
delivery the worker would provide.

## Consequences

Positive: tenants get signed, auditable, logged webhooks with an honest readiness signal;
no secret egress; reuses encrypted-secret + audit-first patterns. Negative: a new subsystem
(two tables + dispatch port) and an outbound-HTTP surface (bounded). Neutral: a
`proof:webhooks` script creates a temp webhook, dispatches a signed test event to a local
receiver, verifies the signature + delivery log, and cleans up.

## AI-assistance record

AI used: Yes. Tool/model: Claude Opus 4.8 (1M context), Claude Code. Scope: implementation,
tests, runtime proof, this ADR. Human review: required before merge.

## Validation / evidence

Evidence level: High. Evidence: `docs/evidence/integrations/webhooks-plumbing.md`.

## Impacted areas

- Architecture: new BFF use cases + 8 routes; new webhook store port + Postgres adapter +
  HTTP dispatcher adapter.
- Data: migration 019 (`tenant_webhook_subscriptions` + `tenant_webhook_deliveries`).
- API: the 8 `/api/org/webhooks*` routes.
- Security: reveal-once encrypted secret; HMAC signing + replay timestamp; https-only URLs;
  audit-first; no secret egress.
- Testing: backend unit (signing + reveal-once + no-secret-in-audit + dispatch
  classification) + frontend MSW/axe + OpenAPI drift + a live runtime proof.
- UX: new `/admin/webhooks` surface + nav + readiness link.
- Documentation: capability map, OpenAPI, i18n, CODEMAPS, ACTION-REGISTER, ADR-0007
  (new `docs/evidence/integrations/` subdir).

## Follow-up actions

Tracked in:

```text
docs/adr/ACTION-REGISTER.md
```

ADR-ACT-0221 covers this slice. Future actions: a durable async retry/backoff worker,
inbound signature verification helpers for receivers, and additional first-class event
types beyond `platform.test`.

## Review date

2026-12-12

## Supersedes

None.

## Superseded by

None.

## References

- ADR-0041 per-tenant encrypted-secret pattern
- ADR-0045 enterprise capability map
- ADR-0047 tenant email sender (encrypted write-only secret precedent)
- ADR-0049 tenant storage readiness (sibling slice)

## Notes

Signature header: `X-Platform-Signature: t=<unix_ms>,v1=<hmac_sha256_hex(`<t>.<body>`)>`
plus `X-Platform-Event`. Delivery statuses: `delivered`, `failed`, `pending`. Readiness:
`no_subscriptions`, `configured` (≥1 enabled), `degraded`, `unknown`. The signing secret
is reveal-once (create + rotate) and otherwise write-only; the async retry worker is
deferred (a test is a single immediate attempt, logged). URLs must be https (http only for
localhost).
