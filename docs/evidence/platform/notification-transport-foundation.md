# Notification real transports (Phase 6.5)

**ADR:** ADR-0068 · **Action:** ADR-ACT-0273 · **Status:** Delivered + locally proven
**Capability:** `notifications` (events-queues-workflows)

## Scope delivered

Real notification delivery behind the existing `NotificationTransport` seam (no usecase
change) — replacing the local sink with actual transports, opt-in per channel:

- **`createEmailTransport`** — resolves the recipient server-side (`NotificationRecipientResolver`)
  and sends through the `EmailPort` (`SmtpEmailAdapter` → local **Mailpit**). A missing
  recipient or send error reports `failed` (logged failed, never faked sent).
- **`createWebhookTransport`** — resolves the tenant destination and POSTs a body signed
  with the **ADR-0052 HMAC signer** (`webhookSignatureHeader`) via `WebhookDispatchPort`.
  A non-2xx / unreachable / missing destination reports `failed`.
- **`NotificationRecipientResolver` port + `ConfiguredNotificationRecipientResolver`** — the
  server-side recipient/destination resolution (the gap the earlier pass recorded). The
  configured resolver is delivered; IdP-backed per-user email + per-subscription webhook
  routing are documented follow-ups behind the same port.

## Wiring

Transports are **opt-in** and selected in `buildNotificationsDeps` (`selectNotificationTransports`):

| Env | Effect |
| --- | --- |
| `NOTIFICATION_EMAIL_TRANSPORT=smtp` | email channel → SMTP/Mailpit |
| `NOTIFICATION_WEBHOOK_TRANSPORT=on` | webhook channel → signed POST |
| (neither) | built-in local sink (default, unchanged) |

A disabled preference still **suppresses before the transport** (unchanged). The webhook
body carries only non-secret summary fields (`event/subject/ids`); the dispatch usecase
already rejects secret-bearing payload keys upstream.

## Proofs (live)

| Proof | What it proves |
| --- | --- |
| `proof:notification-email-transport` | An enabled email preference delivers a REAL SMTP message that lands in Mailpit (verified via the Mailpit API); a disabled preference suppresses (no Mailpit message); an unresolvable recipient reports `failed`. |
| `proof:notification-webhook-transport` | An enabled webhook preference POSTs to a local receiver with a **valid ADR-0052 signature**; the body carries no secret field; a non-2xx receiver and a missing destination both report `failed`. |
| `proof:notification-transport-routes` | The operator test-send route (`POST /api/admin/tenants/:tenantId/notifications/test`) selects the wired email transport and delivers end-to-end to Mailpit. |

All pass locally:

```text
proof:notification-email-transport    — 5/5 PASS (real Mailpit delivery)
proof:notification-webhook-transport  — 7/7 PASS (valid HMAC signature)
proof:notification-transport-routes   — 3/3 PASS (wired route → Mailpit)
```

## Not delivered (follow-ups)

- A composed notification provider (Novu / Knock / Courier).
- IdP-backed per-user recipient resolution (from Keycloak) + per-subscription webhook routing.
- Production SMTP / Brevo (the local transport proves delivery against Mailpit).

## Linkage

ADR-0068 (Phase 6.5) · ADR-ACT-0273 · reuses the ADR-0052 webhook signer
(`webhookSignatureHeader`) + `SmtpEmailAdapter` (Mailpit) · registry `notifications`
proof set extended; transports now real (was local-sink only).
