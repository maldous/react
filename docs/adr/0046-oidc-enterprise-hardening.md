# ADR-0046: OIDC Enterprise Hardening

## Status

Accepted

## Date

2026-06-12

## Decision owner

Architecture owner / technical lead

## Consulted

ADR-0030 (auth-settings BFF boundary), ADR-0037 (tenant auth provider login allowlist),
ADR-0041 (per-tenant auth-settings credential), ADR-0043 (writable IdP management +
secret redaction), ADR-0044 (system-admin credential provisioning), ADR-0045 (enterprise
tenant onboarding + control-plane capability map). Claude Opus 4.8 (implementation
assistance, human-reviewed).

## Context

ADR-0043 made tenant OIDC identity-provider configuration writable and secret-safe, but
it is still basic: an operator manually types `authorizationUrl`, `tokenUrl`,
`userInfoUrl`, and `issuer`, with no validation that those endpoints belong together, are
reachable, or are correct. The ADR-0045 capability map lists the OIDC enterprise
sub-capabilities (`oidc_discovery`, `oidc_issuer_validation`, `oidc_jwks_validation`,
`oidc_claim_mapping`, `oidc_group_role_mapping`, `oidc_test_connection`,
`oidc_callback_display`, `oidc_login_simulation`) as **deferred** so the gap is visible.
ADR-0045 explicitly named OIDC enterprise hardening as the highest-value next slice.

What triggered the decision: enterprise customers expect to paste a discovery URL (or
issuer), have the endpoints auto-filled and validated, see the exact callback/redirect URL
to register with their IdP, and run a connection test before going live — without anyone
ever seeing a client secret and without the platform pretending an unverified provider is
"ready".

Constraints and risks:

- Discovery import performs **outbound HTTP to operator-supplied URLs** — SSRF, slowloris,
  oversized-body, and non-TLS risks must be contained (timeout, size cap, scheme policy).
- The SPA must never receive the raw Keycloak IdP representation or a client secret
  (ADR-0043), and discovery/JWKS documents must be reduced to a minimal redacted DTO.
- Tenant authority must come from the FQDN/session, never the request body (ADR-0029/0030).
- Readiness must remain honest (ADR-0045): a capability is `ready` only via a live check or
  a documented invariant. A real end-to-end login simulation cannot be honestly proven in
  this slice, so it must stay deferred.
- SAML remains out of scope.

## Stakeholder concerns

- Product: paste-a-URL onboarding, visible callback URL, a "test connection" affordance.
- Engineering: reuse the ADR-0043 audit-first mutation + redaction pipeline; no new bypass.
- Security: no secret/token/discovery-document leakage to response/log/audit/evidence;
  bounded outbound fetch; HTTPS-only outside local/dev; SSRF-aware classification.
- Operations: network/upstream failures classified (4xx/5xx/timeout), never bare 500s.
- Data: claim/group-role mapping config bounded and typed; no arbitrary attribute writes.
- Users/customers: provider configured correctly the first time; honest readiness signals.
- Compliance/governance: capability map + ACTION-REGISTER + evidence stay in lock-step.
- Support: a deterministic runtime proof for the discovery/issuer/JWKS/callback/test path.

## Decision drivers

- Honesty of readiness (no faking) above feature breadth.
- Reuse of the existing auth-settings boundary, permission model, and redaction pipeline.
- Containment of outbound HTTP risk.
- Strict, no-passthrough contracts at the SPA boundary.
- Deterministic, repeatable proof against mock-oidc / local Keycloak.

## Options considered

### Option A: BFF-mediated discovery + validation + connection test (chosen)

The BFF fetches discovery itself (bounded fetch), validates issuer match and JWKS usability,
derives the callback URL from tenant context, and runs a non-interactive connection test.
Claim/group-role mapping is applied to Keycloak IdP mappers through the existing port.

Pros:

- Full control over outbound-fetch safety (timeout, size cap, scheme policy, classification).
- Returns only a minimal redacted DTO; raw discovery/JWKS never reach the SPA.
- Issuer/JWKS validation is explicit and unit-testable as pure logic.

Cons:

- The BFF makes outbound calls to operator-supplied hosts (mitigated by bounds + policy).

Risks:

- SSRF if the scheme/host policy is weak — mitigated by HTTPS-only outside local/dev and a
  hard timeout + size cap.

### Option B: Delegate discovery to Keycloak's `import-config` endpoint

Let Keycloak fetch the discovery document server-side and return the config.

Pros:

- No outbound fetch from the BFF.

Cons:

- We lose control of timeout/size/scheme policy and issuer/JWKS validation semantics.
- Keycloak's raw config map would still need redaction before reaching the SPA.

Risks:

- Inconsistent error classification; harder to prove honestly.

### Option C: Full login simulation in this slice

Drive a real browser auth-code flow against the provider to prove end-to-end login.

Pros:

- Strongest possible proof.

Cons:

