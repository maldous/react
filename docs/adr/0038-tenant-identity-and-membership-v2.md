# ADR-0038: Tenant Identity and Membership v2

## Status

Accepted

## Date

2026-06-11

## Decision owner

Architecture owner / technical lead

---

## Context

ADR-0021 established identity/tenancy/roles. The first admin control plane (ADR-0036) surfaced
members, but the model was thin: a membership carried only a role, and "who is a user" was ambiguous
before building more platform features. We need an explicit, hardened tenant identity model — what is
global vs tenant-scoped, how usernames behave, and how membership lifecycle is represented — so the
admin cockpit is trustworthy.

---

## Decision

### Global user vs tenant-scoped membership

- **User is global**: one `users` row per email (the existing `UNIQUE(email)` stands). A user may
  belong to many tenants — multi-tenant membership is expressed by multiple `memberships` rows, so
  one email naturally spans tenants with **no schema change** and no conflict with email uniqueness.
- **Membership is tenant-scoped** and now carries: `username`, `status`, `last_login_at`, `invited_by`
  (plus the existing `role`). `joinedAt` maps to `created_at`.

### Username

- **Tenant-scoped** and **case-insensitively unique within an organisation** (partial unique index on
  `(organisation_id, lower(username))`; `NULL` allowed/exempt).
- Rules: 3–32 chars of `[a-z0-9._-]`, must start/end alphanumeric (`validateTenantUsername`).
- **Owned by the tenant admin** and editable with an audit trail. It is **never** auto-derived or
  overwritten from upstream IdP profile claims (email/name) — enforced by keeping the only username
  write in `editMemberUsername` and asserted by a unit test.

### Membership status

- Lifecycle `invited | active | disabled`. Transitions are explicit (`canTransitionMembershipStatus`):
  `invited → active`, and admin enable/disable between `active` and `disabled`. Disabling the **last
  active tenant-admin** is refused (extends the last-admin guard).

### External identities

- `external_identities` (global, per user) gains `email` and `last_seen_at`; `linkedAt` maps to
  `created_at`. Uniqueness stays `(provider, provider_subject)`. The admin UI reads a member's links
  (membership-scoped read) but does not mutate them in this slice.

### Optional global user status

- `users.status` (`active | disabled`) is added for a future global account-disable; the admin
  "enable/disable member" operates on the **tenant-scoped** membership status, not the global one.

### Permissions

- No new permissions. Username/status edits reuse `tenant.members.update_role`, resend reuses
  `tenant.members.invite`, external-identity read reuses `tenant.members.read` (member-management
  writes a tenant-admin already holds — see ADR-0036). Revisit if these need to diverge.

### API / boundaries

- All shapes flow through `@platform/contracts-admin` (zod); the SPA uses BFF REST via `admin-fetch`.
  Mutations are audit-first; status transitions are explicit and tested. Migration 016 is additive
  and idempotent.

---

## Consequences

### Positive

- A clear, tested identity model: global user, tenant-scoped membership + username + lifecycle.
- Multi-tenant membership and "one email, many tenants" work with no migration to email uniqueness.
- IdP changes cannot silently rewrite a tenant username (unit-guarded).

### Negative / Limitations

- Reusing `tenant.members.update_role` for username/status is a slight semantic stretch (documented).
- Per-member audit-trail UI is deferred (the global admin log search covers it by actor/resource).
- Per-tenant external-identity _management_ (link/unlink) and global user-status UI are out of scope.

### Deferred

- Per-member audit-trail panel; external-identity link/unlink; global user enable/disable UI; richer
  username normalisation (e.g. unicode folding) if needed.

---

## Related ADRs

- ADR-0021: Identity, tenancy, roles, and permissions model (evolved here).
- ADR-0029/0030: Multi-tenant isolation; tenant admin self-service.
- ADR-0036/0037: Tenant administration control plane; per-tenant auth provider config.
- Implementation: ADR-ACT-0206.
