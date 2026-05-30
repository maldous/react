-- Migration 002: tenant_settings table
--
-- Creates tenant_settings within each tenant's schema (schema-per-tenant, ADR-0029).
-- This migration is applied per-tenant by the withTenant migration runner (ADR-0031).
--
-- tenant_settings holds theme/branding config returned by GET /api/theme (ADR-0029 ?4)
-- and other per-tenant runtime configuration (feature flags, quotas).
--
-- This migration runs within SET LOCAL search_path = "tenant_{id}", public
-- so the table is created inside the correct tenant schema.

CREATE TABLE IF NOT EXISTS tenant_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed default theme configuration
INSERT INTO tenant_settings (key, value)
VALUES
  ('theme.displayName',   '"Enterprise Platform"'),
  ('theme.primaryColour', '"#4f46e5"'),
  ('theme.logoUrl',       'null'),
  ('theme.faviconUrl',    'null')
ON CONFLICT (key) DO NOTHING;
