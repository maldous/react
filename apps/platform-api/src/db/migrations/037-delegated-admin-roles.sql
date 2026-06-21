-- Migration 037: Delegated admin roles (ADR-0063 / V1C-04)
--
-- Platform feature: tenant-admin (or platform-admin via withSystemAdmin) grants
-- a subset of their own admin permissions to a sub-user for a limited TTL. The
-- grant is enforced at authorisation time by resolvePermissions
-- (@platform/domain-identity); the auth hot-path reads this table on every
-- request that names the grantee.
--
-- One table:
--   - public.delegated_admin_roles : the delegation grant + audit lifecycle.
--
-- Soft-delete via revoked_at + revoked_by (audit events for the revocation
-- transition are written by the usecase layer, never by this adapter).
-- expires_at NULL = never expires. expires_at < now() is treated as inactive
-- by the application layer (Postgres partial unique indexes cannot reference
-- now(); the partial unique is on revoked_at IS NULL only — see Turn-2 risk
-- flag about the "stale expired row blocks re-grant" hazard).
--
-- RLS consistent with the rest of the platform (ADR-0029 defence-in-depth,
-- ADR-ACT-0189 platform_app non-superuser). Tenant self-read via withTenant();
-- grant/revoke + cross-tenant operator reads/writes via withSystemAdmin()
-- (rls_bypass) and are audited at the use-case layer.

CREATE TABLE IF NOT EXISTS public.delegated_admin_roles (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID        NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  -- User IDs are stored as TEXT to align with Keycloak subject UUIDs (Keycloak
  -- uses opaque IDs that map to a TEXT representation, not the public.users row
  -- id; turn-2 will add an FK if the platform decides to authoritatively own
  -- the user graph in Postgres). Cross-row FK is intentionally deferred so
  -- soft-deleted Keycloak users don't trigger ON DELETE CASCADE surprises.
  granter_user_id TEXT        NOT NULL,
  grantee_user_id TEXT        NOT NULL,
  -- A single permission string (e.g. "tenant.members.manage",
  -- "tenant.billing.read"). One delegation row carries exactly one scope; multiple
  -- scopes → multiple rows. The single-TEXT-rep aligns with the campaign's
  -- `@platform/authorisation-runtime` permission model (no JSONB-array sprawl).
  scope           TEXT        NOT NULL,
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Actor who originated the grant. Always the granter_user_id for self-grants
  -- (admin granting their own subset of permissions down to a sub-user with
  -- delegated grantor authority); a platform-admin UUID for platform-initiated
  -- grants recorded for the platform-operations audit trail.
  granted_by      TEXT        NOT NULL,
  -- TTL semantic: NULL means never expires; non-null means expires at the
  -- given timestamp. The application layer treats expires_at <= now() as
  -- inactive.
  expires_at      TIMESTAMPTZ,
  -- Soft-delete: a non-null revoked_at on a row signals an explicit revocation
  -- has happened; the row remains in the table for audit purposes but is
  -- filtered out of all "active" queries by the adapter.
  revoked_at      TIMESTAMPTZ,
  revoked_by      TEXT,
  -- Free-form JSON for any extra audit metadata the usecase wants to attach
  -- (e.g. ticket_id, request_id, justification, ticket context).
  metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS delegated_admin_roles_org_idx
  ON public.delegated_admin_roles (organisation_id);

CREATE INDEX IF NOT EXISTS delegated_admin_roles_grantee_active_idx
  ON public.delegated_admin_roles (grantee_user_id)
  WHERE revoked_at IS NULL;

-- Partial unique: at most one un-revoked delegation per (grantee, scope).
-- See Turn-2 risk note: an expired-but-not-revoked stale row will block a
-- fresh grant for the same (grantee, scope). The usecase layer must revoke
-- stale expired rows before re-granting, OR a periodic cleanup job runs the
-- revocations out of band.
CREATE UNIQUE INDEX IF NOT EXISTS delegated_admin_roles_active_unique_idx
  ON public.delegated_admin_roles (grantee_user_id, scope)
  WHERE revoked_at IS NULL;

ALTER TABLE public.delegated_admin_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delegated_admin_roles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS delegated_admin_roles_tenant_isolation ON public.delegated_admin_roles;
CREATE POLICY delegated_admin_roles_tenant_isolation ON public.delegated_admin_roles
  USING (
    organisation_id::text = current_setting('app.current_tenant_id', true)
    OR pg_has_role(current_user, 'rls_bypass', 'MEMBER')
  );
