# ADR-0040: Administrative Audit Trail and Control-Plane Verification

## Status

Accepted

## Date

2026-06-11

## Decision owner

Architecture owner / technical lead

---

## Context

The control plane now has many audit-first mutations — members (role/username/status/invite/resend/
remove), per-tenant auth provider config, and the configuration registry — all writing to the durable
`audit_events` table (ADR-ACT-0204/0205/0206/0207). But the admin UI cannot inspect them: a tenant
admin can change things but cannot see _who changed what, when, and from where_ without leaving the
admin context. That is the next platform-confidence gap. This is a **trust/verification** slice, not a
new product feature.

---

## Decision

Expose a **tenant-scoped, contextual audit query** and surface compact, read-only audit panels in the
existing admin surfaces.

### Query

A single BFF endpoint `GET /api/org/audit` over the existing `audit_events` store (reuses the
`AuditEventPort.query`, extended additively with a `resourceId` filter). Filters: `resource` (logical),
`resourceId`, `action`, `actorId`, `from`/`to`, `limit`. **Tenant scope is authoritative from the
session/FQDN** (`tenant_id = organisationId`); the frontend can never pass a tenant. The `AuditEventPort`
already keys on `tenant_id`, so cross-tenant leakage is impossible.

### Logical resources

The SPA requests a **logical** resource, mapped server-side to the stored `resource` string so the SPA
is decoupled from internal strings:

| logical         | stored                  | context read permission     |
| --------------- | ----------------------- | --------------------------- |
| `member`        | `organisation:members`  | `tenant.members.read`       |
| `config`        | `organisation:config`   | `tenant.config.read`        |
| `feature`       | `organisation:features` | `tenant.features.read`      |
| `auth_settings` | `auth_settings`         | `tenant.auth.settings.read` |

### Permissions

The route is gated by the **existing** `tenant.audit.read` (already in the `tenant-admin` bundle) — a
coarse gate that keeps audit read tenant-admin-only. The usecase **additionally** enforces the
per-context read permission from the table above, so a future finer role that holds e.g.
`tenant.members.read` but not the others can only read member audit. No new permission is introduced;
the coarse + per-context combination is documented here.

### Metadata safety

Audit metadata is built by the emitters to exclude secrets (e.g. auth-settings records config _keys_,
not values). The query usecase applies a defensive redaction pass that drops any metadata key matching
`secret|password|token|credential` and never exposes `ipAddress`/`userAgent` in the DTO.

### UI

Compact, read-only panels using existing design-system components, refreshed (query invalidation) after
the relevant mutation, with the standard admin error semantics (401 session-expired, 403 Forbidden,
generic retry):

- **Members** — "Recent activity" in the expanded member detail (`resource=member`,
  `resourceId=userId`): username/status/role/remove changes.
- **Config** — a "Recent configuration changes" panel on `/admin/config` (`resource=config`).
- **Auth** — recent provider-config changes on the Providers tab (`resource=auth_settings`,
  `resourceId=providers`).

---

## Consequences

### Positive

- The control plane becomes inspectable in context; admins see who/what/when without leaving the page.
- Reuses the audit substrate, the admin-fetch/TanStack-Query pattern, and existing permissions — no new
  product, no new permission, no new store.

### Negative / Limitations

- Invitation/resend events are keyed by email, so the per-member panel (keyed by userId) shows
  username/status/role/remove but not invite/resend; those surface in a category view (deferred).
- No cursor pagination in this slice (capped `limit`); `before/after` metadata is shown only where the
  emitter already records it safely.

### Deferred

- Cursor pagination; a dedicated audit-export/search product; richer before/after diffing; invitation
  events in the per-member panel; system-admin cross-tenant audit.

---

## Related ADRs

- ADR-0035 (log indexing/search — distinct from the durable `audit_events` store).
- ADR-0036/0037/0038/0039 (the control-plane surfaces whose mutations this inspects).
- ADR-0022 (session/permissions), ADR-0029 (tenant isolation).
- Implementation: ADR-ACT-0208.
