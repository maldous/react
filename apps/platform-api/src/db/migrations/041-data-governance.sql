CREATE TABLE IF NOT EXISTS public.data_catalog (
  dataset_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner TEXT NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN ('none','pii','sensitive')),
  lineage_edges TEXT[] NOT NULL DEFAULT '{}',
  created_by UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.data_classifications (
  classification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID NOT NULL REFERENCES public.data_catalog(dataset_id) ON DELETE CASCADE,
  column_name TEXT NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN ('none','pii','sensitive')),
  rule TEXT NOT NULL,
  created_by UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.dsr_requests (
  dsr_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL,
  subject_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('access','erasure','portability')),
  state TEXT NOT NULL CHECK (state IN ('open','fulfilled')),
  reason TEXT NOT NULL,
  created_by UUID NULL,
  fulfilled_by UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  fulfilled_at TIMESTAMPTZ NULL
);
