# Evidence: Enterprise Control-Plane Capability Map + Tenant Readiness (ADR-0045 / ADR-ACT-0213)

Source of truth: ACTION-REGISTER row ADR-ACT-0213; decisions in ADR-0045.

## Scope delivered

The enterprise control plane is now **self-describing**. A server-owned Capability Registry enumerates
every control-plane capability with its implementation status, and `GET /api/org/readiness` reports,
for a given tenant, each capability's readiness plus an aggregated overall status. The
**`/admin/readiness`** surface renders this as a grouped checklist that drives a tenant from created →
fully configured. Readiness is **never faked** — it comes from a live check or a documented invariant,
otherwise it is reported `deferred`/`unknown`. The platform standard is **OIDC-first**: SAML is out of
scope and not listed; the OIDC enterprise sub-capabilities are listed as `deferred` so the gap is
visible.

## Readiness model

- **Per-capability**: `ready | incomplete | blocked | degraded | unknown | deferred`.
- **Overall** (aggregated over the `required` capabilities, worst-wins:
  `blocked > degraded > incomplete > unknown > ready`): `ready | incomplete | blocked | degraded |
  unknown`. `deferred`/non-required capabilities never drag the overall down.

## Capability inventory + matrix

| Capability | Category | Admin route | Impl | Required | Readiness source |
| --- | --- | --- | --- | --- | --- |
| tenant_record | identity | — | implemented | ✓ | live (tenant context) |
| tenant_fqdn | identity | — | implemented | ✓ | live (tenant context) |
| tenant_admin | identity | /admin/members | implemented | ✓ | live (active-admin count) |
| member_administration | identity | /admin/members | implemented | | invariant |
| roles_permissions | identity | /admin/members | implemented | | invariant |
| auth_credential | authentication | — (system-admin) | implemented | ✓ | live (credential probe, ADR-0041) |
| auth_providers | authentication | /admin/auth | implemented | ✓ | live (provider resolve) |
| session_policy | authentication | /admin/auth | implemented | ✓ | credential-derived |
| mfa_policy | authentication | /admin/auth | implemented | ✓ | credential-derived |
| idp_configuration | authentication | /admin/auth | implemented | | live (IdP count; optional) |
| feature_config | configuration | /admin/config | implemented | | invariant (defaults) |
| branding | configuration | /admin/config | partial | | invariant (defaults) |
| tenant_domains | configuration | — | deferred | | deferred |
| email_sender | configuration | /admin/email | implemented | | live (email sender readiness + Mailpit test-send, ADR-0047) |
| audit | operations | /admin/logs | implemented | | invariant (durable store) |
| storage | operations | — | deferred | | deferred |
| observability | operations | /admin/logs | partial | | deferred |
| integrations_webhooks | integrations | — | deferred | | deferred |
| oidc_discovery | authentication | /admin/auth | implemented | | invariant (discover usecase + live proof, ADR-0046) |
| oidc_issuer_validation | authentication | — | implemented | | invariant (issuer-match validation + live proof, ADR-0046) |
| oidc_jwks_validation | authentication | — | implemented | | invariant (JWKS-usability validation + live proof, ADR-0046) |
| oidc_claim_mapping | authentication | /admin/auth | partial | | deferred (configured, not login-exercised) |
| oidc_group_role_mapping | authentication | /admin/auth | partial | | deferred (configured, not login-exercised) |
| oidc_test_connection | authentication | /admin/auth | implemented | | invariant (test-connection usecase + live proof, ADR-0046) |
| oidc_callback_display | authentication | /admin/auth | implemented | | invariant (pure derivation from tenant context, ADR-0046) |
| oidc_login_simulation | authentication | — | deferred | | deferred (no honest non-interactive proof) |

**Required (block tenant usability):** tenant_record, tenant_fqdn, tenant_admin, auth_credential,
auth_providers, session_policy, mfa_policy. IdP is optional (only when external login is expected).

## Contracts / ports / adapters coverage

| Concern | Where | Status |
| --- | --- | --- |
| Capability + readiness DTOs | `@platform/contracts-admin` (Capability*, TenantReadiness*) | implemented |
| Capability registry + pure aggregation | `apps/platform-api/src/usecases/capability-registry.ts` (`CAPABILITIES`, `buildTenantReadiness`) | implemented |
| Readiness endpoint | `GET /api/org/readiness` (tenant scope, `tenant.admin.access`, tenant from FQDN) | implemented |
| Credential probe (reused) | `RealmAdminPort.probeReadiness` + `mapProbe` (ADR-0041/0044) | implemented |
| Active-admin signal | `withTenant` count of active `tenant-admin` memberships | implemented |
| IdP count signal | `KeycloakRealmAdminAdapter.listIdentityProviders` (when credential ok) | implemented |
| Admin surface | `/admin/readiness` (`features/admin-readiness/*`, route, nav) | implemented |
| Audit events | reuses existing per-capability audit (no new actions this slice) | n/a |

## Tenant onboarding checklist (covered by the map)

tenant record ✓, FQDN known ✓, auth-settings credential ✓ (live), ≥1 active tenant-admin ✓ (live),
Providers ✓, Session ✓, MFA ✓, ≥1 IdP (optional, live count), branding (defaulted), feature/config
(defaulted), audit (available), storage (deferred — status surfaced as Planned), email/sender
(deferred — status surfaced as Planned).

## Security / honesty

- Tenant context comes from the FQDN/session; the readiness endpoint never trusts a body-supplied
  tenant. The active-admin count is RLS-scoped via `withTenant`.
- No capability is reported `ready` without a live check or documented invariant. Deferred
  capabilities always report `deferred` regardless of signals (unit-tested). No secret is read or
  returned by the readiness path.

## Tests run (all green)

- Backend `capability-registry.test.ts` (10): registry inventory (incl. OIDC sub-caps + unique keys);
  aggregation (ready/blocked/degraded/incomplete); optional IdP non-blocking; **no-fake** (deferred
  stays deferred under any signals); i18n keys + admin routes exposed.
- Frontend `AdminReadinessPage.test.tsx` (6): grouped render, admin-route links, deferred impl badge +
  no link, blocked missing-action hints, retryable error, axe.
- Suites: `test:platform-api` (432), `test:frontend:run` (133), `test:architecture`, orchestrator
  `all --strict`, OpenAPI drift (64 routes), `validate-action-register` (45 ADRs).

## Known gaps + recommended next slices (prioritised by the map)

1. **OIDC enterprise hardening** (highest value, OIDC-first): discovery URL import, issuer + JWKS
   validation, claim + group/role mapping, **test-connection**, callback URL display, login
   simulation — currently all `deferred` in the map.
2. **Email/sender config** readiness check + admin surface (onboarding-critical, currently deferred).
3. **Tenant custom domains** management + readiness.
4. **Storage** and **observability** per-tenant readiness checks (currently deferred/partial).
5. **Integrations/webhooks** capability.
6. A guided **onboarding wizard** layered over this checklist (this slice ships the checklist, not a
   wizard). SAML remains out of scope (OIDC-first).
