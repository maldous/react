CREATE TABLE IF NOT EXISTS public.portable_import_progress (
  organisation_id UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  archive_digest TEXT NOT NULL,
  completed_orders INTEGER[] NOT NULL DEFAULT '{}',
  failed_order INTEGER,
  error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organisation_id, archive_digest)
);

CREATE INDEX IF NOT EXISTS portable_import_progress_org_idx
  ON public.portable_import_progress (organisation_id, updated_at DESC);
