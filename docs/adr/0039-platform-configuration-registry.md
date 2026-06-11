# ADR-0039: Platform Configuration Registry

## Status

Accepted

## Date

2026-06-11

## Decision owner

Architecture owner / technical lead

---

## Context

Tenant-configurable behaviour has so far been hand-rolled per feature: feature flags have their own
`tenant_settings` keys + endpoint + admin page; auth provider config (ADR-0037) has its own. Each new
setting invents a table/endpoint/UI pattern. Before generalising the platform we need a single, typed,
governed configuration model so future settings (auth, integrations, security, branding, system) are
declared once and rendered/edited/audited uniformly — without one-off mechanisms.

---

## Decision

Introduce a **Platform Configuration Registry**: a typed catalogue of configuration _definitions_ plus
per-tenant _values_, resolved into an _effective_ configuration.

### Definition (`PlatformConfigDefinition`)

`key`, `category` (`auth | features | integrations | security | branding | system`), `labelKey` +
`descriptionKey` (i18n), `valueType` (`boolean | string | number | json | enum`), `defaultValue`,
`allowedValues` (enum), `tenantOverridable`, `requiredPermissionRead`, `requiredPermissionWrite`,
`auditAction`, a Zod `validate`, and `lifecycle` (`active | deprecated | internal`). Definitions are
the **single source of truth**; they live server-side (they reference permissions/audit/validation)
and are serialised to a dependency-free DTO for the SPA.

### Value (`TenantConfigValue`) + resolution

A tenant value is `{ organisationId, key, value, source, updatedAt, updatedBy }`. The _effective_
value resolves as **tenant override → default** (`source: tenant_override | default`). Values are
stored in the existing **`tenant_settings`** table (no second settings mechanism) under each
definition's `storageKey`. Feature flags keep their existing `feature.<key>` storage keys, so the
registry and the legacy `/api/org/features` read/write the **same rows** — full backwards compat.

### Where things live (this slice's pragmatic choice)

- **Contracts** (zod DTOs + `validateConfigValue`) live in `@platform/contracts-admin` for now — the
  config surface is an admin surface and reuses its drift-test + wiring. A dedicated
  `@platform/contracts-config` can be split out later if the registry outgrows the admin surface.
- **Registry definitions** live in the BFF (`apps/platform-api/src/config/registry.ts`) — pure,
  testable, importing only contracts + zod.
- The **SPA never imports the registry**; it consumes serialised definitions + effective values via
  the BFF.

### API

- `GET /api/org/config[?category=]` — effective config (definitions × tenant values), read-filtered
  by the definition's `requiredPermissionRead`.
- `PATCH /api/org/config/:key` — set a tenant override (validated; `tenantOverridable` + per-definition
  `requiredPermissionWrite` enforced; audit-first).
- `DELETE /api/org/config/:key` — clear the tenant override (back to default; audit-first).

### Permissions (new — justified)

The registry is generic across categories, so a coarse pair gates the surface:
**`tenant.config.read`** and **`tenant.config.write`** (added to the `tenant-admin` bundle in
`@platform/domain-identity`). They are justified because no existing permission covers a generic
config surface. **Finer control is per-definition**: each definition carries its own
`requiredPermissionRead/Write`, enforced in the usecase — so a sensitive definition can require a
stricter permission (e.g. feature definitions keep `tenant.features.read/update`; auth-category
definitions can require `tenant.auth.settings.write`). The route gate is the coarse pair; the usecase
gate is the per-definition permission.

### Audit

Set/clear emit `config.value_changed` / `config.value_cleared` (audit-first; emit before write).

---

## Consequences

### Positive

- One declaration site for tenant config; uniform read/write/audit/validation/permission handling.
- Feature flags are registry-backed with zero breakage to `/api/org/features` (shared storage).
- Future settings add a definition, not a table/endpoint/UI.

### Negative / Limitations

- Two read paths exist for features (legacy endpoint + registry) until the legacy one is retired;
  they share storage so they cannot diverge, and a test asserts consistency.
- Config DTOs share `contracts-admin` rather than a dedicated package (documented; splittable later).
- `json` values use a textarea/read-only treatment in the first UI (no rich JSON editor).

### Deferred

- `@platform/contracts-config` split; environment-level overrides; config dependency metadata
  enforcement; rich JSON editing; deprecating the legacy features endpoint.

---

## Related ADRs

- ADR-0036/0037/0038: admin control plane, per-tenant auth provider config, identity v2.
- ADR-0013 (REST-supplementary), ADR-0022 (session/permissions), ADR-0029 (tenant isolation/RLS).
- Implementation: ADR-ACT-0207.
