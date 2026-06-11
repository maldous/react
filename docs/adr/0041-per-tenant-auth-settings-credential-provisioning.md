# ADR-0041: Per-tenant Auth Settings Credential Provisioning

## Status

Accepted

## Date

2026-06-11

## Decision owner

Architecture owner / technical lead

---

## Context

ADR-0036 left the `/admin/auth` Identity Providers, MFA, and Session tabs **read-only**: editing them
mutates the tenant's Keycloak realm through a per-tenant realm-admin **service-account credential**,
and that credential's provisioning + the UI's awareness of it were deferred. This has been the main
blocker to the Authentication section becoming a real tenant self-service surface.

Investigation shows the substrate already exists: `TenantCredentialStore`
(`get`/`setAuthSettingsCredential`, secret **encrypted at rest** via `token-crypto`,
`tenant_auth_settings_credentials` table), `KeycloakRealmAdminAdapter` with
`get/setMfaPolicy`/`get/setSessionPolicy`, the `auth.settings.{mfa,session}.{get,set}` routes, and —
critically — **tenant provisioning already creates the credential** (`provisioning.ts` step 4:
`provisionIdentity` → `setAuthSettingsCredential`). What is missing is a **readiness/classification
model**, **clean error classification** on writes, an **operator attach/validate path** for tenants
that predate provisioning, and **flipping one tab writable**.

---

## Decision

Deliver the readiness substrate and make **Session policy** the first safely-writable Auth tab.

### Credential provisioning (explicit: automated vs operator-seeded)

- **Automated**: `provisioning.ts` creates the per-tenant realm-admin service account and stores its
  credential (`setAuthSettingsCredential`) during tenant creation. New tenants are configured.
- **Operator-seeded**: a **system-admin (global-scope)** endpoint `POST
/api/admin/tenants/auth-settings-credential` attaches/rotates a credential for an existing tenant
  (e.g. one that predates provisioning) and **validates it via the readiness probe before storing**.
  This is separate from the tenant-admin mutation path (different scope + permission).

### Readiness model

`GET /api/auth/settings/readiness` (tenant-scoped) returns a classified status so the UI knows whether
editing is possible:

| status                      | meaning                                                        |
| --------------------------- | -------------------------------------------------------------- |
| `configured`                | credential present and the realm-admin probe succeeds          |
| `missing_credential`        | no credential row for the tenant                               |
| `invalid_credential`        | token grant rejected (bad client id/secret)                    |
| `forbidden_realm_operation` | token ok but the service account lacks realm-management rights |
| `realm_unreachable`         | Keycloak/network error                                         |

The probe lives on the `RealmAdminPort` (`probeReadiness()`): a service-account token grant + a
lightweight realm read, classified by HTTP status **at the source** (no message parsing).

### Writable Session policy

The Session tab becomes a React Hook Form + Zod form (token lifespan / idle / max / remember-me)
gated on `configured`; on save it `PATCH`es the existing `auth.settings.session.set` route and refreshes
the contextual audit panel (ADR-0040). **MFA and Identity Providers stay read-only** in this slice —
MFA is a small follow-up; IdP create/update carries secrets and needs its own redaction/provisioning
pass.

### Error classification (writes)

The mfa/session set routes catch realm failures and classify them as `NO_CREDENTIAL` /
`INVALID_CREDENTIAL` / `REALM_UNREACHABLE` / `FORBIDDEN_REALM_OPERATION` / `VALIDATION_ERROR`, mapped to
HTTP 503/502/403/400 with the existing SPA admin error semantics.

### Security

- Credentials are **never** returned to the SPA, logged, or placed in audit metadata; audit records the
  `clientId` only (never the secret). The redaction pass (ADR-0040) drops
  `secret|password|token|credential` keys.
- The client secret is **encrypted at rest** (`token-crypto`, `TENANT_SECRET_ENCRYPTION_KEY`); the
  local-dev fallback key is documented in `.env.example`.
- Tenant context is derived from FQDN/session, never the request body; a tenant can only reach its own
  realm (the credential is keyed by `organisation_id` and the realm name is derived from tenant context).
- The system-admin attach path is global-scope + system-admin-only and separate from the tenant-admin
  mutation path.

---

## Consequences

### Positive

- The Authentication section gains a real writable surface (Session) with a clear readiness story; the
  rest degrade to an explicit "not configured" state instead of an opaque 503.
- Reuses the existing encrypted store, adapter, and set routes — minimal new surface.

### Negative / Limitations

- MFA + IdP editing remain deferred (MFA: small follow-up; IdP: secret-handling pass).
- The readiness probe makes two Keycloak calls; it is only invoked when the Auth section is opened.

### Deferred

- Writable MFA; writable IdP create/update/delete (secret storage + redaction); fully self-service
  credential rotation from the tenant-admin UI; automated credential repair for legacy tenants.

---

## Related ADRs

- ADR-0036 (control plane; read-only auth tabs deferred here), ADR-0037 (provider config),
  ADR-0040 (audit panels), ADR-0030/ADR-ACT-0186 (auth settings API + per-tenant service account),
  ADR-0022 (session/permissions), ADR-0029 (tenant isolation).
- Implementation: ADR-ACT-0209.
