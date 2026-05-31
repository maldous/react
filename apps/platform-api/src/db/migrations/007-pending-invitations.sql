-- Pending invitations created during tenant provisioning for admin users
-- who have not yet registered. Consumed on first login (JIT membership).
CREATE TABLE IF NOT EXISTS public.pending_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  organisation_id UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'tenant-admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '72 hours'),
  consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS pending_invitations_email_idx
  ON public.pending_invitations (email)
  WHERE consumed_at IS NULL;

-- Audit events table — used by createPostgresAuditEventPort (ADR-ACT-0148).
CREATE TABLE IF NOT EXISTS public.audit_events (
  id UUID PRIMARY KEY,
  actor_id TEXT NOT NULL,
  actor_roles TEXT[] NOT NULL DEFAULT '{}',
  tenant_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  metadata JSONB,
  source_host TEXT,
  correlation_id TEXT,
  timestamp TIMESTAMPTZ NOT NULL,
  ip_address TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS audit_events_tenant_idx ON public.audit_events (tenant_id, timestamp DESC);
