# Evidence: Writable Identity Provider Management with Secret Redaction (ADR-0043 / ADR-ACT-0211)

Source of truth: ACTION-REGISTER row ADR-ACT-0211; decisions in ADR-0043.

## Scope delivered

The **Identity Providers** tab is now safely tenant-admin writable, completing the core writable
auth-settings control plane (Providers + Session + MFA + IdPs). This was a security-first slice because
IdP configuration carries write-only secrets.

- **Fixed a secret-exposure defect**: `GET /api/auth/settings/idps` previously returned the **raw**
  Keycloak instances through a `.passthrough()` schema (full `config`, incl. the masked `clientSecret`).
  It now returns an explicitly-mapped, redacted `IdpSummary[]`.
- **Create / update / disable / delete** for an allowlisted provider set, with strict validation.
- **Secrets are write-only**: submitted on create/update, never returned, logged, or audited.
- A live `proof:auth-idps` run exercises CRUD against Keycloak and cleans up (output below).

## Identity Providers vs Auth Providers (kept separate)

- **Auth Providers** (ADR-0037, Providers tab): which product login options/allowlist a tenant offers.
  **Unchanged.**
- **Identity Providers** (this slice, IdPs tab): Keycloak realm IdP definitions (alias, providerId,
  clientId, secret, URLs, scopes, trustEmail). These are not collapsed into one model.

## IdP model decisions

- **Provider allowlist**: `oidc`, `google`, `microsoft`, `apple`. **SAML and others deferred.**
- **Alias**: `^[a-z0-9][a-z0-9_-]{1,62}$`; **reserved aliases rejected** (`platform`, `platform-realm`,
  `master`, `admin`, `account`, `security-admin-console`, `broker`) so a tenant admin cannot collide
  with platform/system IdPs.
- **URLs**: `http`/`https` only — `javascript:`, `data:`, `file:` rejected. `oidc` requires
  `authorizationUrl` + `tokenUrl`; social providers configure via client id/secret only.
- **Redacted DTO** (`IdpSummary`, `.strict()`): `alias`, `displayName`, `providerId`, `enabled`,
  `trustEmail`, `clientId`, `scopes`, and a derived **`hasClientSecret`** boolean. No raw config, no
  secret. `toIdpSummary` is a pure, unit-tested mapper.

## Secret redaction guarantees

- `clientSecret` is **never returned** to the SPA (explicit DTO mapping, not raw; `hasClientSecret`
  only), **never logged**, and **never audited**.
- **Write-only on update**: a blank/absent `clientSecret` **preserves** the existing secret.
  Implementation: `updateIdentityProvider` reads the existing representation (Keycloak returns the
  secret masked as `**********`), applies the allowed field changes, and PUTs it back — re-sending the
  mask preserves the stored secret (the same round-trip Keycloak's own admin console uses). A non-empty
  secret overwrites.
- The SPA edit form **never prefills** the secret field; it shows "Leave blank to keep the existing
  secret".

## Audit metadata rules

`auth_settings.idp.changed` records only: `operation` (create/update/delete), `alias`, `providerId`,
`enabled`, `clientId`, changed-field **names**, and a `secretChanged` boolean. It **never** includes
`clientSecret`, tokens, credentials, or raw config. Unit-tested for no-secret leakage.

## Readiness / error-classification reuse (no parallel write path)

All mutations go through `mutateAuthSetting` → `classifyRealmError` → `sendAuthSettingsFailure`,
audit-first, tenant context from FQDN/session (never the body), reusing the ADR-0041 readiness model.
`classifyRealmError` gained `conflict` (409, duplicate alias) and `not_found` (404, unknown alias) so
IdP writes return precise codes instead of an opaque 500.

| Method | Path                             | Result                                  |
| ------ | -------------------------------- | --------------------------------------- |
| GET    | `/api/auth/settings/idps`        | redacted `IdpSummary[]`                 |
| POST   | `/api/auth/settings/idps`        | create (201); duplicate alias → 409     |
| PATCH  | `/api/auth/settings/idps/:alias` | update (204); unknown alias → 404       |
| DELETE | `/api/auth/settings/idps/:alias` | delete (204)                            |

## Runtime proof (executed)

`apps/platform-api/scripts/idp-runtime-proof.ts` (npm: `proof:auth-idps`). Command:

```bash
make compose-up-identity
KC_PROOF_REALM=platform npm run proof:auth-idps
```

Executed output (Keycloak 26.2, dev identity profile, realm `platform`, 2026-06-11):

```text
# IdP runtime proof — realm "platform" @ http://localhost:8090/kc

PASS  readiness === ok — got "ok"
PASS  created the temporary IdP
PASS  IdP appears in the redacted list
PASS  summary.hasClientSecret === true
PASS  redacted summary does NOT contain the secret value
PASS  redacted summary has no clientSecret field
PASS  raw clientSecret is masked by Keycloak (not the real value) — got "**********"
PASS  non-secret update applied
PASS  secret still masked after blank-secret update (preserved)
PASS  secret rotation write succeeded
PASS  disable applied
PASS  re-enable applied
PASS  deleted (no longer present)

# ALL CHECKS PASSED
```

This proves, against a live realm: create → redacted list (secret absent, `hasClientSecret` true) →
raw secret masked → non-secret update with blank secret preserves it → secret rotation → disable/enable
→ delete → gone. The temporary IdP is always removed (the create/teardown is idempotent).

## What is proven where (honest layering)

- **Live (`proof:auth-idps`):** IdP create/list/update/rotate/disable/delete + the redaction +
  secret-mask preservation against Keycloak 26.2.
- **node:test:** `toIdpSummary` redaction, `applyUpdate` secret preservation, audit-metadata
  no-secret, request validation (alias/provider/URL) — `idp-management.test.ts` (17); adapter IdP CRUD
  - error classification — `adapters-keycloak.test.ts` (74).
- **MSW integration (`AdminAuthPage.test.tsx`):** create/edit/delete controls, create flow, secret
  field never prefilled, delete confirm, read-only without write, readiness notice, axe (23 total).
- **Not driven in one live HTTP call:** the full BFF route + per-tenant credential store + FQDN
  resolution together (needs a provisioned configured tenant on a tenant FQDN); those layers are
  unit/MSW-tested.

## Tests run (all green)

- `test:platform-api` (405), `test:frontend:run` (127), adapter suite (74), `test:architecture`,
  orchestrator `all --strict`, OpenAPI drift (60 routes), `validate-action-register` (43 ADRs).
- `proof:auth-idps` executed live: ALL CHECKS PASSED (above).

## Known deferrals

- **SAML** IdP management (not modelled safely yet).
- Tenant-admin credential **self-service rotation**; **automated credential repair** for legacy tenants.
- Advanced provider-specific settings; conditional-flow MFA enforcement; WebAuthn factor switching;
  MFA grace period; rich secret-rotation history. The IdP secret can be rotated via update, but a
  dedicated rotation/audit history is out of scope.
