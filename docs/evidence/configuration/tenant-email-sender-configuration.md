# Tenant Email Sender Configuration + Readiness — Evidence (ADR-0047 / ADR-ACT-0216)

Date: 2026-06-12. Owner: Architecture owner / technical lead.
AI assistance: Claude Opus 4.8 (implementation), human-reviewed.

## Scope delivered

A tenant can move from "created" to "can send trusted transactional email":

- **Provider model** `disabled | local | smtp | brevo` with sender identity
  (`fromName`, `fromEmail`, `replyToEmail`, `enabled`).
- **Storage**: non-secret config in `tenant_settings` (`email.sender`); the SMTP
  password / API key in a new AES-256-GCM-encrypted table
  `tenant_email_sender_credentials` (migration 018), reusing the ADR-0041
  `TENANT_SECRET_ENCRYPTION_KEY` pattern. The secret is **write-only**.
- **API** (tenant-scoped, FQDN/session): `GET`/`PATCH /api/org/email-sender`,
  `GET /api/org/email-sender/readiness`, `POST /api/org/email-sender/test`.
- **Sending**: a new `SmtpEmailAdapter` (nodemailer) for `local` (Mailpit dev
  sink) and `smtp`; the existing `BrevoEmailAdapter` for `brevo`.
- **Readiness**: `configured | missing_sender | missing_credential |
  invalid_credential | provider_unreachable | unknown` — honest (see below).
- **Permissions**: new `tenant.email.settings.read` / `tenant.email.settings.write`
  on `tenant-admin`.
- **UI**: a new `/admin/email` surface + nav entry + `/admin/readiness` link, with
  provider selector, sender identity, conditional SMTP/Brevo credential fields
  (blank on edit), a readiness banner, and a test-email action.

## Decisions

- The credential is stored in a dedicated encrypted table, never in plain
  `tenant_settings`. Responses expose only `hasCredential`.
- Readiness is `configured` only for the local dev sink (documented invariant) or
  after a real successful test-send (the credential is marked validated); an
  unverified smtp/brevo credential reports `unknown`, never `ready`.
- `sender_unverified` is reserved for a future sender-domain (SPF/DKIM/DMARC)
  verification capability and is **never returned** by this slice.
- All mutations are audit-first; tenant authority is FQDN/session only.

## Tests run (with proof layer)

- `node:test` (platform-api) — `email-sender.test.ts` (26 assertions): readiness
  classifier (all branches), settings defaults + no-secret DTO, update validation
  (smtp needs host; tenant id rejected from body via strict schema), audit-first +
  no-secret-in-audit, blank/omitted secret preserves, test-send success +
  mark-validated, disabled/missing_sender/missing_credential, auth-vs-connection
  classification, `classifyEmailSendError`.
- `node:test` — `capability-registry.test.ts`: `email_sender` is `implemented`,
  its readiness reflects the signal honestly, optional (non-blocking), and the
  never-fake-readiness guard still pins the deferred set.
- Vitest (frontend) — `AdminEmailPage.test.tsx` (6, MSW-proven): settings render,
  save + LiveRegion success, secret never prefilled (smtp), test-email result,
  read-only without write permission, axe accessibility.
- OpenAPI drift: 73 routes match `docs/api/openapi.json` (4 new paths).

## Runtime proof (executed)

`apps/platform-api/scripts/email-sender-runtime-proof.ts`
(`npm run proof:email-sender`). Sends a real message through the SMTP adapter to
Mailpit and reads it back. Command:

```bash
make compose-up-default
npm run proof:email-sender
```

Executed output (Mailpit v1.21.0, dev profile, 2026-06-12):

```text
# Email sender runtime proof — Mailpit @ localhost:1025

PASS  disabled → missing_sender
PASS  local + sender → configured
PASS  smtp configured-but-unverified → unknown (never faked)
PASS  test email sent via SMTP — <…@proof.test>
PASS  message visible in Mailpit — E42ePqXC2tauMJNoGWfumJ
PASS  unreachable provider classified — provider_unreachable
PASS  proof message cleaned up

# ALL CHECKS PASSED
```

## Proven live vs unit/MSW only

- Live-proven (against Mailpit): the SMTP send path (local provider), delivery
  read-back, and unreachable-provider classification.
- Unit-proven (`node:test`): readiness classification (all providers/branches),
  update/preserve/validate semantics, audit-first + no-secret guarantees, error
  classification.
- MSW-proven (frontend): the `/admin/email` settings/save/test/read-only flows + axe.
- Brevo send is unit-proven (fake fetch); a live Brevo send needs a real API key
  and is not exercised here.

## Capability map changes

`email_sender`: `deferred` → `implemented`, `adminRoute: /admin/email`,
`requiredPermission: tenant.email.settings.read`, `readinessKind: "email-sender"`
(a new signal gathered in `GET /api/org/readiness`). Optional → never blocks
overall readiness.

## Known deferrals

- Sender-domain (SPF/DKIM/DMARC) verification — not implemented; `sender_unverified`
  reserved, never returned.
- Bounce/complaint handling and product/notification email — out of scope.
- A live Brevo send proof (needs a real key).

## No-secret guarantee

The SMTP password / API key is write-only: stored AES-256-GCM-encrypted, never
returned in any response (only `hasCredential`), never logged, never in audit
metadata (asserted in `email-sender.test.ts`), and never printed by the proof.

## No-fake-readiness guarantee

`configured` requires the local dev sink (documented invariant) or a real
validated test-send; smtp/brevo without a verified credential is `unknown`.
Asserted by `capability-registry.test.ts` and `email-sender.test.ts`.

## ACTION-REGISTER linkage

ADR-ACT-0216 (Source ADR-0047). Evidence: this file.
