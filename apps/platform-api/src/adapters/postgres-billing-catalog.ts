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

export interface PostgresBillingCatalogProviderConfig {
  statementTimeoutMs: number;
  retryAttempts: number;
  retryBackoffMs: number;
  configSource: "POSTGRES_APP_URL";
  secretSource: "POSTGRES_APP_URL";
}

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

export function loadPostgresBillingCatalogProviderConfig(
  env: NodeJS.ProcessEnv = process.env
): PostgresBillingCatalogProviderConfig {
  return {
    statementTimeoutMs: Number(env["BILLING_CATALOG_QUERY_TIMEOUT_MS"] ?? "5000"),
    retryAttempts: Number(env["BILLING_CATALOG_RETRY_ATTEMPTS"] ?? "1"),
    retryBackoffMs: Number(env["BILLING_CATALOG_RETRY_BACKOFF_MS"] ?? "100"),
    configSource: "POSTGRES_APP_URL",
    secretSource: "POSTGRES_APP_URL",
  };
}

export class PostgresBillingCatalogAdapter implements BillingCatalogPort {
  private readonly providerConfig: PostgresBillingCatalogProviderConfig;

  constructor(
    private readonly pool: pg.Pool,
    config: Partial<PostgresBillingCatalogProviderConfig> = {}
  ) {
    this.providerConfig = {
      ...loadPostgresBillingCatalogProviderConfig(),
      ...config,
    };
  }

  async listProducts(): Promise<BillingProduct[]> {
    const { rows } = await this.query<ProductRow>(
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
      ? await this.query<PlanRow>(
          `SELECT plan_id, product_id, name, currency, billing_period, is_active, created_at
             FROM public.billing_plans
            WHERE product_id = $1
            ORDER BY created_at DESC, name ASC`,
          [productId]
        )
      : await this.query<PlanRow>(
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
      ? await this.query<PriceRow>(
          `SELECT price_id, plan_id, version, price_type, unit_amount, currency, billing_period, is_active, created_at
             FROM public.billing_prices
            WHERE plan_id = $1
            ORDER BY created_at DESC, version DESC`,
          [planId]
        )
      : await this.query<PriceRow>(
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
    const { rows } = await this.query<ProductRow>(
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
    const { rows } = await this.query<PlanRow>(
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
    const { rows } = await this.query<PriceRow>(
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

  async healthCheck(): Promise<{ status: "ready"; provider: "postgres-billing-catalog" }> {
    await this.query<{ ok: number }>(
      `SELECT 1 AS ok
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('billing_products', 'billing_plans', 'billing_prices')
        LIMIT 1`
    );
    return { status: "ready", provider: "postgres-billing-catalog" };
  }

  recoveryAction(): string {
    return "operator recovery: verify POSTGRES_APP_URL secret/config, run db migrations through 039-billing-catalog.sql, inspect billing catalog table grants, then retry the failed catalog operation";
  }

  private async query<T extends pg.QueryResultRow>(
    sql: string,
    values?: unknown[]
  ): Promise<pg.QueryResult<T>> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.providerConfig.retryAttempts; attempt += 1) {
      try {
        await this.pool.query("SELECT set_config('statement_timeout', $1, true)", [
          `${this.providerConfig.statementTimeoutMs}ms`,
        ]);
        return await this.pool.query<T>(sql, values);
      } catch (err) {
        lastError = err;
        if (attempt >= this.providerConfig.retryAttempts) break;
        await new Promise((resolve) =>
          setTimeout(resolve, this.providerConfig.retryBackoffMs * (attempt + 1))
        );
      }
    }
    throw new Error(
      `postgres-billing-catalog unavailable; no fallback is allowed for catalog persistence, fail-closed after retry attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    );
  }
}
