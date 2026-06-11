# Evidence: Writable MFA Policy + Auth Settings Runtime Proof (ADR-0042 / ADR-ACT-0210)

Source of truth: ACTION-REGISTER row ADR-ACT-0210; decisions in ADR-0042.

## Scope delivered

MFA becomes the **second writable Auth tab**, reusing the ADR-0041 credential/readiness/
classification/audit substrate verbatim, and the ADR-0041 caveat (no live realm round-trip) is closed
with an **executed** proof against a running Keycloak.

- Corrected the defective Keycloak MFA mapping to a faithful **realm required-actions** mapping.
- Made the `/admin/auth` **MFA tab** readiness-gated and writable for the `required` level.
- Added a repeatable runtime-proof script and **ran it live** (output below).
- **IdPs remain read-only.** WebAuthn factor-type switching and `gracePeriodSeconds` remain deferred.

## MFA mapping decisions (and limitations)

The prior adapter wrote `required` (`none|optional|required`) into the realm `otpPolicyType` field —
Keycloak's OTP *algorithm* (`totp|hotp`), not a requirement level — so it neither enforced MFA nor
round-tripped. It now maps onto realm **required-actions**:

| `required` | required-action (`enabled`, `defaultAction`) |
| ---------- | -------------------------------------------- |
| `required` | `true`, `true`                               |
| `optional` | `true`, `false`                              |
| `none`     | `false`, `false`                             |

`type` selects the alias (`totp` → `CONFIGURE_TOTP`, `webauthn` → `webauthn-register`).
`setMfaPolicy` GETs the full required-action representation and PUTs it back with only
`enabled`/`defaultAction` changed. `getMfaPolicy` reads both aliases and reports the
stronger-enforced factor (ties → TOTP).

**Documented limitations (see ADR-0042):**

- "required" = a **default required-action** (every new user is prompted to configure the factor), not
  a hard conditional-flow OTP gate. Full conditional-flow enforcement is deferred.
- **`type` is read-only (TOTP) in the UI** this slice; WebAuthn factor-type switching needs its own
  pass. `gracePeriodSeconds` is part of the contract but not represented by a required-action, so it is
  not mutated or displayed here. Both deferred.

## Readiness / write-error / audit reuse (no parallel path)

The backend write path is unchanged from ADR-0041: `mutateAuthSetting` → `classifyRealmError` →
`sendAuthSettingsFailure`, audit-first, tenant context from FQDN/session (never the body), secrets
never logged or audited. Only the adapter's Keycloak mapping changed. `auth_settings.mfa.changed`
(`AuditAction.AuthSettingsMfaChanged`) is reused. The MFA tab mirrors the Session tab: readiness gate,
RHF + Zod form, `LiveRegion` success, contextual audit panel filtered to `auth_settings.mfa.changed`
refreshed on save.

## Security guarantees

- Credential/secret never reaches the SPA, logs, or audit metadata (unit-asserted in ADR-ACT-0209;
  unchanged here). The runtime-proof script never prints secrets.
- The adapter mutates **only the realm resolved from request context**; the proof script targets one
  explicit realm and restores it.

## Runtime proof method (executed)

`apps/platform-api/scripts/auth-settings-runtime-proof.ts` (npm: `proof:auth-settings`) builds
`KeycloakRealmAdminAdapter` against a running Keycloak and exercises the real
**RealmAdminPort → Keycloak → read-back** path + the readiness classifier, restoring all mutated state.

Command:

```bash
make compose-up-identity
KC_PROOF_REALM=platform npm run proof:auth-settings
```

Executed output (Keycloak 26.2, dev identity profile, realm `platform`, 2026-06-11):

```
# Auth Settings runtime proof — realm "platform" @ http://localhost:8090/kc

PASS  readiness (valid credentials) === ok — got "ok"
PASS  readiness (bad credential) is classified, not ok — got "invalid_credential"
  MFA original: required=optional type=totp
PASS  MFA write required → read-back required
PASS  MFA write optional → read-back optional
PASS  MFA restored to original
  Session original: accessTokenLifespan=900s
PASS  Session write → read-back reflects new access-token lifespan — got 600s
PASS  Session restored to original

# ALL CHECKS PASSED
```

This proves, against a live realm: readiness classification (`ok` for valid creds,
`invalid_credential` for a bad client secret), the corrected MFA mapping round-trips
(`optional → required → optional`), and the Session write round-trips — each restored afterward.

## What is proven where (honest layering)

- **Live (this script):** credential→realm reachability + readiness classification; MFA + Session
  write → Keycloak → read-back; the new required-actions mapping.
- **node:test:** `mutateAuthSetting` audit-first ordering, write-error classification, no-secret-in-
  audit, body validation (`auth-settings-readiness.test.ts`, `auth-settings-audit.test.ts`); adapter
  mapping matrix (`adapters-keycloak.test.ts`).
- **MSW integration (`AdminAuthPage.test.tsx`):** MFA/Session form gating, save, readiness notice,
  read-only, axe.
- **Not driven in the same live script:** the full BFF HTTP route + per-tenant credential-store +
  FQDN resolution in one live call (would require a provisioned configured tenant on a tenant FQDN);
  those layers are unit/MSW-tested. The realm-write confidence gap from ADR-0041 is now closed.

## Tests run (all green)

- `test:platform-api` (388+), `test:frontend:run` (120), adapter suite (68), `test:architecture`,
  orchestrator `all --strict`, OpenAPI drift, `validate-action-register` (42 ADRs).
- `proof:auth-settings` executed live: ALL CHECKS PASSED (above).

## Known deferrals

Writable IdP create/update/delete + secret storage/redaction; tenant-admin credential self-service
rotation; automated credential repair for legacy tenants; conditional-flow MFA enforcement; editable
factor type (WebAuthn) + grace period. The MFA tab surfaces non-`configured` readiness precisely, as
Session does.
