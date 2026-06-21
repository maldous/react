CREATE TABLE IF NOT EXISTS public.storage_objects (
  object_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL,
  object_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  scan_state TEXT NOT NULL CHECK (scan_state IN ('uploaded','quarantined','scanning','clean','rejected')),
  created_by UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, object_key)
);
