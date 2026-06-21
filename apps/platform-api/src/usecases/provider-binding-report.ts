import { buildServiceCatalog } from "./service-catalog.ts";
import { listProviderConfigs } from "./provider-config.ts";
import type { ProviderConfigRecord } from "../ports/provider-config-repository.ts";

export interface ProviderBindingSummary {
  serviceKey: string;
  providerKey: string | null;
  environment: string;
  lifecycleState: string | null;
}

export interface ProviderBindingReport {
  bindings: ProviderBindingSummary[];
  ready: boolean;
}

export async function buildProviderBindingReport(deps: {
  environment: ProviderConfigRecord["environment"];
  providerConfigs: Parameters<typeof listProviderConfigs>[0];
}): Promise<ProviderBindingReport> {
  const catalog = buildServiceCatalog({ operator: true });
  const providers = await listProviderConfigs(deps.providerConfigs);
  const byCapability = new Map(
    providers.providers.map((p) => [`${p.capability}:${p.environment}`, p] as const)
  );
  const bindings = catalog.services.map((service) => {
    const provider = byCapability.get(`${service.serviceKey}:${deps.environment}`);
    return {
      serviceKey: service.serviceKey,
      providerKey: provider?.providerKey ?? service.localProvider ?? null,
      environment: deps.environment,
      lifecycleState: provider?.lifecycleState ?? null,
    };
  });
  return {
    bindings,
    ready: bindings.every((b) => b.providerKey != null),
  };
}
