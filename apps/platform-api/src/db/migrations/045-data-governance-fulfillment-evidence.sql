-- Migration 045: Add fulfillment evidence to DSR records
ALTER TABLE public.dsr_requests
  ADD COLUMN IF NOT EXISTS fulfillment_evidence JSONB NULL;
