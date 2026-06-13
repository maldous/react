-- Migration 031: Central runtime secret store (ADR-0069 / ADR-ACT-0265).
--
-- A first-class, tenant-scoped secret store behind SecretStorePort. Callers store a
-- secret by logical name and receive back an OPAQUE reference (`secret:<uuid>`); the
-- plaintext value is NEVER returned by any read/list path — only metadata. The
-- built-in provider keeps the value AES-256-GCM encrypted at rest in `encrypted_value`
-- (ADR-0047 tenant-secret-crypto). The composed OpenBao provider (Tier-1 kernel,
-- ADR-0069) keeps the value in OpenBao KV v2 and stores ONLY the metadata + backend
-- path here (`encrypted_value` NULL, `backend_path` set) — a container is not a
-- capability: OpenBao is delivered only once `proof:secrets-openbao` proves a live
-- write/read round-trip. Tenant-scoped (RLS). No secret value ever appears in a key,
-- log, audit row, or readiness payload.

CREATE TABLE IF NOT EXISTS public.secret_refs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID        NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  -- opaque external reference returned to callers (never the value); `secret:<uuid>`.
  ref             TEXT        NOT NULL UNIQUE,
  -- logical name within the tenant, e.g. "smtp/password" or "provider/meilisearch/api-key".
  secret_name     TEXT        NOT NULL,
  -- which backend holds the VALUE: 'builtin' (encrypted_value) | 'openbao' (backend_path).
  provider        TEXT        NOT NULL DEFAULT 'builtin' CHECK (provider IN ('builtin', 'openbao')),
  -- builtin only: enc:<iv>:<ct>:<tag> (AES-256-GCM) or unenc:<v> (dev, key absent). NULL for openbao.
  encrypted_value TEXT,
  -- openbao only: the KV v2 logical path that holds the value. NULL for builtin.
  backend_path    TEXT,
  version         INTEGER     NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      TEXT,
  -- soft-disable (revoke): a revoked secret cannot be resolved but its metadata remains
  -- for audit until a hard delete. Rotation bumps `version` and clears revoked_at.
  revoked_at      TIMESTAMPTZ,
  revoked_by      TEXT,
  UNIQUE (organisation_id, secret_name)
);

CREATE INDEX IF NOT EXISTS secret_refs_org_idx ON public.secret_refs (organisation_id);

ALTER TABLE public.secret_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.secret_refs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.secret_refs;
CREATE POLICY tenant_isolation ON public.secret_refs
  USING (
    organisation_id::text = current_setting('app.current_tenant_id', true)
    OR (
      current_user::text = 'rls_bypass'
      OR (
        pg_has_role(current_user, 'rls_bypass', 'MEMBER')
        AND COALESCE((SELECT rolinherit FROM pg_roles WHERE rolname = current_user::text LIMIT 1), false)
      )
    )
  );
