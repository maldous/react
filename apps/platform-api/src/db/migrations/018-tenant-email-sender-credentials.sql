-- Migration 018: Per-tenant email sender credentials (ADR-0047 / ADR-ACT-0216)
--
-- Stores the write-only email-sending secret (SMTP password or provider API key)
-- for each tenant's configured email sender. Non-secret sender config (provider,
-- fromName, fromEmail, replyToEmail, enabled) lives in tenant_settings under the
-- "email.sender" key; only the secret lives here.
--
-- Design decisions mirror migration 009 (tenant_auth_settings_credentials):
--
--   No RLS: platform-managed infrastructure secret, not tenant user data.
--   Accessed exclusively via withSystemAdmin() (rls_bypass role).
--
--   Encryption: secret_enc stores the secret as AES-256-GCM (format
--   enc:<iv_hex>:<ct_hex>:<tag_hex>) keyed by TENANT_SECRET_ENCRYPTION_KEY.
--   In development without the key it is stored with an "unenc:" prefix and a
--   logged warning. Production deployments MUST set the key. Application-level
--   AES defends against database-dump exposure, not full app-server compromise.
--
--   last_validated_at is set when a test-send against the stored credential
--   succeeds; readiness reports "configured" only once a credential is validated
--   (or for the local dev sink), never faked.

CREATE TABLE IF NOT EXISTS public.tenant_email_sender_credentials (
  organisation_id   UUID PRIMARY KEY,
  secret_enc        TEXT        NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_validated_at TIMESTAMPTZ,
  rotated_by        TEXT
);
