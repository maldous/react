# ADR-0047: Tenant Email Sender Configuration + Readiness

## Status

Accepted

## Date

2026-06-12

## Decision owner

Architecture owner / technical lead

## Consulted

ADR-0029/0030 (tenant resolution + BFF boundary), ADR-0039 (platform configuration
registry), ADR-0040 (audit trail), ADR-0041/0044 (per-tenant encrypted credential +
lifecycle), ADR-0045 (capability map), ADR-0046 (OIDC enterprise hardening).
Claude Opus 4.8 (implementation assistance, human-reviewed).

## Context

After OIDC enterprise hardening (ADR-0046), the ADR-0045 capability map still lists
`email_sender` as **deferred**. A tenant cannot move from "created" to "can send trusted
transactional email" because there is no per-tenant email sender configuration, no
readiness signal, and no admin surface. The repo already has an `EmailPort`
(`@platform/email-runtime`), a Brevo HTTP adapter (`@platform/adapters-brevo`), a Mailpit
dev mail sink (Compose), and `nodemailer` available — but nothing wires a tenant-level
sender. The recommended next onboarding-critical slice is email sender config + readiness.

Constraints and risks:

- SMTP/API credentials must never reach the SPA, logs, audit, or git, and must be stored
  encrypted at rest (reuse the ADR-0041 `TENANT_SECRET_ENCRYPTION_KEY` AES-256-GCM pattern).
- Tenant authority must come from FQDN/session, never the request body (ADR-0029/0030).
- Readiness must stay honest (ADR-0045): no fake "ready". Domain/DNS verification is **not**
  implemented, so it must never be claimed.
- Keep the slice bounded: sender setup + readiness + a test-send, not a notification system.

## Stakeholder concerns

- Product: a tenant can configure a sender identity and prove it can send.
- Engineering: reuse `EmailPort`, the encrypted-secret pattern, audit-first mutations.
- Security: write-only secrets; no credential in any response/log/audit/evidence.
- Operations: classified provider/test failures, not bare 500s; a local Mailpit proof.
- Data: non-secret config in `tenant_settings`; secret in a dedicated encrypted table.
- Users/customers: trusted transactional email once configured + verified.
- Compliance/governance: capability map + ACTION-REGISTER + evidence in lock-step.

## Decision drivers

- Honesty of readiness over feature breadth.
- Reuse of the encrypted-secret + audit-first + tenant-scoping patterns.
- A real, repeatable local proof (Mailpit).
- Strict, no-passthrough contracts; no secret egress.

## Options considered

### Option A: BFF-managed sender config + encrypted secret + Mailpit/SMTP/Brevo send (chosen)

Non-secret config in `tenant_settings` (`email.sender`); the SMTP password / API key in a
dedicated encrypted table (`tenant_email_sender_credentials`), mirroring ADR-0041. Sending
via an SMTP adapter (nodemailer, used for `local`→Mailpit and `smtp`) or the existing Brevo
adapter. Readiness is presence-based + validated-on-successful-test; a test-send is the live
proof.

Pros: reuses proven patterns; honest readiness; real local proof via Mailpit.
Cons: a new encrypted table + an SMTP adapter.
Risks: outbound SMTP/HTTP to operator-supplied hosts (bounded; credentials never logged).

### Option B: Store everything (incl. secret) in `tenant_settings`

Pros: no new table. Cons: secrets in a tenant-readable key-value store — rejected.

### Option C: Defer sending; only store config

Pros: smallest. Cons: cannot prove "can send"; readiness would be dishonest or useless —
rejected.

## Decision

Adopt **Option A**. Add tenant email sender configuration (`provider` ∈
`disabled|local|smtp|brevo`, `fromName`, `fromEmail`, `replyToEmail`, `enabled`), readiness
classification, and a non-interactive **test-send**, under the existing tenant BFF boundary.
Non-secret config lives in `tenant_settings`; the SMTP password / API key lives in a new
AES-256-GCM-encrypted table and is **write-only** (never returned). New permissions
`tenant.email.settings.read` / `tenant.email.settings.write` gate the surface. All mutations
are audit-first and tenant-scoped from FQDN/session. Domain/DNS verification and a full
notification system are out of scope.

## Rationale

Option A reuses the established encrypted-secret, audit-first, and tenant-scoping patterns,
keeping secrets out of the SPA/logs/audit and readiness honest: a sender is `configured`
only for the local dev sink (documented invariant) or after a real successful test-send
(`validated`); SMTP/Brevo with an unverified credential reports `unknown`, never `ready`.

## Consequences

Positive: tenants can configure and prove a sender; capability map reflects real status;
no new data-access bypass.
Negative: a new encrypted table + SMTP adapter; outbound send surface (bounded).
Neutral: a `proof:email-sender` script sends to Mailpit and reads it back.

## AI-assistance record

AI used: Yes. Tool/model: Claude Opus 4.8 (1M context), Claude Code. Scope: implementation,
tests, runtime proof, this ADR. Human review: required before merge. Validation: gates +
runtime proof in the evidence bundle.

## Validation / evidence

Evidence level: High. Evidence: `docs/evidence/configuration/tenant-email-sender-configuration.md`.

## Impacted areas

- Architecture: new BFF use cases + routes; new encrypted email-secret store; SMTP adapter.
- Data: `tenant_settings` `email.sender` key + new `tenant_email_sender_credentials` table
  (migration 018).
- API: `GET`/`PATCH /api/org/email-sender`, `GET /api/org/email-sender/readiness`,
  `POST /api/org/email-sender/test`.
- Security: write-only encrypted secrets; classified failures; no secret egress.
- Testing: backend unit + frontend MSW/axe + OpenAPI drift + Mailpit runtime proof.
- UX: new `/admin/email` surface + nav + readiness link.
- Documentation: capability map, OpenAPI, i18n, CODEMAPS, ACTION-REGISTER.

## Follow-up actions

Tracked in:

```text
docs/adr/ACTION-REGISTER.md
```

ADR-ACT-0216 covers this slice. Future actions: sender-domain (SPF/DKIM/DMARC)
verification, bounce/complaint handling, and product/notification email.

## Review date

2026-12-12

## Supersedes

None.

## Superseded by

None.

## References

- ADR-0039 platform configuration registry
- ADR-0041 per-tenant auth-settings credential (encrypted-secret pattern)
- ADR-0045 enterprise capability map
- ADR-0046 OIDC enterprise hardening

## Notes

Readiness statuses: `configured`, `missing_sender`, `missing_credential`,
`invalid_credential`, `provider_unreachable`, `sender_unverified`, `unknown`.
`sender_unverified` is reserved for a future sender-domain verification capability and is
never returned by this slice — readiness stays honest.
