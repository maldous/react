import type {
  BillingCatalogPort,
  BillingPlan,
  BillingPrice,
  BillingProduct,
  CreateBillingPlanInput,
  CreateBillingPriceInput,
  CreateBillingProductInput,
} from "../ports/billing-catalog.ts";

export interface BillingCatalogDeps {
  catalog: BillingCatalogPort;
}

export async function listBillingCatalogProducts(
  deps: BillingCatalogDeps
): Promise<BillingProduct[]> {
  return deps.catalog.listProducts();
}

export async function listBillingCatalogPlans(
  deps: BillingCatalogDeps,
  productId?: string
): Promise<BillingPlan[]> {
  return deps.catalog.listPlans(productId);
}

export async function listBillingCatalogPrices(
  deps: BillingCatalogDeps,
  planId?: string
): Promise<BillingPrice[]> {
  return deps.catalog.listPrices(planId);
}

export async function createBillingCatalogProduct(
  input: CreateBillingProductInput,
  deps: BillingCatalogDeps
): Promise<BillingProduct> {
  return deps.catalog.createProduct(input);
}

export async function createBillingCatalogPlan(
  input: CreateBillingPlanInput,
  deps: BillingCatalogDeps
): Promise<BillingPlan> {
  return deps.catalog.createPlan(input);
}

export async function createBillingCatalogPrice(
  input: CreateBillingPriceInput,
  deps: BillingCatalogDeps
): Promise<BillingPrice> {
  return deps.catalog.createPrice(input);
}
