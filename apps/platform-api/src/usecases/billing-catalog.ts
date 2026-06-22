import type {
  BillingCatalogPort,
  BillingPlan,
  BillingPrice,
  BillingProduct,
  CreateBillingPlanInput,
  CreateBillingPriceInput,
  CreateBillingProductInput,
} from "../ports/billing-catalog.ts";
import { AuditAction, createAuditEvent, type AuditEventPort } from "@platform/audit-events";

export interface BillingCatalogDeps {
  catalog: BillingCatalogPort;
}

export interface BillingCatalogMutationDeps extends BillingCatalogDeps {
  audit: AuditEventPort;
}

export interface BillingCatalogActor {
  actorId: string;
  actorRoles: string[];
  sourceHost?: string;
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
  input: CreateBillingProductInput & { actor: BillingCatalogActor },
  deps: BillingCatalogMutationDeps
): Promise<BillingProduct> {
  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actor.actorId,
      actorRoles: input.actor.actorRoles,
      tenantId: input.actor.actorId,
      action: AuditAction.BillingCatalogProductCreated,
      resource: "billing_catalog_product",
      resourceId: input.name,
      metadata: { name: input.name, hasDescription: input.description != null },
      sourceHost: input.actor.sourceHost,
    })
  );
  return deps.catalog.createProduct(input);
}

export async function createBillingCatalogPlan(
  input: CreateBillingPlanInput & { actor: BillingCatalogActor },
  deps: BillingCatalogMutationDeps
): Promise<BillingPlan> {
  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actor.actorId,
      actorRoles: input.actor.actorRoles,
      tenantId: input.actor.actorId,
      action: AuditAction.BillingCatalogPlanCreated,
      resource: "billing_catalog_plan",
      resourceId: input.name,
      metadata: {
        productId: input.productId,
        name: input.name,
        currency: input.currency,
        billingPeriod: input.billingPeriod,
      },
      sourceHost: input.actor.sourceHost,
    })
  );
  return deps.catalog.createPlan(input);
}

export async function createBillingCatalogPrice(
  input: CreateBillingPriceInput & { actor: BillingCatalogActor },
  deps: BillingCatalogMutationDeps
): Promise<BillingPrice> {
  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actor.actorId,
      actorRoles: input.actor.actorRoles,
      tenantId: input.actor.actorId,
      action: AuditAction.BillingCatalogPriceCreated,
      resource: "billing_catalog_price",
      resourceId: input.planId,
      metadata: {
        planId: input.planId,
        priceType: input.priceType,
        unitAmount: input.unitAmount,
        currency: input.currency,
        billingPeriod: input.billingPeriod,
      },
      sourceHost: input.actor.sourceHost,
    })
  );
  return deps.catalog.createPrice(input);
}
