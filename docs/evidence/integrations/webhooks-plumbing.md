# Integrations / Webhooks Plumbing — Evidence (ADR-0051 / ADR-ACT-0221)

Date: 2026-06-12. Owner: Architecture owner / technical lead.
AI assistance: Claude Opus 4.8 (implementation), human-reviewed.

## Scope delivered

The first outbound integrations capability — per-tenant signed webhooks:

- **Contracts** (`@platform/contracts-admin`, strict/no-passthrough):
  `WebhookSubscriptionSummary`/`ListResponse`, `CreateWebhookSubscriptionRequest`,
  `UpdateWebhookSubscriptionRequest`, `CreateWebhookSubscriptionResponse` (reveal-once
  secret), `WebhookSecretRotationResponse` (reveal-once), `WebhookDeliverySummary`/
  `ListResponse`, `WebhookTestResult`, `WebhookReadinessResponse`. URL rule: https only
  (http allowed only for localhost). Reads expose only `hasSecret`.
- **Port + adapters**: `WebhookStore` port; `PostgresWebhookStore` (plain pool + explicit
  `organisation_id` filter, AES-256-GCM encrypted `secret_enc`, `getSecret` for
  server-side signing only); `HttpWebhookDispatcher` (single bounded POST).
- **Use case** (`usecases/webhooks.ts`): pure `signWebhookBody` (HMAC-SHA-256 over
  `<timestamp>.<body>`) + `webhookSignatureHeader`; `createWebhook`/`updateWebhook`/
  `deleteWebhook`/`rotateWebhookSecret` (audit-first); `testWebhook` (signed
  `platform.test` dispatch → delivery log); `listWebhooks`/`listWebhookDeliveries`;
  pure `classifyWebhookReadiness` + `getWebhookReadiness`. Documented `WEBHOOK_RETRY_POLICY`.
- **Data**: migration 019 — `tenant_webhook_subscriptions` + `tenant_webhook_deliveries`
  (public schema, FK to organisations ON DELETE CASCADE).
- **API** (tenant-scoped, FQDN/session): the 8 `/api/org/webhooks*` routes.
- **Permissions**: new `tenant.webhooks.read` / `tenant.webhooks.write` on `tenant-admin`.
- **UI**: a new `/admin/webhooks` surface + nav + `/admin/readiness` link — list, add
  (with a reveal-once secret block), rotate secret, send test, view deliveries, remove;
  read-only without write permission; axe-clean.

## Decisions

- The signing secret is generated server-side, AES-256-GCM encrypted, and revealed ONCE
  (create + rotate); reads return only `hasSecret`; it never appears in audit metadata.
- Payloads are HMAC-SHA-256 signed over `<timestamp>.<body>`; the `X-Platform-Signature:
  t=…,v1=…` header carries the timestamp for replay protection.
- Outbound URLs must be https (http only for localhost/127.0.0.1) — unsafe schemes rejected.
- Mutations are audit-first with safe metadata only (url + event types, never the secret).
- The async retry worker is NOT implemented: a test is a single immediate attempt recorded
  in the delivery log; the retry policy is documented config only. Honestly `partial`.

## Tests run (with proof layer)

- `node:test` (platform-api) — `webhooks.test.ts` (26 across suites): HMAC signing
  verifiable; readiness classifier; create reveals the secret once + stores it + NEVER
  puts it in audit metadata; rotate replaces + no secret in audit; update/delete/rotate
  not_found; test dispatches a correctly-signed `platform.test` payload + records a
  delivery + no secret in body/audit; failed dispatch classified (no throw escapes);
  list never carries a secret field.
- `node:test` — `capability-registry.test.ts`: `integrations_webhooks` is `partial`, its
  readiness reflects the new `webhooksReadiness` signal honestly, optional (non-blocking).
- Vitest (frontend) — `AdminWebhooksPage.test.tsx` (5, MSW-proven): list + readiness render,
  create shows the once-only secret + announces, send-test announces, read-only hides
  actions, axe.
- OpenAPI drift: 89 routes match `docs/api/openapi.json` (8 new paths).
- Full suites green: `test:platform-api` 502, `test:frontend:run` 165.

## Runtime proof (executed)

`apps/platform-api/scripts/webhooks-runtime-proof.ts` (`npm run proof:webhooks`). Creates a
temp webhook against live Postgres, dispatches a signed test event through the real HTTP
dispatcher to a local receiver, verifies the signature + delivery log, and cleans up.

```bash
make compose-up-default
npm run db:migrate
npm run proof:webhooks
```

Executed output (local Postgres + local receiver, dev profile, 2026-06-12):

```text
# Tenant webhooks runtime proof

PASS  HMAC signing is verifiable
PASS  readiness: enabled subscription → configured
PASS  created webhook reveals the secret once
PASS  test dispatch delivered (HTTP 200)
PASS  local receiver got exactly one delivery
PASS  received payload is correctly HMAC-signed (verified vs secret)
PASS  payload does not contain the secret
PASS  event header is platform.test
PASS  delivery log records a delivered attempt
PASS  cleanup removed the temp webhook

# ALL CHECKS PASSED
```

## Proven live vs unit/MSW only

- Live-proven (against Postgres + a local HTTP receiver): create → signed dispatch →
  receiver-verified signature → delivery log → cleanup.
- Unit-proven (`node:test`): signing, reveal-once + no-secret-in-audit, dispatch
  success/failure classification, readiness.
- MSW-proven (frontend): the `/admin/webhooks` list/create-secret/test/read-only flows + axe.
- NOT proven (honestly deferred): the durable async retry/backoff worker (config only this
  pass) and inbound receiver-side verification helpers.

## Capability map changes

`integrations_webhooks`: `deferred` → **partial**, `adminRoute: /admin/webhooks`,
`requiredPermission: tenant.webhooks.read`, `readinessKind: "tenant-webhooks"` (new
`webhooksReadiness` signal in `/api/org/readiness`, a cheap subscription-count check).
Optional → never blocks overall readiness.

## Known deferrals

- The async retry/backoff worker (`WEBHOOK_RETRY_POLICY` is documented config only).
- Receiver-side signature-verification helpers.
- First-class event sources beyond the `platform.test` event.

## No-secret guarantee

The signing secret is reveal-once (create + rotate), AES-256-GCM encrypted at rest, never
returned by a read (only `hasSecret`), never logged, never in audit metadata, and never in
the dispatched payload body — all asserted in `webhooks.test.ts` and the runtime proof.

## No-fake-readiness guarantee

`configured` requires ≥1 enabled subscription; otherwise `no_subscriptions`; a store error
is `degraded`. The capability is honestly `partial` (async retry worker deferred). Asserted
by `webhooks.test.ts` and `capability-registry.test.ts`.

## ACTION-REGISTER linkage

ADR-ACT-0221 (Source ADR-0051). Evidence: this file.
