-- Migration 006: Remove Row-Level Security from public.organisations
--
-- Rationale (ADR-0029 §1a):
-- The organisations table stores slug→id mappings used for FQDN-based tenant
-- routing. These lookups happen before any session exists (in tenant_resolver.ts
-- and forward-auth.ts). Adding RLS would require withSystemAdmin() on every
-- incoming request — a performance overhead for non-sensitive data.
--
-- The meaningful isolation boundary is schema-per-tenant (PostgreSQL schemas),
-- not row-level access control on the organisations lookup table itself.
-- An organisation slug is not sensitive — it is the public subdomain.
--
-- Migration 004 added RLS to organisations as part of the initial batch.
-- This migration corrects that decision without modifying the original
-- committed migration file (which would break the checksum invariant).
--
-- RLS on memberships, users, external_identities, and tenant_resource_config
-- is intentionally retained — those tables scope data that must not be visible
-- across tenants.

ALTER TABLE public.organisations DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.organisations;
