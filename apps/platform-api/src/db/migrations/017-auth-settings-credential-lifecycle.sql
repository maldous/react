-- Migration 017: Auth Settings credential lifecycle metadata (ADR-0044 / ADR-ACT-0212)
--
-- Adds operational lifecycle metadata to the per-tenant auth-settings credential
-- so system-admins can see credential health and audit rotation/repair without
-- ever exposing the secret. None of these columns store the secret or any raw
-- Keycloak response.
--
--   last_validated_at     — when the stored credential last passed a readiness
--                           probe (we only store after a successful probe).
--   last_rotated_at       — when the credential was last attached/rotated/repaired.
--   rotated_by            — actor id (system-admin) of the last lifecycle write.
--   validation_error_kind — reserved for a future failure-history surface; NULL
--                           on success. Non-secret classification only.
--
-- readiness_status is intentionally NOT stored: it is derived from a live probe
-- (ADR-0041 vocabulary), so a stale column can never misreport credential health.

ALTER TABLE public.tenant_auth_settings_credentials
  ADD COLUMN IF NOT EXISTS last_validated_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_rotated_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rotated_by            TEXT,
  ADD COLUMN IF NOT EXISTS validation_error_kind TEXT;
