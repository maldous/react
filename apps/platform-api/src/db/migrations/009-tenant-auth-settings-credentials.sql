-- Migration 009: Per-tenant Auth Settings service account credentials (ADR-ACT-0186)
--
-- Stores the client ID and encrypted client secret for each tenant's
-- realm-admin service account used by the Auth Settings API. This replaces
-- the previous pattern of using the global platform-provisioner credential
-- (a master-realm service account with cross-realm access) for every tenant.
--
-- Design decisions:
--
--   No RLS: this table stores platform-managed infrastructure credentials,
--   not tenant user data. It is accessed exclusively via withSystemAdmin(),
--   which carries the rls_bypass role (ADR-ACT-0184). Applying FORCE ROW
--   LEVEL SECURITY would cause spurious no_credential results when the
--   calling transaction does not have the GUC set — exactly the failure mode
--   migration 006 avoided for public.organisations.
--
--   Separate table: credentials must survive resource-config updates.
--   Storing them in tenant_resource_config.identity_config is unsafe because
--   the ON CONFLICT … DO UPDATE overwrites the entire identity_config JSONB
--   column, silently discarding secrets on every resource-config change.
--
--   Encryption: client_secret_enc stores the secret as AES-256-GCM encrypted
--   base64 (format: <iv_hex>:<ciphertext_hex>). The encryption key is
--   controlled by TENANT_SECRET_ENCRYPTION_KEY env var. If absent in
--   development the value is stored with an explicit "unenc:" prefix and a
--   startup warning is emitted. Production deployments must set this var.
--   Application-level AES encryption is not equivalent to HSM/KMS protection
--   — it defends against database dump exposure but not against full app-server
--   compromise. A KMS-backed solution is a future hardening step.

CREATE TABLE IF NOT EXISTS public.tenant_auth_settings_credentials (
  organisation_id UUID PRIMARY KEY,
  client_id       TEXT        NOT NULL,
  client_secret_enc TEXT      NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