- Requires interactive browser orchestration and a real upstream session; not honestly
  automatable for arbitrary tenant providers in this slice.

Risks:

- High flakiness; would tempt faked readiness — rejected.

## Decision

Adopt **Option A**. Add BFF-mediated OIDC discovery import, issuer validation, JWKS
validation, callback-URL display, and a non-interactive connection test under the existing
auth-settings boundary, plus bounded claim and group/role mapping applied through the
Keycloak `RealmAdminPort`. Outbound discovery/JWKS fetches use a hard timeout, a response
size cap, and an HTTPS-only policy (http permitted only for local/dev hosts). All responses
are minimal redacted DTOs; no client secret or raw discovery/JWKS document is ever returned,
logged, or audited. All mutation and test paths are audit-first and tenant-scoped from the
FQDN/session. Login simulation remains **deferred** (no honest non-interactive proof).
SAML remains out of scope.

## Rationale

Option A keeps the safety-critical logic (fetch bounds, scheme policy, issuer/JWKS checks,
error classification) inside our own testable code and at the existing redaction boundary,
which is exactly where ADR-0043 already enforces "no secret, no raw representation". It best
satisfies the honesty driver: discovery/issuer/JWKS/callback/test become live-backed or
pure-derivation capabilities, while mapping is recorded as `partial` (configured but not
exercised through a real login) and login simulation stays `deferred`. Options B and C
were rejected because they weaken control over safety/validation (B) or cannot be proven
honestly in this slice (C).

Trade-off accepted: the BFF performs outbound HTTP to operator-supplied hosts, contained by
a hard timeout, a size cap, and an HTTPS-only-outside-dev scheme policy.

## Consequences

Positive:

- Enterprise-grade OIDC onboarding: discovery import, validation, callback display, test.
- Readiness stays honest; the capability map reflects real, verifiable status.
- No new data-access bypass; reuses the audit-first, redacted, tenant-scoped pipeline.

Negative:

- New outbound-fetch surface in the BFF (bounded and policy-gated).
- Claim/group-role mapping is `partial` until a future login-exercised proof exists.

Neutral / operational:

- A new `proof:auth-oidc-enterprise` script exercises discovery/issuer/JWKS/callback/test
  against mock-oidc or local Keycloak and cleans up.

## AI-assistance record

AI used: Yes

- Tool/model: Claude Opus 4.8 (1M context), Claude Code.
- Assistance scope: codebase mapping, contract/use-case/route/adapter/UI implementation,
  tests, runtime proof, and this ADR.
- Human review status: required before merge.
- Evidence checked: gates + runtime proof recorded in the evidence bundle.
- Validation required: `make check`, platform-api/frontend/architecture tests, OpenAPI
  drift + lint, secret/dependency scans, and the OIDC runtime proof.

## Validation / evidence

Evidence level: High

Evidence: `docs/evidence/auth/oidc-enterprise-hardening.md`.

## Impacted areas

- Architecture: new BFF use cases + routes within the auth-settings boundary; new
  `RealmAdminPort` IdP-mapper methods.
- Data: bounded claim/group-role mapping config; no schema migration required.
- API: `POST /api/auth/settings/idps/oidc/discover`,
  `GET /api/auth/settings/idps/:alias/callback-url`,
  `POST /api/auth/settings/idps/:alias/test-connection`,
  `PATCH /api/auth/settings/idps/:alias/mapping`.
- Security: outbound-fetch bounds + scheme policy; sustained no-secret/no-raw-doc redaction.
- Operations: classified upstream failures; runtime proof.
- Testing: backend unit + frontend MSW/axe + OpenAPI drift/lint + runtime proof.
- Delivery: `/admin/auth` IdPs tab enhancement.
- UX: discovery import, callback display + copy, validation status, test connection,
  mapping fields.
- Documentation: capability map evidence, OpenAPI, i18n, CODEMAPS, ACTION-REGISTER.

## Follow-up actions

Tracked in:

```text
docs/adr/ACTION-REGISTER.md
```

ADR-ACT-0215 covers this slice. A future action will cover login simulation once an honest
non-interactive proof exists, and SAML if/when prioritised.

## Review date

2026-12-12

## Supersedes

None.

## Superseded by

None.

## References

- ADR-0030 auth-settings BFF boundary
- ADR-0037 tenant auth provider login allowlist
- ADR-0041 per-tenant auth-settings credential
- ADR-0043 writable IdP management + secret redaction
- ADR-0045 enterprise tenant onboarding + control-plane capability map
- OpenID Connect Discovery 1.0 (`/.well-known/openid-configuration`, `jwks_uri`)

## Notes

Login simulation (`oidc_login_simulation`) stays deferred: there is no honest,
non-interactive way to prove an end-to-end upstream login for an arbitrary tenant provider
in this slice. Claim/group-role mapping is `partial`: it is configured on the Keycloak IdP
but not yet verified through a real brokered login.
