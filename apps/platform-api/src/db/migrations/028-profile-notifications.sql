-- Migration 028: End-user profile + notification preferences + notification log
-- (ADR-0068 / ADR-ACT-0260).
--
-- End-user self-service profile, per-user notification preferences, and a durable
-- dispatch log. All tenant + user scoped (RLS). user_id is the IdP subject (Keycloak),
-- stored as TEXT (no local FK). No secret fields are stored in the notification log
-- (rejected in the dispatch usecase). Real delivery transports + a composed provider
-- (Novu) are Phase-6.5 behind NotificationDispatchPort.
--
-- RLS uses the CANONICAL inherit-aware predicate (012/023/024/025/026/027).

-- ---------------------------------------------------------------------------
-- user_profiles — app-level end-user profile (display name, locale, timezone).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID        NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  user_id         TEXT        NOT NULL,
  display_name    TEXT        NOT NULL DEFAULT '',
  locale          TEXT        NOT NULL DEFAULT 'en-GB',
  timezone        TEXT        NOT NULL DEFAULT 'UTC',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, user_id)
);

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.user_profiles;
CREATE POLICY tenant_isolation ON public.user_profiles
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
-- notification_preferences — per (user, channel, category) enable flag.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID        NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  user_id         TEXT        NOT NULL,
  channel         TEXT        NOT NULL CHECK (channel IN ('email', 'webhook', 'in_app')),
  category        TEXT        NOT NULL,
  enabled         BOOLEAN     NOT NULL DEFAULT true,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, user_id, channel, category)
);

CREATE INDEX IF NOT EXISTS notification_preferences_user_idx
  ON public.notification_preferences (organisation_id, user_id);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.notification_preferences;
CREATE POLICY tenant_isolation ON public.notification_preferences
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
-- notification_log — durable dispatch record. No secret payload fields.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID        NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  user_id         TEXT        NOT NULL,
  channel         TEXT        NOT NULL,
  category        TEXT        NOT NULL,
  status          TEXT        NOT NULL CHECK (status IN ('sent', 'suppressed', 'failed')),
  subject         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS notification_log_user_idx
  ON public.notification_log (organisation_id, user_id, created_at);

ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.notification_log;
CREATE POLICY tenant_isolation ON public.notification_log
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
