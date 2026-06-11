# OIDC Enterprise Hardening — Evidence (ADR-0046 / ADR-ACT-0215)

Date: 2026-06-12. Owner: Architecture owner / technical lead.
AI assistance: Claude Opus 4.8 (implementation), human-reviewed.

## Scope delivered

Made tenant OIDC IdP configuration enterprise-ready, honest, testable, and visible
in `/admin/readiness`, on top of the writable + secret-safe baseline (ADR-0043).

- BFF-mediated **discovery import**: `POST /api/auth/settings/idps/oidc/discover`
  fetches the issuer/discovery URL with a hard timeout (5s), a response size cap
  (256 KiB), and an HTTPS-only-outside-local scheme policy, then returns a minimal
  redacted projection (`issuer`, `authorizationEndpoint`, `tokenEndpoint`,
  `userInfoEndpoint`, `jwksUri`) plus a classified validation. The raw discovery
  document is never returned.
- **Issuer validation**: the discovery `issuer` must match the requested issuer
  (insignificant trailing slash aside), else `issuer_mismatch`.
- **JWKS validation**: the `jwks_uri` is fetched and must yield ≥1 usable key,
  else `jwks_invalid`.
- **Callback URL display**: `GET /api/auth/settings/idps/:alias/callback-url`
  derives the brokered callback URL from the tenant realm + alias (FQDN-resolved).
- **Test connection**: `POST /api/auth/settings/idps/:alias/test-connection`
  re-validates the stored issuer's discovery + JWKS, audit-records the classified
  result, and returns `ok` / `issuer_mismatch` / `jwks_invalid` / `unreachable` /
  `not_configured`. This is a non-interactive probe, NOT a login simulation.
- **Claim / group-role mapping**: `GET` + `PATCH
  /api/auth/settings/idps/:alias/mapping` store a bounded, typed mapping config as
  Keycloak IdP mappers (`oidc-user-attribute-idp-mapper`, `oidc-role-idp-mapper`).
  Only `oidc-ent:`-prefixed mappers are reconciled, so hand-authored mappers are
  never touched. Role targets are allowlisted to the tenant roles.
- **UI**: the `/admin/auth` IdPs tab gains a discovery import form, a callback URL
  display with copy, a per-IdP test-connection action with a `LiveRegion`-announced
  result, and a mapping editor. Secrets remain write-only and never prefilled.

## Decisions

- The BFF fetches discovery itself (not Keycloak `import-config`) so timeout, size
  cap, scheme policy, and issuer/JWKS classification stay in our testable code at
  the existing redaction boundary.
- Mapping role targets are restricted to `TENANT_ROLES`, so a tenant admin cannot
  grant an arbitrary/privileged realm role via an upstream claim.
- All mutation + test paths reuse the audit-first discipline; tenant authority is
  resolved from FQDN/session only.

## Tests run (with proof layer)

- `node:test` (platform-api) — `oidc-discovery.test.ts` + `oidc-mapping.test.ts`
  (34 assertions): URL/scheme policy, discovery success, issuer mismatch, invalid
  JWKS, unreachable, invalid document, callback derivation, test-connection
  success/not_configured/not_found, mapping converters round-trip, audit-first
  ordering, mapping reconcile, bounded/allowlisted validation, classified failures.
- `node:test` — `capability-registry.test.ts` updated: OIDC sub-capabilities carry
  honest statuses; the never-fake-readiness guard now pins `oidc_login_simulation`
  and the mapping caps to `deferred`.
- Vitest (frontend) — `IdpManager.oidc.test.tsx` (7, MSW-proven): discovery import
  fills endpoints, callback display, classified test result, mapping validation +
  save, secret never prefilled, read-only mode, and an axe accessibility pass.
- OpenAPI drift: 69 routes match `docs/api/openapi.json` (5 new paths documented).

## Runtime proof (executed)

`apps/platform-api/scripts/oidc-enterprise-runtime-proof.ts`
(`npm run proof:auth-oidc-enterprise`). Uses the local Keycloak realm as a real,
reachable OIDC provider. Command:

```bash
make compose-up-identity
KC_PROOF_REALM=platform npm run proof:auth-oidc-enterprise
```

Executed output (Keycloak 26.2, dev identity profile, realm `platform`, 2026-06-12):

```text
# OIDC enterprise runtime proof — realm "platform" @ http://localhost:8090/kc

PASS  discovery import ok
PASS  issuer validated
PASS  JWKS usable (≥1 key) — keys=2
PASS  metadata returned (no raw document)
PASS  issuer mismatch classified
PASS  unreachable classified
PASS  non-discovery JSON classified invalid_document
PASS  callback URL derived — http://localhost:8090/kc/realms/platform/broker/proof-oidc-enterprise-temp/endpoint
PASS  test-connection ok against the configured issuer — ok
PASS  temporary IdP cleaned up

# ALL CHECKS PASSED
```

## Proven live vs unit/MSW only

- Live-proven (against Keycloak): discovery import, issuer validation, JWKS
  validation, classification (mismatch/unreachable/invalid_document), callback URL,
  and test-connection (create temp IdP → probe → cleanup).
- Unit-proven (`node:test`): all classification branches + mapping converters +
  audit-first ordering + bounded/allowlisted validation.
- MSW-proven (frontend): the IdPs tab discovery/callback/test/mapping flows + axe.
- Claim/group-role mapping APPLICATION to Keycloak is unit-proven; it is NOT yet
  proven through a real brokered login (hence `partial`).

## Capability map changes

- `oidc_discovery`, `oidc_issuer_validation`, `oidc_jwks_validation`,
  `oidc_callback_display`, `oidc_test_connection` → `implemented` (invariant-ready;
  the live validation runs on demand and is unit + runtime proven).
- `oidc_claim_mapping`, `oidc_group_role_mapping` → `partial`, readiness stays
  `deferred` (configured, not login-exercised — never faked).
- `oidc_login_simulation` → stays `deferred` (no honest non-interactive proof).

## Known deferrals

- Login simulation: no honest, non-interactive end-to-end upstream login proof
  exists in this slice.
- Claim/group-role mapping is not yet verified through a real brokered login.
- SAML remains out of scope.

## No-secret / no-fake-readiness guarantees

- No client secret or raw discovery/JWKS document appears in any response, log,
  audit metadata, or this evidence file. Audit events for test-connection and
  mapping carry only the alias, a classified result, and counts.
- Outbound discovery/JWKS fetches are bounded (timeout + size cap) and HTTPS-only
  outside local/dev hosts.
- Readiness is never faked: deferred capabilities (login simulation + mapping)
  stay `deferred` under all signals, asserted by `capability-registry.test.ts`.

## ACTION-REGISTER linkage

ADR-ACT-0215 (Source ADR-0046). Evidence: this file.
