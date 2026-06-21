import { KeycloakRealmAdminAdapter } from "@platform/adapters-keycloak";
import type { ResourcePolicy } from "@platform/authorisation-runtime";
import { getKeycloakConfigForRealm, getApplicationPool } from "./dependencies.ts";
import { PostgresTenantCredentialStore } from "../adapters/postgres-tenant-credential-store.ts";
import type { TenantContext } from "./tenant-resolver.ts";

export async function loadTenantResourcePolicies(
  tenant: TenantContext | null
): Promise<ResourcePolicy[]> {
  if (!tenant) return [];
  const cred = await new PostgresTenantCredentialStore(
    getApplicationPool()
  ).getAuthSettingsCredential(tenant.organisationId);
  if (!cred) return [];
  const adapter = new KeycloakRealmAdminAdapter({
    url: getKeycloakConfigForRealm(tenant.realmName).url,
    realm: tenant.realmName,
    adminClientId: cred.clientId,
    adminClientSecret: cred.clientSecret,
  });
  return adapter.getResourcePolicy("*");
}
