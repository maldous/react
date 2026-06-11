# ADR-0042: Writable MFA Policy and Auth Settings Runtime Proof

## Status

Accepted

## Date

2026-06-11

## Decision owner

Architecture owner / technical lead

---

## Context

ADR-0041 built the per-tenant Auth Settings credential substrate (readiness probe, write-error
classification, audit-first writes, operator-seeded attach) and made the **Session** tab the first
writable Auth surface. It explicitly deferred **writable MFA** as a "small follow-up" and left two gaps:

1. **MFA is still read-only** even though it can reuse the exact Session substrate.
2. **No live realm round-trip was ever executed** — ADR-0041 carried an honest caveat that no
   `configured → save → realm write → read-back` was proven against a running Keycloak.

Investigation also found the existing `KeycloakRealmAdminAdapter` MFA mapping is **defective**: it
wrote `policy.required` ("none"/"optional"/"required") into the realm's `otpPolicyType` field — which
Keycloak defines as the OTP _algorithm_ ("totp"/"hotp"), not a requirement level — and read it back
the same way. That neither enforces MFA nor round-trips correctly.

---

## Decision

Make MFA the second writable Auth tab, reusing the ADR-0041 substrate verbatim, and add a repeatable
runtime proof that the credentialed realm-write path works end to end.

### Faithful MFA mapping (corrected)

`get/setMfaPolicy` now map onto Keycloak **realm required-actions**, which genuinely govern whether
users are prompted to register a second factor and which round-trip reliably:

| `required` | required-action state (`enabled`, `defaultAction`) |
| ---------- | -------------------------------------------------- |
| `required` | `enabled: true`, `defaultAction: true`             |
| `optional` | `enabled: true`, `defaultAction: false`            |
| `none`     | `enabled: false`, `defaultAction: false`           |

`type` selects the alias: `totp` → `CONFIGURE_TOTP`, `webauthn` → `webauthn-register`. `setMfaPolicy`
GETs the full required-action representation, mutates `enabled`/`defaultAction`, and PUTs it back
(verified 204 + read-back against a live Keycloak 26.2 dev realm).

**Scope of this mapping (documented limitations):**

- It manages the realm-level **required-action** for the second factor (prompt-to-configure). It does
  **not** rewrite the browser authentication flow into a hard conditional-OTP gate; "required" means
  the action is a default action for users, not a per-login conditional sub-flow. A full
  conditional-flow MFA enforcement model is **deferred**.
- `type`: **TOTP is authoritative and editable**. WebAuthn registration exists as an alias and is
  readable, but the UI keeps `type` **read-only (TOTP)** this slice — switching factor type safely
  needs its own design pass. Documented in evidence.
- `gracePeriodSeconds`: part of the contract but **not** represented by a realm required-action; it is
  **not mutated** here and is omitted from the policy read. Deferred.

### Writable MFA tab (UI)

The MFA tab mirrors the Session tab exactly:

- `useAuthReadiness()` gates editing: the RHF + Zod form renders only when readiness is `configured`
  **and** the user has `tenant.auth.settings.write`.
- Non-`configured` readiness → the same precise notice pattern as Session. No write permission →
  read-only view.
- Editable field: `required` (`none` / `optional` / `required`). `type` is shown disabled (TOTP).
- Save → `PATCH /api/auth/settings/mfa`; `LiveRegion` announces success; the contextual audit panel
  (filtered to `auth_settings.mfa.changed`) refreshes.

### No parallel write path

The backend write path is **unchanged** from ADR-0041: `mutateAuthSetting` → `classifyRealmError` →
`sendAuthSettingsFailure`, audit-first, tenant context from FQDN/session, secrets never logged or
audited. Only the adapter's Keycloak mapping changed. `auth_settings.mfa.changed` (existing
`AuditAction.AuthSettingsMfaChanged`) is reused.

### Runtime proof

A repeatable script (`apps/platform-api/scripts/auth-settings-runtime-proof.ts`) builds
`KeycloakRealmAdminAdapter` against a running Keycloak, then: probes readiness (valid creds → `ok`;
bad secret → `invalid_credential`), reads the current MFA policy, writes `required`/`optional`, reads
each back and asserts the change, and **restores** the original. It exercises the real
**RealmAdminPort → Keycloak → read-back** path and validates both the readiness classification and the
new MFA mapping. The BFF endpoint + audit-first + no-secret guarantees remain covered by node:test and
MSW integration tests. See `docs/evidence/auth/writable-mfa-policy-and-runtime-proof.md` for the
executed output and the exact command.

---

## Consequences

### Positive

- MFA is writable with the same readiness/classification/audit guarantees as Session; the realm-write
  substrate now has an executed live proof, closing the ADR-0041 caveat for the realm round-trip.
- The MFA Keycloak mapping is corrected from a non-round-tripping defect to a faithful required-action
  mapping.

### Negative / Limitations

- WebAuthn factor-type switching and `gracePeriodSeconds` remain read-only/deferred (documented).
- "Required" maps to a default required-action, not a hard conditional-flow gate (documented).

### Deferred

- Writable IdP create/update/delete + secret storage/redaction; tenant-admin credential self-service
  rotation; automated credential repair for legacy tenants; conditional-flow MFA enforcement; editable
  factor type + grace period.

---

## Related ADRs

- ADR-0041 (credential substrate, readiness, Session writable — reused here), ADR-0040 (audit panels),
  ADR-0036 (control plane; read-only auth tabs), ADR-0022 (session/MFA), ADR-0029 (tenant isolation).
- Implementation: ADR-ACT-0210.
