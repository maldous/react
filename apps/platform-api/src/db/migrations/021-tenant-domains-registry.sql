-- Migration 021: tenant_domains lifecycle registry (ADR-ACT-0231 / ADR-ACT-0232)
--
-- Explicit, first-class custom-domain lifecycle state. Replaces the implicit
-- overloading of vanity_domain_challenges.consumed_at (which meant BOTH
-- "challenge superseded" and "domain added to the tenant auth client").
-- Challenge history in vanity_domain_challenges is PRESERVED untouched ?
-- challenges remain the DNS-ownership-proof mechanism; this table is the
-- domain's durable lifecycle record.
--
-- Status vocabulary mirrors @platform/contracts-admin (honest, never faked):
--   ownership_status   pending_dns | dns_mismatch | verified
--   auth_client_status inactive | active            (Keycloak redirect/web-origin)
--   routing_status     routing_unknown | routing_local_active | routing_active
--   tls_status         tls_unknown | tls_local_ready | tls_ready
--   redirect_policy    no_redirect | redirect_slug_to_canonical | redirect_all_to_canonical
--
-- routing_* and tls_* may ONLY be upgraded by a live probe (BFF probe route or
-- proof script) ? never inferred from other columns.

CREATE TABLE IF NOT EXISTS public.tenant_domains (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id           UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  domain                    TEXT NOT NULL,
  source                    TEXT NOT NULL DEFAULT 'custom'
                              CHECK (source IN ('slug', 'custom')),
  ownership_status          TEXT NOT NULL DEFAULT 'pending_dns'
                              CHECK (ownership_status IN ('pending_dns', 'dns_mismatch', 'verified')),
  auth_client_status        TEXT NOT NULL DEFAULT 'inactive'
                              CHECK (auth_client_status IN ('inactive', 'active')),
  routing_status            TEXT NOT NULL DEFAULT 'routing_unknown'
                              CHECK (routing_status IN ('routing_unknown', 'routing_local_active', 'routing_active')),
  tls_status                TEXT NOT NULL DEFAULT 'tls_unknown'
                              CHECK (tls_status IN ('tls_unknown', 'tls_local_ready', 'tls_ready')),
  canonical                 BOOLEAN NOT NULL DEFAULT false,
  redirect_policy           TEXT NOT NULL DEFAULT 'no_redirect'
                              CHECK (redirect_policy IN ('no_redirect', 'redirect_slug_to_canonical', 'redirect_all_to_canonical')),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at               TIMESTAMPTZ,
  auth_client_activated_at  TIMESTAMPTZ,
  routing_local_proven_at   TIMESTAMPTZ,
  routing_public_proven_at  TIMESTAMPTZ,
  tls_local_proven_at       TIMESTAMPTZ,
  tls_public_proven_at      TIMESTAMPTZ,
  canonical_at              TIMESTAMPTZ,
  disabled_at               TIMESTAMPTZ
);

-- An enabled custom domain maps to exactly ONE tenant (cross-tenant takeover guard).
CREATE UNIQUE INDEX IF NOT EXISTS tenant_domains_domain_enabled_idx
  ON public.tenant_domains (domain)
  WHERE disabled_at IS NULL;

-- At most one canonical domain per organisation.
CREATE UNIQUE INDEX IF NOT EXISTS tenant_domains_canonical_per_org_idx
  ON public.tenant_domains (organisation_id)
  WHERE canonical AND disabled_at IS NULL;

-- Host resolution lookup: active custom domain -> tenant.
CREATE INDEX IF NOT EXISTS tenant_domains_resolution_idx
  ON public.tenant_domains (domain)
  WHERE ownership_status = 'verified' AND auth_client_status = 'active' AND disabled_at IS NULL;

CREATE INDEX IF NOT EXISTS tenant_domains_org_idx
  ON public.tenant_domains (organisation_id);

-- ---------------------------------------------------------------------------
-- Honest backfill from vanity_domain_challenges (history untouched).
-- Per (organisation, domain) the best surviving evidence wins:
--   verified AND consumed  -> ownership verified + auth client active
--                             (consumeChallenge ran only after the Keycloak
--                              client PUT succeeded ? a real persisted fact)
--   verified, not consumed -> ownership verified, auth client inactive
--   otherwise              -> pending_dns (a challenge exists, unproven)
-- routing/tls are NOT backfilled ? no probe ever persisted them (no fake
-- readiness). canonical is NOT backfilled ? the concept did not exist.
-- ---------------------------------------------------------------------------
INSERT INTO public.tenant_domains
  (organisation_id, domain, source, ownership_status, auth_client_status,
   created_at, verified_at, auth_client_activated_at)
SELECT DISTINCT ON (c.organisation_id, c.domain)
  c.organisation_id,
  c.domain,
  'custom',
  CASE WHEN c.verified_at IS NOT NULL THEN 'verified' ELSE 'pending_dns' END,
  CASE WHEN c.verified_at IS NOT NULL AND c.consumed_at IS NOT NULL THEN 'active' ELSE 'inactive' END,
  c.created_at,
  c.verified_at,
  CASE WHEN c.verified_at IS NOT NULL THEN c.consumed_at ELSE NULL END
FROM public.vanity_domain_challenges c
-- Long-lived local databases may hold orphan challenge rows (the table predates
-- the FK in some environments and old proof runs deleted their organisations).
-- Only organisations that still exist are backfilled.
JOIN public.organisations o ON o.id = c.organisation_id
ORDER BY
  c.organisation_id,
  c.domain,
  -- evidence rank: verified+consumed first, then verified, then most recent
  (CASE
     WHEN c.verified_at IS NOT NULL AND c.consumed_at IS NOT NULL THEN 0
     WHEN c.verified_at IS NOT NULL THEN 1
     ELSE 2
   END),
  c.created_at DESC
ON CONFLICT DO NOTHING;
