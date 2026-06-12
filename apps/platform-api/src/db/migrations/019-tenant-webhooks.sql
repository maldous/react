-- Migration 019: Tenant outbound webhooks (ADR-0051 / ADR-ACT-0221)
--
-- Per-tenant webhook subscriptions + a delivery log. The signing secret is stored
-- AES-256-GCM encrypted (`secret_enc`, reusing the ADR-0041 TENANT_SECRET_ENCRYPTION_KEY
-- pattern) and is reveal-once (returned only by create + rotate, never by a read).
-- Public schema with an explicit organisation_id filter + FK ON DELETE CASCADE, like
-- public.vanity_domain_challenges (migration 014). No RLS: platform-managed integration
-- infrastructure accessed by the BFF with an explicit tenant filter.

CREATE TABLE IF NOT EXISTS public.tenant_webhook_subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID        NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  url             TEXT        NOT NULL,
  event_types     TEXT[]      NOT NULL DEFAULT '{}',
  enabled         BOOLEAN     NOT NULL DEFAULT true,
  secret_enc      TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tenant_webhook_subscriptions_org_idx
  ON public.tenant_webhook_subscriptions (organisation_id);

CREATE TABLE IF NOT EXISTS public.tenant_webhook_deliveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID        NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  subscription_id UUID        NOT NULL REFERENCES public.tenant_webhook_subscriptions(id) ON DELETE CASCADE,
  event           TEXT        NOT NULL,
  status          TEXT        NOT NULL,
  response_status INTEGER,
  attempt         INTEGER     NOT NULL DEFAULT 1,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Newest-first delivery lookups, scoped to a tenant + subscription.
CREATE INDEX IF NOT EXISTS tenant_webhook_deliveries_lookup_idx
  ON public.tenant_webhook_deliveries (organisation_id, subscription_id, created_at DESC);
