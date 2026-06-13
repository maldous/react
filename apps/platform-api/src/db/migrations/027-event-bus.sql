-- Migration 027: Event bus + durable workers + DLQ/redrive (ADR-0059 / ADR-ACT-0259).
--
-- Built-in Postgres OUTBOX event bus (local-first, durable, transactional). Redis
-- Streams / NATS / Redpanda remain Phase-5.5 providers behind the EventBusPort — NOT
-- delivered here. Sentry's Kafka is Sentry-only and is never the platform bus. The
-- workflow engine (Windmill/Temporal) is a later decision (ADR-0059), gated on this bus.
--
-- Events are tenant-scoped (RLS) and idempotent by (org, event_type, idempotency_key).
-- Handler failures retry with backoff and move to a dead-letter table after max_attempts;
-- operators can redrive. RLS uses the CANONICAL inherit-aware predicate (012/023/024/025/026).

-- ---------------------------------------------------------------------------
-- platform_events — durable outbox / event log. One row per published event.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID        NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  event_type      TEXT        NOT NULL,
  payload         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'processed', 'failed')),
  attempts        INTEGER     NOT NULL DEFAULT 0,
  max_attempts    INTEGER     NOT NULL DEFAULT 5,
  last_error      TEXT,
  available_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at    TIMESTAMPTZ,
  -- Idempotent publish: a duplicate (tenant, type, key) is a no-op (ADR-0059 invariant).
  UNIQUE (organisation_id, event_type, idempotency_key)
);

CREATE INDEX IF NOT EXISTS platform_events_claim_idx
  ON public.platform_events (status, available_at);
CREATE INDEX IF NOT EXISTS platform_events_org_idx
  ON public.platform_events (organisation_id, created_at);

ALTER TABLE public.platform_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.platform_events;
CREATE POLICY tenant_isolation ON public.platform_events
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
-- event_dead_letters — events that exhausted retries. Redrivable by operators.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_dead_letters (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID        NOT NULL,
  organisation_id UUID        NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  event_type      TEXT        NOT NULL,
  payload         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT        NOT NULL,
  attempts        INTEGER     NOT NULL DEFAULT 0,
  last_error      TEXT,
  dead_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  redriven_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS event_dead_letters_org_idx
  ON public.event_dead_letters (organisation_id, dead_at);

ALTER TABLE public.event_dead_letters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_dead_letters FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.event_dead_letters;
CREATE POLICY tenant_isolation ON public.event_dead_letters
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
-- worker_heartbeats — durable worker-runtime registry. Operator-global infra
-- (not tenant data); accessed via withSystemAdmin. No RLS (no tenant column).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.worker_heartbeats (
  worker_id         TEXT PRIMARY KEY,
  worker_kind       TEXT        NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'alive',
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata          JSONB       NOT NULL DEFAULT '{}'::jsonb
);
