# ADR-0044: Auth Settings Credential Lifecycle — Rotation, Repair, and Operational Recovery

## Status

Accepted

## Date

2026-06-11

## Decision owner

Architecture owner / technical lead

---

## Context

ADR-0041–0043 built the writable auth-settings control plane (Providers, Session, MFA, IdPs), all
backed by a **per-tenant Keycloak realm-admin service-account credential** stored encrypted in
`tenant_auth_settings_credentials`. Provisioning auto-creates that credential for new tenants
(`createAuthSettingsServiceAccount` — a confidential client **in the tenant realm** with
`realm-management` roles), and ADR-0041 added a global operator **attach** endpoint.

What was still deferred: **rotation**, **repair** of legacy/missing credentials, and any visibility of
credential health. Every writable feature depends on this credential being recoverable and safely
rotatable, so this is the right next hardening step.

Investigation also surfaced a **latent correctness bug**. `KeycloakRealmAdminAdapter.getAdminToken`
(and the readiness probe) always requested the token from the **master** realm token endpoint. The
per-tenant service account lives in the **tenant** realm, so its `client_credentials` grant returns
401 against master — verified live: `client_credentials` fails (401) at the master token endpoint and
succeeds (200, and can read `/admin/realms/{realm}`) at the tenant realm endpoint. The plane only
appeared to work in dev because dev seeds via the `admin-cli` **password** grant against master with
full admin. Production per-tenant credentials would never validate. This slice fixes it.

---

## Decision

### Token endpoint per grant type (correctness fix)

`client_credentials` (the per-tenant service-account path) authenticates against **`config.realm`**'s
token endpoint; the `admin-cli` **password** grant (dev/seed) stays on **master**. This makes the
per-tenant credential path actually work and is the foundation everything else in this ADR validates.

### Actor model (explicit)

- **system-admin** (global scope): may **attach**, **rotate**, and **repair** the credential and
  inspect readiness for any tenant.
- **tenant-admin** (tenant scope): may **see readiness** and use the writable auth settings, but
  **never** sees or manages the realm-admin secret. When readiness is not `configured`, the tenant UI
  tells them to contact their system administrator.

Tenant-admin self-service rotation is **deferred** — it cannot be offered without exposing
realm-admin power, and the system-admin path covers operational recovery.

### Lifecycle operations (all = validate-before-store)

`attach`, `rotate`, and `repair` share one safe primitive `applyCredentialLifecycle`:

1. validate `clientId`/`clientSecret` are present;
2. **probe the candidate against the tenant realm** (`probeReadiness`); if not `ok`, return the
   classified status and **do not store** — the existing working credential is **preserved**;
3. emit an **audit event before** the write (no secret);
4. store the credential encrypted, recording lifecycle metadata.

They differ only in intent + audit action: `attach` (first credential, ADR-0041),
`rotate` (replace a working credential), `repair` (restore a missing/broken one for a legacy tenant).
Repair is the **operator-provided** path (operator supplies a client id/secret that the platform
validates then stores). **Automated repair** (platform mints a fresh service-account client) is
**deferred** as higher-risk.

### Lifecycle metadata (migration 017)

`tenant_auth_settings_credentials` gains `last_validated_at`, `last_rotated_at`, `rotated_by`, and
`validation_error_kind` (reserved; NULL on success). A new `getAuthSettingsCredentialMetadata` returns
`clientId` + timestamps + `rotatedBy` — **never the secret**. `readiness_status` is **derived** (live
probe), not stored.

### Endpoints (global, system-admin)

| Method | Path                                                              | Purpose                 |
| ------ | ----------------------------------------------------------------- | ----------------------- |
| GET    | `/api/admin/tenants/:tenantId/auth-settings-credential/readiness` | status + safe metadata  |
| POST   | `/api/admin/tenants/:tenantId/auth-settings-credential/rotate`    | rotate (validate→store) |
| POST   | `/api/admin/tenants/:tenantId/auth-settings-credential/repair`    | repair (validate→store) |

The ADR-0041 attach endpoint (`POST /api/admin/tenants/auth-settings-credential`, organisationId in
body) is retained. For these routes the **tenant comes from the path** and the permission is
**global** (`platform.tenants.create`); the request body carries only `clientId`/`clientSecret` and can
never confer tenant authority. The readiness model vocabulary is unchanged (`configured`,
`missing_credential`, `invalid_credential`, `forbidden_realm_operation`, `realm_unreachable`).

### Security

Secret is write-only: never returned to the SPA, never logged, never audited, never in MSW fixtures,
encrypted at rest (`TENANT_SECRET_ENCRYPTION_KEY`; documented dev fallback). Audit metadata carries
`organisationId`, `realm`, `clientId`, `operation`, and the `readiness` result only. A failed
validation never replaces the working credential and never echoes the secret. Unit tests assert
serialised audit events and error payloads contain no secret.

### Runtime proof

`npm run proof:auth-credential-lifecycle` creates a **real tenant-realm service account** in a live
Keycloak realm (with `realm-management` roles), validates it via the adapter's per-tenant
`client_credentials` path, rotates through `applyCredentialLifecycle` (proving validate-before-store
and preserve-on-failure), performs a real MFA/session write + read-back with the rotated credential,
checks invalid-credential classification, and deletes the temporary client — asserting no secret is
ever printed.

---

## Consequences

### Positive

- Per-tenant credentials now actually authenticate (token-realm fix), and are rotatable/repairable
  with validation, audit, and no-secret guarantees. Operational recovery is explicit.

### Negative / Limitations

- Tenant-admin self-service rotation and automated repair are deferred. Lifecycle metadata is
  application-level; `validation_error_kind` is reserved for a future failure-history surface.

### Deferred

- Tenant-admin self-service rotation; automated (platform-minted) repair; a system-admin credential
  **UI** (this slice is API-first for the lifecycle); SAML IdP management; rich secret-rotation history;
  KMS-backed secret storage.

---

## Related ADRs

- ADR-0041 (credential substrate, readiness, attach — extended here), ADR-0042 (MFA + runtime-proof
  pattern), ADR-0043 (IdP redaction), ADR-ACT-0186 (per-tenant service account), ADR-0029 (tenant
  isolation), ADR-0031 (provisioning privilege).
- Implementation: ADR-ACT-0212.
