# ADR-0037: Per-tenant Authentication Provider Configuration

## Status

Accepted

## Date

2026-06-11

## Decision owner

Architecture owner / technical lead

---

## Context

ADR-ACT-0157 introduced brokered third-party login (Google / Microsoft / Apple) via Keycloak, with the
set of offered providers and the mock-vs-real mode driven by a single **environment-global** variable,
`AUTH_PROVIDER_MODE`, read in `apps/platform-api/src/server/auth-providers.ts`. `GET /api/auth/providers`
returns the same provider list to every tenant in an environment.

Per-tenant _identity provider registration_ already exists (`/api/auth/settings/idps` upserts IdPs into
the tenant's own Keycloak realm). But which product providers are **enabled / offered** for a tenant,
and the mock/real/disabled mode, cannot be controlled per tenant — it is fixed per environment. The
administration control plane (ADR-0036) needs tenant admins to manage their own authentication options,
so provider enablement must become tenant-scoped configuration.

---

## Decision

Move **provider mode and provider enablement** from environment-global to **per-tenant configuration**,
with the environment value as the default fallback.

### Model

A per-tenant config object (typed in `@platform/contracts-admin`):

```text
TenantAuthProvidersConfig = {
  mode: "mock" | "real" | "disabled" | "default",   // "default" ⇒ inherit the environment default
  enabledProviders: ProductProviderId[]              // subset of google | azure | apple | platform
}
```

### Storage

Stored per tenant in the existing `tenant_settings` table under key `auth.providers` (the same store the
feature-flag endpoints use) — no migration. Absent ⇒ environment defaults apply. Reads/writes go through
`withTenant` so RLS isolates each tenant.

### Surface

- New tenant-scoped admin endpoints `GET` / `PATCH /api/auth/settings/providers`
  (`tenant.auth.settings.read|write`, resource `admin:auth`), mirroring the existing auth-settings
  routes; writes are audited.
- `GET /api/auth/providers` becomes **tenant-aware**: it resolves the tenant from the FQDN and merges the
  tenant's config over the environment defaults. With no tenant/config it behaves exactly as before.
- The `/auth/login?provider=` handler **rejects a provider not enabled for the resolved tenant**, bouncing
  to `/login?authError=signin_failed` (consistent with the existing invalid-provider handling).

### Explicitly out of scope (deferred)

- **Per-tenant real-provider credentials.** Real client IDs/secrets remain environment-sourced
  (`REAL_<PROVIDER>_*`). This slice controls _enablement and mode_ per tenant, not per-tenant secrets;
  encrypted per-tenant credential storage (via `token-crypto` / `TENANT_SECRET_ENCRYPTION_KEY`) is a
  follow-up action.

---

## Consequences

### Positive

- Tenant admins control their own login options from the control plane (ADR-0036, priority 6).
- No schema migration; reuses `tenant_settings` + RLS + audit.
- Backwards compatible: absent config falls back to the prior environment-global behaviour.

### Negative / Limitations

- Two sources now influence the provider list (env default + tenant override); precedence is fixed
  (tenant overrides env) and documented to avoid confusion.
- Until per-tenant credentials land, a tenant can _enable_ a real provider only if the environment
  supplies its credentials.

---

## Related ADRs

- ADR-ACT-0157: Brokered third-party IdP login (introduced env-global `AUTH_PROVIDER_MODE`; this ADR
  supersedes that assumption).
- ADR-0029/0030: Multi-tenant isolation; tenant admin self-service auth settings.
- ADR-0036: Tenant administration control plane (consumes this in the Authentication section).
- Implementation: ADR-ACT-0205.
