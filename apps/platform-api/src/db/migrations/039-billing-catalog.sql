-- Migration 039: Billing catalogue (ADR-ACT-0241 slice)
CREATE TABLE IF NOT EXISTS public.billing_products (
  product_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.billing_plans (
  plan_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.billing_products(product_id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  currency TEXT NOT NULL,
  billing_period TEXT NOT NULL CHECK (billing_period IN ('monthly', 'annual', 'one_time')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, name)
);

CREATE TABLE IF NOT EXISTS public.billing_prices (
  price_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES public.billing_plans(plan_id) ON DELETE RESTRICT,
  version INTEGER NOT NULL,
  price_type TEXT NOT NULL CHECK (price_type IN ('flat', 'per_unit', 'tiered')),
  unit_amount INTEGER NOT NULL CHECK (unit_amount >= 0),
  currency TEXT NOT NULL,
  billing_period TEXT NOT NULL CHECK (billing_period IN ('monthly', 'annual', 'one_time')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (plan_id, version)
);

ALTER TABLE public.billing_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_products FORCE ROW LEVEL SECURITY;
ALTER TABLE public.billing_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_plans FORCE ROW LEVEL SECURITY;
ALTER TABLE public.billing_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_prices FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS billing_catalog_global_read ON public.billing_products;
CREATE POLICY billing_catalog_global_read ON public.billing_products
  FOR SELECT USING (true);
DROP POLICY IF EXISTS billing_catalog_global_read ON public.billing_plans;
CREATE POLICY billing_catalog_global_read ON public.billing_plans
  FOR SELECT USING (true);
DROP POLICY IF EXISTS billing_catalog_global_read ON public.billing_prices;
CREATE POLICY billing_catalog_global_read ON public.billing_prices
  FOR SELECT USING (true);
