# Evidence: Platform Configuration Registry (ADR-0039 / ADR-ACT-0207)

Source of truth: ACTION-REGISTER row ADR-ACT-0207; decisions in ADR-0039.

## Scope delivered

The first Platform Configuration Registry slice — a typed, governed config substrate plus a small
admin surface, replacing ad-hoc per-setting tables/endpoints/UIs:

- **Registry** of typed definitions (server-side, single source of truth) spanning categories:
  4 feature flags (`features.*`) + `branding.app_name` (string), `branding.theme` (enum),
  `security.session_warning_banner` (boolean), `integrations.webhook_headers` (json).
- **Effective config** = tenant override (`tenant_settings`) → definition default.
- **BFF** read/write usecases (audit-first, `withTenant`/RLS): list (read-filtered by per-definition
  permission, category filter), get, set (validate + `tenantOverridable` + `requiredPermissionWrite`),
  clear override. Routes `GET/PATCH/DELETE /api/org/config`.
- **Admin surface** `/admin/config`: grouped by category, type-appropriate editors, value source +
  reset, permission-gated controls, standard loading/error/empty states.

## Model decisions

- Definitions live in the BFF (`apps/platform-api/src/config/registry.ts`), serialised to a
  dependency-free `ConfigDefinitionDto`; the SPA never imports the registry.
- Contracts live in `@platform/contracts-admin` for now (ADR-0039 documents the optional future split
  to `@platform/contracts-config`).
- Values are stored in the existing `tenant_settings` — **no second settings mechanism**.
- **New permissions** `tenant.config.read` / `tenant.config.write` (added to the `tenant-admin`
  bundle) gate the surface; each definition additionally carries `requiredPermissionRead/Write`
  enforced in the usecase (finer control). Justified + documented in ADR-0039.

## Compatibility decisions

- **Feature flags are registry-backed without breaking `/api/org/features`.** Feature definitions map
  to the legacy `feature.<key>` storage (`{ "enabled": bool }`) via per-definition storageRead/Write,
  so the registry and the legacy endpoint share the same `tenant_settings` rows. Unit tests prove the
  registry both **reads** (`feature.analytics` → `true`) and **writes** (`{ enabled: true }`) that
  storage. The existing Features admin page and `org.features.*` usecases/tests are unchanged.

## Database / API changes

- No migration — reuses `tenant_settings`.
- Routes `GET/PATCH/DELETE /api/org/config` added to OpenAPI (drift green).
- Audit actions `config.value_changed` / `config.value_cleared`.

## Tests run (all green)

- `config-contracts.test.ts` (6): value validation per type + enum bounds.
- `platform-config.test.ts` (16): effective resolution (default/override), read-permission filter,
  category filter, set/clear (not_found/not_overridable/forbidden/invalid_body/ok, audit-first), and
  the **feature compat** read + write to `feature.<key>` storage + feature-coverage drift.
- `domain-identity` 101 (tenant.config.* added to the bundle).
- `AdminConfigPage.test.tsx` (7): grouped render + source badges, boolean toggle, string save, enum,
  reset-only-for-overrides, viewer read-only, error semantics, axe.
- Suites: `test:platform-api`, `test:frontend:run` (105), `test:architecture`, orchestrator
  `all --strict`, OpenAPI drift, contract-drift + ADR-governance validators.

## Known deferrals

- `@platform/contracts-config` split; environment-level overrides; config dependency-metadata
  enforcement; rich JSON editing (json is read-only in the first UI); deprecating the legacy
  `/api/org/features` endpoint (kept for compatibility).

## Manual / live verification

Backend behaviours are unit-tested; the UI is MSW-integration-tested. A live pass extends the
walkthrough in `docs/evidence/admin/live-tenant-admin-walkthrough.md`: open `/admin/config`, toggle a
feature (confirm it also reflects on the Features page / `GET /api/org/features`, since they share
storage), edit `branding.app_name`, reset an override, and confirm `config.value_changed` /
`config.value_cleared` audit events.
