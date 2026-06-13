-- Migration 030: Scheduled jobs on the event substrate (ADR-0059 / ADR-ACT-0262).
--
-- Built-in scheduled jobs that enqueue events onto the proven Phase-5 Postgres outbox
-- (migration 027). A due job publishes an event idempotently (key = job_key + window
-- bucket) so a double scheduler tick in the same window does NOT double-enqueue. The
-- worker runtime then processes the event. Windmill/Temporal remain a later workflow-
-- engine decision (ADR-0059) — NOT delivered. Tenant-scoped (RLS). No secret fields.

CREATE TABLE IF NOT EXISTS public.scheduled_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID        NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  job_key         TEXT        NOT NULL,
  event_type      TEXT        NOT NULL,
  payload         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  interval_seconds INTEGER    NOT NULL CHECK (interval_seconds > 0),
  enabled         BOOLEAN     NOT NULL DEFAULT true,
  next_run_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_run_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      TEXT,
  UNIQUE (organisation_id, job_key)
);

CREATE INDEX IF NOT EXISTS scheduled_jobs_due_idx
  ON public.scheduled_jobs (enabled, next_run_at);
CREATE INDEX IF NOT EXISTS scheduled_jobs_org_idx
  ON public.scheduled_jobs (organisation_id);

ALTER TABLE public.scheduled_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.scheduled_jobs;
CREATE POLICY tenant_isolation ON public.scheduled_jobs
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
