-- Migration 014: Vanity domain ownership challenges (ADR-ACT-0188)
--
-- Before a tenant can add a vanity domain to their Keycloak BFF client,
-- they must prove ownership via a DNS TXT record at:
--   _aldous-verify.<domain>  →  value must contain the challenge token
--
-- Lifecycle:
--   1. POST /api/auth/settings/domains/challenges  — creates a challenge row
--   2. Tenant configures _aldous-verify.<domain> TXT record with the token
--   3. POST /api/auth/settings/domains/verify  — DNS lookup, marks verified_at
--   4. POST /api/auth/settings/domains  — only succeeds if challenge exists,
--      verified, not expired, and not yet consumed

CREATE TABLE IF NOT EXISTS public.vanity_domain_challenges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  domain          TEXT NOT NULL,
  token           TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'),
  verified_at     TIMESTAMPTZ,
  consumed_at     TIMESTAMPTZ
);

-- Only one unconsumed challenge per domain per org
-- (expiry is enforced at application level, not index level, since now() is not IMMUTABLE)
CREATE UNIQUE INDEX IF NOT EXISTS vanity_domain_challenges_domain_org_active_idx
  ON public.vanity_domain_challenges (domain, organisation_id)
  WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS vanity_domain_challenges_domain_idx
  ON public.vanity_domain_challenges (domain)
  WHERE verified_at IS NOT NULL AND consumed_at IS NULL;
