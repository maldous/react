# Evidence: Per-tenant Auth Settings Credential Provisioning (ADR-0041 / ADR-ACT-0209)

Source of truth: ACTION-REGISTER row ADR-ACT-0209; decisions in ADR-0041.

## Scope delivered

ADR-0036 left the `/admin/auth` IdPs, MFA, and Session tabs **read-only** because editing mutates the
tenant's Keycloak realm through a per-tenant realm-admin **service-account credential** whose
provisioning + UI awareness were deferred. This slice delivers the readiness/classification substrate
and makes **Session policy** the first safely-writable Auth tab.

- **Readiness probe + endpoint** so the UI can distinguish: `configured` / `missing_credential` /
  `invalid_credential` / `forbidden_realm_operation` / `realm_unreachable`.
- **Write-error classification** on the mfa/session set routes (no more opaque 500).
- **Operator-seeded attach/validate** path for tenants that predate automated provisioning.
- **Writable Session tab** gated on readiness; **MFA and IdPs stay read-only**.

## Automated vs operator-seeded (explicit — not hand-waved)

- **Automated:** `apps/platform-api/src/server/provisioning.ts` step 4 (`provisionIdentity` →
  `setAuthSettingsCredential`) **already creates** the per-tenant realm-admin service-account credential
  during tenant creation. **New tenants are `configured` with no operator action.**
- **Operator-seeded:** `POST /api/admin/tenants/auth-settings-credential` (system-admin, **global**
  scope, `platform.tenants.create`) attaches/rotates a credential for an **existing/legacy** tenant.
  It **validates the credential against the realm (readiness probe) BEFORE storing** — a credential
  that cannot reach the realm is never persisted.
- **Deferred (documented in ADR-0041):** self-service credential rotation from the tenant-admin UI;
  automated credential *repair* for legacy tenants; writable MFA; writable IdP create/update (secret
  storage + redaction pass).

## Readiness model

`GET /api/auth/settings/readiness` (tenant-scoped, `tenant.auth.settings.read`). The probe lives on
`RealmAdminPort.probeReadiness()` (impl: `KeycloakRealmAdminAdapter`): a service-account token grant +
a single realm read, **classified by HTTP status at the source — never by message parsing**.

| Probe result (port) | HTTP signal                                   | Readiness status            |
| ------------------- | --------------------------------------------- | --------------------------- |
| `ok`                | token grant 200 + realm read 200              | `configured`                |
| (no credential)     | — (store returns null, no probe)              | `missing_credential`        |
| `invalid_credential`| token grant 400/401, or realm read 401        | `invalid_credential`        |
| `forbidden`         | token 403, or realm read 403                  | `forbidden_realm_operation` |
| `unreachable`       | 5xx / transport error                         | `realm_unreachable`         |

## Write-error classification

`classifyRealmError` (`usecases/realm-error.ts`) maps a thrown adapter error to the same vocabulary;
`mutateAuthSetting` returns the classified kind and `sendAuthSettingsFailure` maps it to HTTP:

| Result kind                 | HTTP | code                        |
| --------------------------- | ---- | --------------------------- |
| `invalid_body`              | 400  | `VALIDATION_ERROR`          |
| `no_tenant`                 | 400  | `NO_TENANT`                 |
| `no_credential`             | 503  | `NO_CREDENTIAL`             |
| `invalid_credential`        | 502  | `INVALID_CREDENTIAL`        |
| `realm_unreachable`         | 502  | `REALM_UNREACHABLE`         |
| `forbidden_realm_operation` | 403  | `FORBIDDEN_REALM_OPERATION` |

An **unclassifiable** error is rethrown so it still surfaces as a 500 — we never invent a friendlier
status than the failure warrants. Writes remain **audit-first** (the attempt is audited before the
realm call); classification only changes how a post-audit failure is reported.

## Security (verbatim requirements honoured)

- **Credentials never reach the SPA, logs, or audit metadata.** The attach audit records the
  `clientId` only; the secret is write-only. Unit test asserts the serialised audit event contains the
  clientId and **not** the secret.
- The client secret is **encrypted at rest** (`token-crypto`, `TENANT_SECRET_ENCRYPTION_KEY`;
  `tenant_auth_settings_credentials.client_secret_enc`). Local-dev fallback key documented in
  `.env.example`.
- **Tenant context comes from FQDN/session, never the request body.** The tenant readiness/mutation
  routes derive `organisationId`/`realmName` from `resolveTenantFromRequest`. The credential is keyed
  by `organisation_id`; a tenant cannot mutate another tenant's realm.
- The **system-admin attach path is separate**: global scope + `platform.tenants.create`, distinct from
  the tenant-admin `tenant.auth.settings.write` mutation path. It derives the realm deterministically
  (`tenant-${organisationId}`), never from the body.

## UI

`/admin/auth` → **Session** tab (`AdminAuthPage.tsx`):

- `useAuthReadiness()` gates editing: the RHF + Zod form renders only when `status === "configured"`
  **and** the user has `tenant.auth.settings.write`. Otherwise a precise readiness notice
  (`auth-session-readiness`) or read-only view (`auth-session-readonly`) is shown.
- Save → `PATCH /api/auth/settings/session`; `LiveRegion` announces success; the contextual audit panel
  (filtered to `auth_settings.session.changed` via the new `action` prop) refreshes.
- **MFA and Identity Providers tabs remain read-only.**

## Tests run (all green)

- **Backend** `apps/platform-api/tests/unit/auth-settings-readiness.test.ts` (15): readiness
  missing-credential short-circuit + each probe→status mapping; realm passed (not a body value) to the
  probe; `classifyRealmError` status/transport/unknown; `mutateAuthSetting` realm-failure
  classification (audit still emitted) + unknown rethrow; `attachAuthSettingsCredential` validate-
  before-store, **no-secret-in-audit**, no-store on validation failure, empty-body rejection.
- **Adapter** `packages/adapters-keycloak/tests/adapters-keycloak.test.ts` (+5): `probeReadiness` ok /
  invalid (401) / forbidden (403) / unreachable (5xx) / transport failure.
- **Frontend** `AdminAuthPage.test.tsx` (+5): editable form when configured; save announces success;
  readiness notice + no form when `missing_credential`; read-only for users without write; axe clean.
- **Suites:** `test:platform-api` (388 pass), `test:frontend:run` (115 pass), `test:architecture`,
  orchestrator `all --strict`, OpenAPI drift (58 routes), contract-drift + ADR-governance validators.

## Known deferrals (see ADR-0041)

Writable MFA (small follow-up); writable IdP create/update/delete (secret storage + redaction);
self-service credential rotation from the tenant-admin UI; automated credential repair for legacy
tenants. The readiness endpoint surfaces `missing_credential` so an operator knows to use the attach
endpoint meanwhile.
