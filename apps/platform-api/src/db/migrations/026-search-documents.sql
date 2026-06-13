-- Migration 026: Tenant-isolated product search (ADR-0060 / ADR-ACT-0258).
--
-- Built-in Postgres full-text search substrate. Meilisearch/Typesense/OpenSearch
-- remain Phase-4.5 provider adapters behind the same SearchIndexPort/SearchQueryPort
-- — NOT delivered here (a container is not a capability). Documents are tenant-scoped
-- (RLS) and carry an optional permission_key for permission-aware query filtering. No
-- secret fields are indexed (enforced in the indexing usecase).
--
-- RLS uses the CANONICAL bypass predicate (migration 012/023/024/025): bypass only when
-- the effective current_user IS rls_bypass (after withSystemAdmin SET LOCAL ROLE) or an
-- INHERITing member — platform_app is NOINHERIT, so under withTenant() RLS enforces.

CREATE TABLE IF NOT EXISTS public.search_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID        NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  -- Producer-supplied stable id within (org, document_type); the upsert key.
  document_id     TEXT        NOT NULL,
  document_type   TEXT        NOT NULL,
  title           TEXT        NOT NULL,
  body            TEXT        NOT NULL DEFAULT '',
  url             TEXT,
  -- Optional permission gate: NULL = visible to any tenant member; otherwise the
  -- caller must hold this permission for the row to appear (filtered at query time).
  permission_key  TEXT,
  search_vector   TSVECTOR,
  metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, document_type, document_id)
);

-- GIN index over the maintained tsvector for fast full-text matching.
CREATE INDEX IF NOT EXISTS search_documents_vector_idx
  ON public.search_documents USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS search_documents_org_type_idx
  ON public.search_documents (organisation_id, document_type);

ALTER TABLE public.search_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.search_documents FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.search_documents;
CREATE POLICY tenant_isolation ON public.search_documents
  USING (
    organisation_id::text = current_setting('app.current_tenant_id', true)
    OR (
      current_user::text = 'rls_bypass'
      OR (
        pg_has_role(current_user, 'rls_bypass', 'MEMBER')
        AND COALESCE(
          (SELECT rolinherit FROM pg_roles WHERE rolname = current_user::text LIMIT 1),
          false
        )
      )
    )
  );
