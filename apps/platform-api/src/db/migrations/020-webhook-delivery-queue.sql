-- Migration 020: Webhook durable delivery queue (ADR-0052 / ADR-ACT-0222)
--
-- Extends the ADR-0051 delivery log so a background worker can retry deliveries with
-- backoff and dead-letter exhausted ones. `next_attempt_at` is when the row is next
-- due (the worker claims rows pending/processing whose next_attempt_at <= now), and
-- `payload` holds the event data so the worker can rebuild + re-sign the body per
-- attempt. Rows written by the immediate POST .../test path stay terminal
-- (delivered/failed) and are never claimed (status not in pending/processing).

ALTER TABLE public.tenant_webhook_deliveries
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payload TEXT;

-- The worker scans due rows by (status, next_attempt_at).
CREATE INDEX IF NOT EXISTS tenant_webhook_deliveries_due_idx
  ON public.tenant_webhook_deliveries (next_attempt_at)
  WHERE status IN ('pending', 'processing');
