-- Migration 032: Provider configuration plane (ADR-0070 / ADR-ACT-0266) — Tier-1 kernel.
--
-- A first-class config plane for composed providers: which concrete provider serves a
-- USF capability in a given environment, its environment classification, lifecycle
-- state, non-secret endpoint/config, and — critically — its credentials BY REFERENCE
-- (`credential_ref` = an opaque secret:<uuid> into the ADR-0069 secret store), never as
-- plaintext. Operator-global infra (no tenant column); accessed via withSystemAdmin
-- (mirrors worker_heartbeats). No secret value ever lives in this table.

CREATE TABLE IF NOT EXISTS public.provider_configs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- concrete provider, e.g. 'meilisearch' | 'openbao' | 'prometheus'.
  provider_key    TEXT        NOT NULL,
  -- the USF capability this provider serves, e.g. 'search-indexing' | 'runtime-secrets'.
  capability      TEXT        NOT NULL,
  -- deployment-ladder environment (ADR-0056).
  environment     TEXT        NOT NULL CHECK (environment IN ('development','test','staging','production')),
  instance_label  TEXT        NOT NULL DEFAULT 'default',
  -- environment-service classification (ADR-0056 vocabulary).
  classification  TEXT        NOT NULL,
  -- provider lifecycle (ADR-0070): candidate -> configured -> ready (adapter-confirmed);
  -- degraded when the backend/credential is not usable; disabled when turned off.
  lifecycle_state TEXT        NOT NULL DEFAULT 'candidate'
                    CHECK (lifecycle_state IN ('candidate','configured','degraded','ready','disabled')),
  -- non-secret connection endpoint (host/url). NEVER a credential.
  endpoint        TEXT,
  -- opaque secret reference (secret:<uuid>) into the secret store; NEVER a plaintext secret.
  credential_ref  TEXT,
  -- non-secret config only (secret-bearing keys are rejected at the usecase layer).
  config          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      TEXT,
  UNIQUE (provider_key, environment, instance_label),
  -- a stored credential reference must be an opaque secret-store ref, never a raw secret.
  CONSTRAINT provider_configs_credential_ref_is_opaque
    CHECK (credential_ref IS NULL OR credential_ref LIKE 'secret:%'),
  -- a mock / forbidden-in-production provider can never be active in production.
  CONSTRAINT provider_configs_no_forbidden_in_prod
    CHECK (NOT (environment = 'production'
                AND classification = 'forbidden-in-production'
                AND lifecycle_state IN ('configured','ready')))
);

CREATE INDEX IF NOT EXISTS provider_configs_capability_idx
  ON public.provider_configs (capability, environment);
