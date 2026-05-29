-- Migration 003: per-tenant per-resource provisioning config
--
-- Stores which infrastructure tier each resource type uses for a given tenant
-- and the connection config required for non-shared tiers.
--
-- Lives in the public (global) schema — not per-tenant — because it must be
-- readable before the tenant schema is selected (e.g. for routing decisions).
--
-- ADR-0031: provider-agnostic provisioning; each resource independently configurable.
-- ADR-ACT-0142: tenant provisioning API.

CREATE TABLE IF NOT EXISTS public.tenant_resource_config (
  organisation_id  UUID        PRIMARY KEY REFERENCES public.organisations(id) ON DELETE CASCADE,

  -- Database resource
  database_tier    TEXT        NOT NULL DEFAULT 'shared'
                               CHECK (database_tier IN ('shared','dedicated','external','air-gapped')),
  database_config  JSONB       NOT NULL DEFAULT '{}',

  -- Identity / Keycloak resource
  identity_tier    TEXT        NOT NULL DEFAULT 'shared'
                               CHECK (identity_tier IN ('shared','dedicated','external','air-gapped')),
  identity_config  JSONB       NOT NULL DEFAULT '{}',

  -- Cache / Redis resource
  cache_tier       TEXT        NOT NULL DEFAULT 'shared'
                               CHECK (cache_tier IN ('shared','dedicated','external','air-gapped')),
  cache_config     JSONB       NOT NULL DEFAULT '{}',

  -- Object storage resource
  storage_tier     TEXT        NOT NULL DEFAULT 'shared'
                               CHECK (storage_tier IN ('shared','dedicated','external','air-gapped')),
  storage_config   JSONB       NOT NULL DEFAULT '{}',

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tenant_resource_config IS
  'Per-tenant infrastructure tier selection and connection config. '
  'Each resource type (database, identity, cache, storage) is independently '
  'configurable. Config is stored here rather than in the tenant schema so it '
  'is readable before schema routing is established.';

COMMENT ON COLUMN public.tenant_resource_config.database_config IS
  'JSON config for non-shared tiers. For dedicated: {connectionUrl}. '
  'For external: {connectionUrl}. Sensitive values are stored as secret refs.';
