-- Migration 029: Observability — metric signals + samples + alert rules + incidents
-- (ADR-0062 / ADR-ACT-0261).
--
-- Built-in observability foundation: a metric-signal registry, an append-safe sample
-- store, operator-managed alert rules with threshold evaluation, and an incident
-- lifecycle. A fired alert opens an incident and dispatches a notification through the
-- Phase-6 substrate (preference-gated). Prometheus / Tempo / Alertmanager / Grafana IRM
-- + on-call + public status page remain Phase-7.5 provider sub-decisions (NOT delivered).
--
-- Everything tenant-scoped (RLS, canonical inherit-aware predicate). No secret fields.

-- ---------------------------------------------------------------------------
-- metric_signals — the registry of known metric signals (what CAN be measured).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.metric_signals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID        NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  signal_key      TEXT        NOT NULL,
  display_name    TEXT        NOT NULL,
  unit            TEXT        NOT NULL DEFAULT '',
  kind            TEXT        NOT NULL DEFAULT 'gauge' CHECK (kind IN ('gauge', 'counter')),
  description     TEXT        NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, signal_key)
);

ALTER TABLE public.metric_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metric_signals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.metric_signals;
CREATE POLICY tenant_isolation ON public.metric_signals
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

-- ---------------------------------------------------------------------------
-- metric_samples — append-safe observed values per signal.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.metric_samples (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID        NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  signal_key      TEXT        NOT NULL,
  value           DOUBLE PRECISION NOT NULL,
  observed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  labels          JSONB       NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS metric_samples_sig_idx
  ON public.metric_samples (organisation_id, signal_key, observed_at DESC);

ALTER TABLE public.metric_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metric_samples FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.metric_samples;
CREATE POLICY tenant_isolation ON public.metric_samples
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

-- ---------------------------------------------------------------------------
-- alert_rules — operator-managed threshold rules over a signal.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.alert_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID        NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  rule_key        TEXT        NOT NULL,
  signal_key      TEXT        NOT NULL,
  comparator      TEXT        NOT NULL CHECK (comparator IN ('gt', 'gte', 'lt', 'lte')),
  threshold       DOUBLE PRECISION NOT NULL,
  severity        TEXT        NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
  enabled         BOOLEAN     NOT NULL DEFAULT true,
  -- Notification target (Phase-6 substrate): user + category to notify when fired.
  notify_user_id  TEXT,
  notify_category TEXT        NOT NULL DEFAULT 'system',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      TEXT,
  UNIQUE (organisation_id, rule_key)
);
CREATE INDEX IF NOT EXISTS alert_rules_org_idx ON public.alert_rules (organisation_id);

ALTER TABLE public.alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.alert_rules;
CREATE POLICY tenant_isolation ON public.alert_rules
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

-- ---------------------------------------------------------------------------
-- incidents — lifecycle records opened by a fired alert.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.incidents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID        NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  alert_rule_id   UUID,
  rule_key        TEXT        NOT NULL,
  title           TEXT        NOT NULL,
  severity        TEXT        NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
  status          TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
  observed_value  DOUBLE PRECISION,
  threshold       DOUBLE PRECISION,
  opened_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  resolved_at     TIMESTAMPTZ,
  updated_by      TEXT,
  metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS incidents_org_idx ON public.incidents (organisation_id, opened_at DESC);

ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incidents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.incidents;
CREATE POLICY tenant_isolation ON public.incidents
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
