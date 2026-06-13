-- Migration 033: Environment registry (ADR-0072 / ADR-ACT-0274).
--
-- The application's canonical, queryable understanding of the deployment ladder:
-- which environments exist, how they are executed (Tilt vs Compose), which profiles
-- and mocks are permitted, whether destructive/preserve operations are allowed, the
-- secret-store provider, and the bootstrap/reconcile lifecycle state.
--
-- The NON-SECRET intent is sourced from the tracked manifests
-- (config/environments/<stage>.json); this table is the runtime projection of that
-- intent plus operational state (last_bootstrapped_at, last_reconciled_at, statuses).
-- Operator-global infra (no tenant column); accessed via withSystemAdmin. No secret
-- value ever lives here — the secret store (ADR-0069) owns secrets.

CREATE TABLE IF NOT EXISTS public.environment_registry (
  environment_id        TEXT PRIMARY KEY,
  name                  TEXT        NOT NULL,
  stage                 TEXT        NOT NULL
                          CHECK (stage IN ('development','test','staging','production')),
  executor              TEXT        NOT NULL CHECK (executor IN ('tilt','compose')),
  compose_project       TEXT        NOT NULL,
  base_url              TEXT,
  api_url               TEXT,
  domain                TEXT,
  -- allowed compose profiles + allowed mock providers (non-secret intent, JSON arrays).
  allowed_profiles      JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- 'mocks-allowed' (dev/test) | 'no-mocks' (staging/prod). Mocks are forbidden in
  -- staging/production; a temporary documented exception is tracked in metadata.
  mock_policy           TEXT        NOT NULL DEFAULT 'no-mocks'
                          CHECK (mock_policy IN ('mocks-allowed','no-mocks')),
  destructive_allowed   BOOLEAN     NOT NULL DEFAULT false,
  data_preservation     TEXT        NOT NULL DEFAULT 'preserve'
                          CHECK (data_preservation IN ('ephemeral','preserve')),
  secret_store_provider TEXT        NOT NULL DEFAULT 'openbao',
  -- provider-config + bootstrap lifecycle (adapter/operation-confirmed, never faked).
  provider_config_status TEXT       NOT NULL DEFAULT 'unconfigured'
                          CHECK (provider_config_status IN ('unconfigured','partial','ready')),
  bootstrap_status      TEXT        NOT NULL DEFAULT 'unbootstrapped'
                          CHECK (bootstrap_status IN ('unbootstrapped','bootstrapping','bootstrapped','degraded')),
  metadata              JSONB       NOT NULL DEFAULT '{}'::jsonb,
  last_bootstrapped_at  TIMESTAMPTZ,
  last_reconciled_at    TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- mocks can never be allowed in staging/production.
  CONSTRAINT environment_registry_no_mocks_in_prod
    CHECK (NOT (stage IN ('staging','production') AND mock_policy = 'mocks-allowed')),
  -- destructive operations can never be allowed in staging/production.
  CONSTRAINT environment_registry_no_destructive_in_prod
    CHECK (NOT (stage IN ('staging','production') AND destructive_allowed = true))
);

CREATE INDEX IF NOT EXISTS environment_registry_stage_idx
  ON public.environment_registry (stage);
