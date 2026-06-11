# Evidence: Tenant Identity & Membership v2 (ADR-ACT-0206 / ADR-0038)

Source of truth: ACTION-REGISTER row ADR-ACT-0206; decisions in ADR-0038.

## Scope delivered

A hardened tenant identity model + admin UI, before generic product features:

- **Global user vs tenant-scoped membership**, tenant-scoped **username**, membership **status**
  lifecycle, **last login**, **invited_by**, and richer **external identities**.
- Admin **Members** page: username / status / last-login columns; an expandable per-member detail
  that edits the username, enables/disables the member, and lists external identities; **resend**
  on pending invitations. Invite / change-role / remove, the last-admin guard, permission gates,
  and 401/403/503/generic error semantics are all preserved.

## Model decisions

- **User is global** — one `users` row per email (existing `UNIQUE(email)` kept). One email spans
  tenants via multiple `memberships` rows; no migration to email uniqueness was needed.
- **Username is tenant-scoped**, case-insensitively unique within an org (partial unique index;
  NULL exempt), 3–32 chars `[a-z0-9._-]` start/end alphanumeric. **Never** auto-set/overwritten from
  IdP claims — the only username write is `editMemberUsername` (unit-guarded).
- **Status** `invited | active | disabled` with explicit transitions; disabling the last active
  tenant-admin is refused.
- **External identities** uniqueness stays `(provider, provider_subject)`; gained `email` +
  `last_seen_at`; `linkedAt`/`joinedAt` map to `created_at`.
- **No new permissions** — username/status reuse `tenant.members.update_role`, resend reuses
  `tenant.members.invite`, external-ids reuse `tenant.members.read` (documented in ADR-0038).

## Database / API changes

- Migration **016-membership-identity-v2.sql** (additive, idempotent; applied to dev DB): membership
  `username/status/last_login_at/invited_by` + status CHECK + `(organisation_id, lower(username))`
  partial unique index; `external_identities.email/last_seen_at`; `users.status`.
- `adapters-postgres` row mappers surface the new fields (defensive defaults for pre-016 selects).
- BFF usecases (audit-first): `listOrgMembers` (+username/status/lastLogin), `editMemberUsername`,
  `setMemberStatus`, `resendInvite`, `listMemberExternalIdentities`. Routes: `PATCH
  /api/org/members/:userId/{username,status}`, `POST /api/org/members/resend-invite`, `GET
  /api/org/members/:userId/external-identities` (OpenAPI updated; drift green).
- Contracts in `@platform/contracts-admin`; drift test also guards `MEMBERSHIP_STATUSES`.

## Admin UI changes

Members table columns username/status/last-login; expandable detail (edit username conflict-aware,
enable/disable, external identities, audit-trail-deferred note); resend on pending invitations.

## Tests run (all green)

- `domain-identity` 101 (incl. username validation + status transitions).
- `members-v2.test.ts` 19 (edit username, status incl. last-admin guard, resend, external ids, and a
  guard proving the invite/IdP path never writes username) + `members.test.ts` + drift test.
- `test:platform-api` full suite; `test:frontend:run` 98 (members v2: columns, edit success/conflict,
  enable, resend, viewer read-only, axe); `test:architecture`; orchestrator `all --strict`.

## Known deferrals

- Per-member audit-trail panel (use the admin log search by actor/resource).
- External-identity link/unlink management; global `users.status` enable/disable UI.
- Username `invalid_transition` is unreachable via the 2-value status body (defensive guard only).

## Manual / live verification

Backend behaviours are unit-tested; UI behaviours are MSW-integration-tested. A live logged-in pass
follows the procedure in `live-tenant-admin-walkthrough.md` (now also: expand a member → edit username
→ disable/enable → resend a pending invite → confirm external identities; audit events
`member.username_changed` / `member.status_changed` / `member.invitation_resent`).
