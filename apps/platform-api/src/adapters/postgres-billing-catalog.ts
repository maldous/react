import type pg from "pg";
import type {
  BillingCatalogPort,
  BillingPlan,
  BillingPrice,
  BillingProduct,
  CreateBillingPlanInput,
  CreateBillingPriceInput,
  CreateBillingProductInput,
} from "../ports/billing-catalog.ts";

type ProductRow = {
  product_id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: Date | null;
};
type PlanRow = {
  plan_id: string;
  product_id: string;
  name: string;
  currency: string;
  billing_period: BillingPlan["billingPeriod"];
  is_active: boolean;
  created_at: Date | null;
};
type PriceRow = {
  price_id: string;
  plan_id: string;
  version: number;
  price_type: BillingPrice["priceType"];
  unit_amount: number;
  currency: string;
  billing_period: BillingPrice["billingPeriod"];
  is_active: boolean;
  created_at: Date | null;
};

const toIso = (d: Date | null) => (d ? d.toISOString() : null);

export class PostgresBillingCatalogAdapter implements BillingCatalogPort {
  constructor(private readonly pool: pg.Pool) {}

  async listProducts(): Promise<BillingProduct[]> {
    const { rows } = await this.pool.query<ProductRow>(
      `SELECT product_id, name, description, is_active, created_at
         FROM public.billing_products
        ORDER BY created_at DESC, name ASC`
    );
    return rows.map((r) => ({
      productId: r.product_id,
      name: r.name,
      description: r.description,
      isActive: r.is_active,
      createdAt: toIso(r.created_at),
    }));
  }

  async listPlans(productId?: string): Promise<BillingPlan[]> {
    const { rows } = productId
      ? await this.pool.query<PlanRow>(
          `SELECT plan_id, product_id, name, currency, billing_period, is_active, created_at
             FROM public.billing_plans
            WHERE product_id = $1
            ORDER BY created_at DESC, name ASC`,
          [productId]
        )
      : await this.pool.query<PlanRow>(
          `SELECT plan_id, product_id, name, currency, billing_period, is_active, created_at
             FROM public.billing_plans
            ORDER BY created_at DESC, name ASC`
        );
    return rows.map((r) => ({
      planId: r.plan_id,
      productId: r.product_id,
      name: r.name,
      currency: r.currency,
      billingPeriod: r.billing_period,
      isActive: r.is_active,
      createdAt: toIso(r.created_at),
    }));
  }

  async listPrices(planId?: string): Promise<BillingPrice[]> {
    const { rows } = planId
      ? await this.pool.query<PriceRow>(
          `SELECT price_id, plan_id, version, price_type, unit_amount, currency, billing_period, is_active, created_at
             FROM public.billing_prices
            WHERE plan_id = $1
            ORDER BY created_at DESC, version DESC`,
          [planId]
        )
      : await this.pool.query<PriceRow>(
          `SELECT price_id, plan_id, version, price_type, unit_amount, currency, billing_period, is_active, created_at
             FROM public.billing_prices
            ORDER BY created_at DESC, version DESC`
        );
    return rows.map((r) => ({
      priceId: r.price_id,
      planId: r.plan_id,
      version: r.version,
      priceType: r.price_type,
      unitAmount: r.unit_amount,
      currency: r.currency,
      billingPeriod: r.billing_period,
      isActive: r.is_active,
      createdAt: toIso(r.created_at),
    }));
  }

  async createProduct(input: CreateBillingProductInput): Promise<BillingProduct> {
    const { rows } = await this.pool.query<ProductRow>(
      `INSERT INTO public.billing_products (name, description, created_by)
       VALUES ($1, $2, $3)
       RETURNING product_id, name, description, is_active, created_at`,
      [input.name, input.description ?? null, input.actorId]
    );
    const r = rows[0]!;
    return {
      productId: r.product_id,
      name: r.name,
      description: r.description,
      isActive: r.is_active,
      createdAt: toIso(r.created_at),
    };
  }

  async createPlan(input: CreateBillingPlanInput): Promise<BillingPlan> {
    const { rows } = await this.pool.query<PlanRow>(
      `INSERT INTO public.billing_plans (product_id, name, currency, billing_period, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING plan_id, product_id, name, currency, billing_period, is_active, created_at`,
      [input.productId, input.name, input.currency, input.billingPeriod, input.actorId]
    );
    const r = rows[0]!;
    return {
      planId: r.plan_id,
      productId: r.product_id,
      name: r.name,
      currency: r.currency,
      billingPeriod: r.billing_period,
      isActive: r.is_active,
      createdAt: toIso(r.created_at),
    };
  }

  async createPrice(input: CreateBillingPriceInput): Promise<BillingPrice> {
    const { rows } = await this.pool.query<PriceRow>(
      `WITH next_version AS (
         SELECT COALESCE(MAX(version), 0) + 1 AS version
           FROM public.billing_prices
          WHERE plan_id = $1
       )
       INSERT INTO public.billing_prices
         (plan_id, version, price_type, unit_amount, currency, billing_period, created_by)
       SELECT $1, next_version.version, $2, $3, $4, $5, $6
         FROM next_version
       RETURNING price_id, plan_id, version, price_type, unit_amount, currency, billing_period, is_active, created_at`,
      [
        input.planId,
        input.priceType,
        input.unitAmount,
        input.currency,
        input.billingPeriod,
        input.actorId,
      ]
    );
    const r = rows[0]!;
    return {
      priceId: r.price_id,
      planId: r.plan_id,
      version: r.version,
      priceType: r.price_type,
      unitAmount: r.unit_amount,
      currency: r.currency,
      billingPeriod: r.billing_period,
      isActive: r.is_active,
      createdAt: toIso(r.created_at),
    };
  }
}
