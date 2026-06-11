# Evidence: Auth Settings Credential Lifecycle (ADR-0044 / ADR-ACT-0212)

Source of truth: ACTION-REGISTER row ADR-ACT-0212; decisions in ADR-0044.

## Scope delivered

Hardens the operational lifecycle of the per-tenant Keycloak realm-admin credential that backs the
writable auth-settings plane (Providers/Session/MFA/IdPs): credential health, rotation, repair, and
recovery are now explicit, validated, audited, and no-secret — and the credential path actually works
in production.

- **Fixed a latent correctness bug** (token realm): the per-tenant `client_credentials` grant now
  authenticates against the **tenant** realm, not master.
- **applyCredentialLifecycle** (attach/rotate/repair): one validate-before-store primitive.
- **Lifecycle metadata** (migration 017) + a secret-free metadata read.
- **System-admin lifecycle routes** (readiness/rotate/repair), tenant-from-path + global permission.
- **Tenant-admin readiness-only** UI copy (contact your system administrator).
- A live `proof:auth-credential-lifecycle` run with a **real tenant-realm service account**.

## The token-realm fix (foundational)

`KeycloakRealmAdminAdapter.getAdminToken`/`probeReadiness` always requested the token from the
**master** realm. But the per-tenant auth-settings service account is a client **in the tenant realm**
(`createAuthSettingsServiceAccount`). Verified live: `client_credentials` returns **401 at the master**
token endpoint and **200 at the tenant** endpoint (and the token can read `/admin/realms/{realm}`). The
plane only appeared to work in dev because dev seeds via the `admin-cli` **password** grant against
master with full admin. Fix: `tokenRealm()` → `client_credentials` uses `config.realm`; the admin-cli
password grant stays on master. The runtime proof now exercises the real per-tenant path.

## Actor model (system-admin vs tenant-admin)

- **system-admin** (global scope, `platform.tenants.*`): attach, rotate, repair, and inspect readiness
  for any tenant.
- **tenant-admin** (tenant scope): sees readiness and uses the writable settings; **never** sees or
  manages the realm-admin secret. Not-`configured` readiness now tells them to contact their system
  administrator.

Tenant-admin self-service rotation is **deferred** (can't be offered without exposing realm-admin
power). A system-admin credential **UI** is deferred — this slice is **API-first** for the lifecycle.

## Rotation / repair model

`attach`/`rotate`/`repair` share `applyCredentialLifecycle`: validate the candidate against the tenant
realm (`probeReadiness`); **store only on `ok`**; on any failure return the classified status and
**preserve** the existing credential (nothing written); **audit before** the write. They differ only in
the audit action (`auth_settings.credential.{attached,rotated,repaired}`) + `operation` metadata.
Repair is the **operator-provided** path; **automated repair** (platform-minted client) is deferred.

| Method | Path                                                              | Result                            |
| ------ | ----------------------------------------------------------------- | --------------------------------- |
| GET    | `/api/admin/tenants/:tenantId/auth-settings-credential/readiness` | status + secret-free metadata     |
| POST   | `/api/admin/tenants/:tenantId/auth-settings-credential/rotate`    | 204; bad cred → 502/422; preserve |
| POST   | `/api/admin/tenants/:tenantId/auth-settings-credential/repair`    | 204; bad cred → 502/422; preserve |
| POST   | `/api/admin/tenants/auth-settings-credential` (ADR-0041)          | attach (organisationId in body)   |

`tenantId` comes from the URL path; permission is global; the body is strict `{clientId, clientSecret}`
and can never carry tenant authority (unit-tested). Readiness vocabulary is unchanged (ADR-0041).

## Data model (migration 017)

`tenant_auth_settings_credentials` gains `last_validated_at`, `last_rotated_at`, `rotated_by`,
`validation_error_kind` (reserved; NULL on success). `getAuthSettingsCredentialMetadata` returns
`clientId` + timestamps + `rotatedBy` — the **secret column is never selected**. `readiness_status` is
**derived** from a live probe, never stored.

## Security guarantees

Secret is write-only: never returned to the SPA, never logged, never audited (audit carries
`organisationId`/`realm`/`clientId`/`operation`/`readiness` only), never in MSW fixtures, encrypted at
rest (`TENANT_SECRET_ENCRYPTION_KEY`, documented dev fallback). A failed validation never replaces the
working credential and never echoes the secret. Unit tests assert serialised audit events contain no
secret; the metadata read omits the secret column.

## Runtime proof (executed)

`apps/platform-api/scripts/credential-lifecycle-runtime-proof.ts` (npm:
`proof:auth-credential-lifecycle`). Command:

```bash
make compose-up-identity
KC_PROOF_REALM=platform npm run proof:auth-credential-lifecycle
```

Executed output (Keycloak 26.2, dev identity profile, realm `platform`, 2026-06-11):

```text
# Credential lifecycle runtime proof — realm "platform" @ http://localhost:8090/kc

  minted a throwaway tenant-realm service account

PASS  per-tenant client_credentials readiness === ok — got "ok"
PASS  invalid secret is classified (not ok) — got "invalid_credential"
PASS  rotate (valid) → configured — got "configured"
PASS  rotated credential stored with validated metadata
PASS  rotate (invalid) → not configured — got "invalid_credential"
PASS  existing credential PRESERVED after failed rotate
PASS  rotated credential performs a real MFA write

  deleted the throwaway service account

# ALL CHECKS PASSED
```

This mints a **real tenant-realm service account** (realm-management role), validates it via the
adapter's **per-tenant `client_credentials`** path (proving the token-realm fix), rotates it through
the real `applyCredentialLifecycle` with an in-memory store (validate-before-store; an invalid
candidate is classified and the prior credential is preserved), and uses the rotated credential for a
real MFA write + read-back — then deletes the throwaway client. The secret is never printed.

## What is proven where (honest layering)

- **Live (`proof:auth-credential-lifecycle`):** the per-tenant `client_credentials`/tenant-realm token
  path, readiness classification (ok + invalid_credential), validate-before-store + preserve-on-failure
  via the real usecase, and a real MFA realm write with the rotated credential.
- **node:test:** lifecycle usecase (rotate/repair audit actions, preserve-on-failure, no-secret audit,
  metadata passed to store, empty-secret rejection), body-strictness (no tenant authority in body),
  token-realm-per-grant adapter test.
- **Not driven in one live call:** the full BFF HTTP route + Postgres metadata persistence together
  (the live proof uses an in-memory store so it needs no DB; the SQL is exercised by provisioning and
  the route in a running stack). Route permission/global-scope is enforced by the pipeline.

## Tests run (all green)

- `test:platform-api`, `test:frontend:run` (127), adapter suite (76), `test:architecture`,
  orchestrator `all --strict`, OpenAPI drift (63 routes), `validate-action-register` (44 ADRs).
- `proof:auth-credential-lifecycle` executed live: ALL CHECKS PASSED (above).

## Known deferrals

Tenant-admin self-service rotation; automated (platform-minted) repair; a system-admin credential UI;
`validation_error_kind` failure-history surface; SAML IdP management; rich secret-rotation history;
KMS-backed secret storage.
