# Evidence: Administrative Contextual Audit Trail (ADR-0040 / ADR-ACT-0208)

Source of truth: ACTION-REGISTER row ADR-ACT-0208; decisions in ADR-0040.

## Scope delivered

The control plane is now **inspectable**: tenant admins see who changed what, when, and from where,
in the relevant admin context — a trust/verification slice, not a new product.

- **Tenant-scoped contextual audit query** `GET /api/org/audit` over the durable `audit_events`
  store. Filters: logical `resource`, `resourceId`, `action`, `actorId`, `from`/`to`, `limit`.
- **Read-only contextual panels** in Members (per-member "Recent activity"), Config ("Recent
  configuration changes"), and the Auth Providers tab ("Recent provider changes"), refreshed after the
  relevant mutation.

## Audit model / query decisions

- **Tenant scope is authoritative from the session/FQDN** (`tenant_id = organisationId`); the frontend
  cannot pass a tenant. The `AuditEventPort` keys on `tenant_id`, so cross-tenant leakage is impossible
  (unit-tested).
- The SPA passes a **logical** resource (`member|config|feature|auth_settings`) mapped server-side to
  the stored resource string, decoupling the SPA from internal strings.
- `AuditEventPort.query` was extended additively with a `resourceId` filter (postgres + in-memory).
- **Metadata redaction**: keys matching `secret|password|token|credential` are replaced with
  `[redacted]`; `ipAddress`/`userAgent` are never included in the DTO. Emitters already exclude secret
  values (e.g. auth-settings records config keys, not values).

## Permission decisions

- Route gate: the **existing** `tenant.audit.read` (already in the `tenant-admin` bundle) — keeps audit
  read tenant-admin-only; non-admins get 403. **No new permission added.**
- The usecase **additionally** enforces the per-context read permission (`tenant.members.read` /
  `tenant.config.read` / `tenant.features.read` / `tenant.auth.settings.read`) for the requested
  resource, future-proofing finer roles. Documented in ADR-0040.

## UI surfaces updated

- **Members** — `member-audit-<userId>` panel in the expanded detail (`resource=member`,
  `resourceId=userId`): username/status/role/remove events.
- **Config** — `config-audit` panel on `/admin/config` (`resource=config`).
- **Auth** — `auth-providers-audit` panel on the Providers tab (`resource=auth_settings`,
  `resourceId=providers`).
- Panels refresh by invalidating the `["admin","audit"]` query prefix on the relevant mutation.

## Tests run (all green)

- Backend `audit.test.ts` (5): unknown resource → invalid, missing context permission → forbidden,
  tenant isolation (no cross-tenant events), `resourceId` filter, metadata redaction.
- Frontend `AuditTrailPanel.test.tsx` (5): renders events, empty, error (retryable), forbidden, axe;
  plus contextual-panel assertions in the Members and Config page tests.
- Suites: `test:platform-api`, `test:frontend:run` (110), `test:architecture`, orchestrator
  `all --strict`, OpenAPI drift, contract-drift + ADR-governance validators.

## Known deferrals

- Cursor pagination (capped `limit` for now); invitation/resend events in the per-member panel (keyed
  by email, surface in a category view); richer before/after diffing; a dedicated audit-export product;
  system-admin cross-tenant audit.

## Live / manual verification

See the extended steps in `docs/evidence/admin/live-tenant-admin-walkthrough.md`: as a tenant admin,
change a member username / status, change a config value / reset it, change provider config, and
confirm each appears in the relevant contextual panel; confirm a viewer/member cannot reach the audit
views (403); confirm no cross-tenant events are visible.
