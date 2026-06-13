# Notification real transports — decision (scoped, not delivered)

**Source ADR:** ADR-0068 (Accepted; Phase-6.5 transports are Proposed sub-decisions)
**Capability:** `notifications` (delivered as local-sink; real transports = Phase 6.5)
**Status:** scoped — **not delivered** (a real design gap was found, not just effort)

## What was found

The dispatch substrate (`dispatchNotification`, ADR-ACT-0260) already exposes the
correct seam: a `NotificationTransportRegistry` keyed by channel, with the local
sink as the default. Plugging in a transport is mechanically trivial. The blocker
is the **transport context**, not the adapter.

`NotificationTransport` is currently:

```ts
(msg: { organisationId; userId; channel; category; subject }) => Promise<NotificationDispatchStatus>
```

This carries **no recipient address and no destination URL**. Real delivery needs:

- **email:** resolve `userId → verified email` within the tenant (the profile
  store is own-profile-only; there is no cross-user email resolver today), plus
  the rendered body (only `subject` is in scope);
- **webhook:** a destination URL + signing secret. The platform already has signed
  webhook delivery (`webhooks-developer`, ADR-0052) over
  `tenant_webhook_subscriptions`. A second notification→webhook path would
  **duplicate** that machinery, which the registry forbids.

Shipping a transport with a hardcoded or env-only recipient would be brittle and
decorative — explicitly out of scope for this pass.

## Decision

Deliver Phase-6.5 transports only after the transport context is designed:

1. **Extend the transport contract** to a resolved message:
   `{ ...current, recipient: { email?; webhookSubscriptionId? }, body }`, resolved
   by the dispatch usecase before the transport is called — so transports stay
   pure senders and the resolver is testable in isolation.
2. **Recipient resolver port:** `NotificationRecipientResolver.resolve(organisationId, userId, channel)`
   backed by the profile/identity store (email) and the webhook subscription store
   (URL + secret) — **reusing** `webhooks` HMAC signing, not re-implementing it.
3. **EmailNotificationTransport:** wraps the existing `SmtpEmailAdapter`
   (Mailpit/local SMTP in dev/test/staging; real SMTP/Brevo in prod). Mailpit is a
   **dev/test/staging proof provider only** (see provider-environment-classification),
   never a production transport.
4. **WebhookNotificationTransport:** delegates to the existing
   `WebhookDispatchPort` + `signWebhookBody` (ADR-0052) so signing is shared.
5. **Readiness + failure classification:** `getNotificationReadiness` already
   reports `local-sink` vs `configured-local` honestly; extend it to report
   `smtp`/`webhook` transport readiness without faking.

## Proof requirement (for the future slice)

- `proof:notification-email-transport`: enabled email preference sends through
  local Mailpit (verified via the Mailpit API), disabled suppresses, secret
  payload rejected, failed transport logs `failed`.
- `proof:notification-webhook-transport`: enabled webhook sends a signed POST to a
  local receiver; signature verifies (reuses ADR-0052); failure logs `failed`.
- `proof:notification-transport-routes`: readiness reports unavailable transports
  honestly.

## Why scoped now

The current pass delivered a different real provider end-to-end (the Redis
rate-limit counter, `proof:rate-limits-redis`). Notification transports require a
contract change (recipient context) and a deliberate reuse of the ADR-0052 signing
path to avoid duplicating webhook delivery. That is a full slice with a design
decision, and is left scoped rather than shipped brittle.
