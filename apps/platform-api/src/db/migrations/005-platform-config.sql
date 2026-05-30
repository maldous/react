-- Migration 005: platform_config ? quota and capacity governance
--
-- Stores platform-wide configuration including per-tenant quotas.
-- ADR-0031: quota/capacity governance is a system-admin responsibility;
-- changes to this table require sysadmin action.

CREATE TABLE IF NOT EXISTS public.platform_config (
  key        TEXT        PRIMARY KEY,
  value      JSONB       NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT        -- who last changed this value (userId or 'system')
);

COMMENT ON TABLE public.platform_config IS
  'Platform-wide configuration: quotas, capacity limits, feature flags. '
  'Changes require system-admin action (ADR-0031 ?Quota and capacity governance).';

-- Default quota values
INSERT INTO public.platform_config (key, value, updated_by) VALUES
  ('quota.max_tenants',           '100',   'system'),
  ('quota.max_sub_tenants',       '10',    'system'),
  ('quota.max_members_per_tenant','500',   'system'),
  ('quota.max_storage_gb',        '10',    'system'),
  ('feature.tenant_provisioning', 'true',  'system'),
  ('feature.multi_realm',         'true',  'system')
ON CONFLICT (key) DO NOTHING;
