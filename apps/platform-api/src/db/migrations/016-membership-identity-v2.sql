-- Migration 016: Tenant identity & membership v2 (ADR-ACT-0206)
--
-- Additive and idempotent. Hardens the tenant-scoped identity model:
--   - Membership gains a tenant-scoped username, an explicit lifecycle status,
--     a last-login timestamp, and who invited the member.
--   - External identities gain the upstream email and a last-seen timestamp.
--   - Users gain an optional global account status.
--
-- Model decisions (documented in docs/evidence/identity/tenant-identity-membership-v2.md):
--   - User is GLOBAL (one row per email — the existing UNIQUE(email) stands). One email
--     therefore spans tenants via multiple membership rows; no change needed for that.
--   - username is TENANT-SCOPED and case-insensitively unique within an organisation;
--     NULL is allowed (unset). It is NEVER auto-overwritten from IdP profile claims.
--   - joinedAt = memberships.created_at; linkedAt = external_identities.created_at (reused,
--     no new columns) — the app maps these names.
--   - status: 'invited' (membership created, not yet logged in), 'active', 'disabled'.

ALTER TABLE public.memberships
  ADD COLUMN IF NOT EXISTS username TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES public.users (id) ON DELETE SET NULL;

ALTER TABLE public.memberships DROP CONSTRAINT IF EXISTS memberships_status_check;
ALTER TABLE public.memberships
  ADD CONSTRAINT memberships_status_check CHECK (status IN ('invited', 'active', 'disabled'));

-- Tenant-scoped, case-insensitive username uniqueness; NULL usernames are exempt.
CREATE UNIQUE INDEX IF NOT EXISTS memberships_org_username_unique
  ON public.memberships (organisation_id, lower(username))
  WHERE username IS NOT NULL;

ALTER TABLE public.external_identities
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

-- Optional global account status (distinct from the tenant-scoped membership status).
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_status_check CHECK (status IN ('active', 'disabled'));
