# ADR-0043: Writable Identity Provider Management with Secret Redaction

## Status

Accepted

## Date

2026-06-11

## Decision owner

Architecture owner / technical lead

---

## Context

ADR-0036 left the `/admin/auth` **Identity Providers** tab read-only because IdP configuration carries
**write-only secrets** (`clientSecret`). ADR-0041 (Session) and ADR-0042 (MFA) proved the per-tenant
auth-settings credential substrate end to end against a live realm. IdP management is the remaining,
largest tenant-admin capability gap.

Investigation surfaced a concrete **secret-exposure defect** to fix as part of this slice: the existing
`GET /api/auth/settings/idps` returns `adapter.listIdentityProviders()` — the **raw** Keycloak
identity-provider instances — through an `IdpSummary` schema declared `.passthrough()`. The raw
representation includes `config` (clientId, URLs, and `clientSecret`). Keycloak does mask `clientSecret`
as `**********` on read, but the SPA must never depend on an upstream mask: the contract leaks the full
config shape and any future non-masked field.

Two related concepts must stay separate (they were kept separate here):

- **Auth Providers config** (ADR-0037): which product login options/allowlist a tenant offers. Managed
  by the **Providers** tab. Unchanged.
- **Identity Providers**: Keycloak realm IdP definitions (alias, providerId, clientId, secret, URLs,
  scopes, trustEmail). Managed by the **IdPs** tab. This ADR.

---

## Decision

Make the **IdPs tab** safely tenant-admin writable, reusing the ADR-0041 substrate, with a
**security-first** model: explicit DTO mapping, write-only secrets, a constrained provider allowlist,
and strict input validation.

### Explicit, redacted DTO (never raw)

`GET /api/auth/settings/idps` returns an explicitly-mapped `IdpSummary[]` — **no passthrough, no raw
Keycloak config**. Mapped fields: `alias`, `displayName`, `providerId`, `enabled`, `trustEmail`,
`clientId`, `scopes`, and a derived **`hasClientSecret`** boolean (true when `config.clientSecret` is
present/non-empty). The secret value is **never** included. The mapping is a pure function
(`toIdpSummary`), unit-tested for no-secret leakage.

### Write-only secrets

- `clientSecret` may be **submitted** on create/update; it is **never returned, logged, or audited**.
- On **update**, a blank/absent `clientSecret` **preserves** the existing secret. Implementation:
  `updateIdentityProvider` GETs the existing representation (Keycloak returns `clientSecret` as the
  mask `**********`), applies the allowed field changes, and PUTs it back — keeping the mask when no new
  secret is supplied. Re-sending the mask preserves the stored secret (the same secret-mask round-trip
  Keycloak's own admin console relies on). A supplied secret overwrites it.

### Provider allowlist + validation

- `providerId` allowlist: **`oidc`, `google`, `microsoft`, `apple`**. SAML and other providers are
  **deferred** (not modelled safely yet).
- `alias`: strict `^[a-z0-9][a-z0-9_-]{1,62}$`; **reserved aliases rejected** (`platform`,
  `platform-realm`, `master`, `admin`, `account`, `security-admin-console`, `broker`) so a tenant admin
  cannot collide with platform/system aliases.
- For `oidc`, `authorizationUrl` + `tokenUrl` are **required**; social providers configure via
  client id/secret only. All URLs must be `http`/`https` — `javascript:`, `data:`, `file:` and other
  schemes are rejected.

### Routes (existing auth-settings boundary)

| Method | Path                             | Permission                   | Purpose                        |
| ------ | -------------------------------- | ---------------------------- | ------------------------------ |
| GET    | `/api/auth/settings/idps`        | `tenant.auth.settings.read`  | redacted list                  |
| POST   | `/api/auth/settings/idps`        | `tenant.auth.settings.write` | create                         |
| PATCH  | `/api/auth/settings/idps/:alias` | `tenant.auth.settings.write` | update (secret blank→preserve) |
| DELETE | `/api/auth/settings/idps/:alias` | `tenant.auth.settings.write` | delete                         |

`enabled` is toggled via PATCH. **No parallel write path**: all mutations go through
`mutateAuthSetting` → `classifyRealmError` → `sendAuthSettingsFailure`, are **audit-first**, derive
tenant context from FQDN/session (never the body), and reuse the readiness classification.

### Audit metadata

`auth_settings.idp.changed` records only safe fields: `alias`, `providerId`, `enabled`, changed field
**names**, and `clientId`. It **never** includes `clientSecret`, tokens, credentials, or the raw
config. Unit-tested against secret leakage.

### UI (constrained first cut)

The IdPs tab mirrors Session/MFA readiness gating: non-`configured` → precise notice; no write
permission → read-only list. When configured + write: list, create dialog, edit dialog, enable/disable,
delete-with-confirm. The secret field is **blank on edit** with helper text "Leave blank to keep the
existing secret"; the existing secret is never displayed. `LiveRegion` announces mutations; the
contextual audit panel (filtered to `auth_settings.idp.changed`) refreshes. No dynamic form builder.

### Runtime proof

`npm run proof:auth-idps` creates a temporary IdP in a live realm, lists/reads it back (asserting the
secret is never present in the redacted output), updates a non-secret field, updates the secret,
disables/enables, deletes it, and cleans up — proving create/read/update/delete against live Keycloak.

---

## Consequences

### Positive

- Completes the core writable auth-settings control plane (Providers + Session + MFA + IdPs).
- Closes the raw-config/secret-exposure defect with explicit redacted DTO mapping.

### Negative / Limitations

- SAML and non-allowlisted providers deferred. The first UI is intentionally constrained (no advanced
  per-provider settings). Blank-secret preservation relies on Keycloak's secret-mask round-trip.

### Deferred

- SAML IdP management; tenant-admin credential self-service rotation; automated credential repair;
  advanced provider-specific settings; conditional-flow MFA enforcement; WebAuthn factor switching;
  grace period; rich secret-rotation history.

---

## Related ADRs

- ADR-0041 (credential substrate, readiness — reused), ADR-0042 (writable MFA + runtime proof pattern),
  ADR-0037 (product provider allowlist — kept separate), ADR-0040 (audit panels), ADR-0022 (SSO/IdP
  boundary), ADR-0029 (tenant isolation).
- Implementation: ADR-ACT-0211.
