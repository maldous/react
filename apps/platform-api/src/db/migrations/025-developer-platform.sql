-- Migration 025: Developer platform — API keys / PATs + rate limits (ADR-0065 / ADR-ACT-0257).
--
-- API keys are SERVER-generated: only a salted+peppered hash is stored, never the
-- plaintext. The plaintext secret is returned exactly once on creation. Keys are
-- tenant-scoped, revocable, and entitlement-gated (`api_access`). Rate limiting is a
-- durable fixed-window counter (local-first); Redis is a Phase-3.5 provider behind the
-- same RateLimitRepository port. Rate-limit policies carry an entitlement key — the
-- bridge to the quota/entitlement substrate (deny-by-default, entitlement before limit).
--
-- RLS uses the CANONICAL bypass predicate (migration 012/023/024): bypass only when the
-- effective current_user IS rls_bypass (after withSystemAdmin SET LOCAL ROLE) or an
-- INHERITing member — platform_app is NOINHERIT, so under withTenant() RLS enforces.

-- ---------------------------------------------------------------------------
-- api_keys — tenant-scoped programmatic credentials. Only the hash is stored.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.api_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID        NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  -- Non-secret display handle; also the lookup key during verification.
  key_prefix      TEXT        NOT NULL,
  -- scrypt(secret + server pepper, per-key salt). NEVER the plaintext.
  key_hash        TEXT        NOT NULL,
  key_salt        TEXT        NOT NULL,
  scopes          TEXT[]      NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      TEXT,
  last_used_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- The prefix is the global lookup handle; it must be unique to resolve a key.
  UNIQUE (key_prefix)
);

CREATE INDEX IF NOT EXISTS api_keys_org_idx ON public.api_keys (organisation_id);

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.api_keys;
CREATE POLICY tenant_isolation ON public.api_keys
  USING (
    organisation_id::text = current_setting('app.current_tenant_id', true)
    OR (
      current_user::text = 'rls_bypass'
      OR (
        pg_has_role(current_user, 'rls_bypass', 'MEMBER')
        AND COALESCE(
          (SELECT rolinherit FROM pg_roles WHERE rolname = current_user::text LIMIT 1),
          false
        )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- rate_limit_policies — per-tenant rate-limit definitions (operator-managed).
-- entitlement_key bridges to the entitlement substrate (entitlement before limit).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rate_limit_policies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID        NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  policy_key      TEXT        NOT NULL,
  entitlement_key TEXT        NOT NULL,
  limit_value     BIGINT      NOT NULL,
  window_seconds  INTEGER     NOT NULL CHECK (window_seconds > 0 AND window_seconds <= 86400),
  action          TEXT        NOT NULL DEFAULT 'deny' CHECK (action IN ('allow', 'deny')),
  metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      TEXT,
  UNIQUE (organisation_id, policy_key)
);

CREATE INDEX IF NOT EXISTS rate_limit_policies_org_idx ON public.rate_limit_policies (organisation_id);

ALTER TABLE public.rate_limit_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limit_policies FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.rate_limit_policies;
CREATE POLICY tenant_isolation ON public.rate_limit_policies
  USING (
    organisation_id::text = current_setting('app.current_tenant_id', true)
    OR (
      current_user::text = 'rls_bypass'
      OR (
        pg_has_role(current_user, 'rls_bypass', 'MEMBER')
        AND COALESCE(
          (SELECT rolinherit FROM pg_roles WHERE rolname = current_user::text LIMIT 1),
          false
        )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- rate_limit_counters — durable fixed-window counters keyed by (org, policy,
-- window_start). One row per window; incrementAndCount upserts and returns the
-- running count. Old windows are append-safe rows (swept opportunistically).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rate_limit_counters (
  organisation_id UUID        NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  policy_key      TEXT        NOT NULL,
  window_start    TIMESTAMPTZ NOT NULL,
  count           BIGINT      NOT NULL DEFAULT 0,
  PRIMARY KEY (organisation_id, policy_key, window_start)
);

ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limit_counters FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.rate_limit_counters;
CREATE POLICY tenant_isolation ON public.rate_limit_counters
  USING (
    organisation_id::text = current_setting('app.current_tenant_id', true)
    OR (
      current_user::text = 'rls_bypass'
      OR (
        pg_has_role(current_user, 'rls_bypass', 'MEMBER')
        AND COALESCE(
          (SELECT rolinherit FROM pg_roles WHERE rolname = current_user::text LIMIT 1),
          false
        )
      )
    )
  );
