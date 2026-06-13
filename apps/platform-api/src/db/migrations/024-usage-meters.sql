-- Migration 024: Usage metering + quota definitions (ADR-0067 / ADR-ACT-0256).
--
-- Built-in, local-first metering substrate (Postgres). ClickHouse/OpenMeter
-- providerisation is a later (Phase 2.5) adapter behind the same MeteringRepository
-- port — see ADR-0067. Quota enforcement aggregates meter usage over a window and
-- compares against per-tenant limits.
--
-- RLS uses the CANONICAL bypass predicate (migration 012/023): bypass only when the
-- effective current_user IS rls_bypass (after withSystemAdmin SET LOCAL ROLE) or an
-- INHERITing member — platform_app is NOINHERIT, so under withTenant() RLS enforces.
-- Do NOT use the naive pg_has_role(...,'MEMBER') predicate (it leaks to platform_app).

-- ---------------------------------------------------------------------------
-- meter_events — append-safe, tenant-scoped usage records, idempotent.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.meter_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID        NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  meter_key       TEXT        NOT NULL,
  subject_id      TEXT,
  quantity        NUMERIC     NOT NULL,
  idempotency_key TEXT        NOT NULL,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  source          TEXT        NOT NULL DEFAULT 'platform',
  metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- Idempotent by tenant + meter + idempotency key (ADR-0067 invariant).
  UNIQUE (organisation_id, meter_key, idempotency_key)
);

CREATE INDEX IF NOT EXISTS meter_events_org_meter_time_idx
  ON public.meter_events (organisation_id, meter_key, occurred_at);

ALTER TABLE public.meter_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meter_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.meter_events;
CREATE POLICY tenant_isolation ON public.meter_events
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
-- tenant_quotas — per-tenant quota definitions (operator-managed).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_quotas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID        NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  quota_key       TEXT        NOT NULL,
  entitlement_key TEXT        NOT NULL,
  meter_key       TEXT        NOT NULL,
  limit_value     BIGINT      NOT NULL,
  -- "window" is a reserved SQL keyword; store as window_kind, expose as `window` in DTOs.
  window_kind     TEXT        NOT NULL CHECK (window_kind IN ('daily', 'monthly', 'rolling_30d', 'lifetime')),
  action          TEXT        NOT NULL DEFAULT 'deny' CHECK (action IN ('allow', 'deny')),
  metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      TEXT,
  UNIQUE (organisation_id, quota_key)
);

CREATE INDEX IF NOT EXISTS tenant_quotas_org_idx ON public.tenant_quotas (organisation_id);

ALTER TABLE public.tenant_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_quotas FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.tenant_quotas;
CREATE POLICY tenant_isolation ON public.tenant_quotas
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
