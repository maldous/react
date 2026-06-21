export type BillingPeriod = "monthly" | "annual" | "one_time";
export type PriceType = "flat" | "per_unit" | "tiered";

export interface BillingProduct {
  productId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string | null;
}

export interface BillingPlan {
  planId: string;
  productId: string;
  name: string;
  currency: string;
  billingPeriod: BillingPeriod;
  isActive: boolean;
  createdAt: string | null;
}

export interface BillingPrice {
  priceId: string;
  planId: string;
  version: number;
  priceType: PriceType;
  unitAmount: number;
  currency: string;
  billingPeriod: BillingPeriod;
  isActive: boolean;
  createdAt: string | null;
}

export interface CreateBillingProductInput {
  name: string;
  description?: string | null;
  actorId: string;
}

export interface CreateBillingPlanInput {
  productId: string;
  name: string;
  currency: string;
  billingPeriod: BillingPeriod;
  actorId: string;
}

export interface CreateBillingPriceInput {
  planId: string;
  priceType: PriceType;
  unitAmount: number;
  currency: string;
  billingPeriod: BillingPeriod;
  actorId: string;
}

export interface BillingCatalogPort {
  listProducts(): Promise<BillingProduct[]>;
  listPlans(productId?: string): Promise<BillingPlan[]>;
  listPrices(planId?: string): Promise<BillingPrice[]>;
  createProduct(input: CreateBillingProductInput): Promise<BillingProduct>;
  createPlan(input: CreateBillingPlanInput): Promise<BillingPlan>;
  createPrice(input: CreateBillingPriceInput): Promise<BillingPrice>;
}
