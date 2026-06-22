/**
 * Provider reliability evidence for the KeycloakRealmAdminAdapter runtime provider.
 *
 * Runtime implementation lives in @platform/adapters-keycloak and is instantiated
 * by platform-api routes, health checks, and auth proof scripts. This app-layer
 * entry records the concrete provider ID used by the environment matrix.
 */
export const keycloakRealmAdminAdapterReliabilityEvidence = {
  configSource:
    "process.env-backed auth/provider configuration supplies Keycloak URL, realm, client/admin credentials, and route-specific settings before adapter construction",
  secretSource:
    "clientSecret, adminPassword, credential refs, token exchange secrets, and API credential material are read from configured secret/bootstrap sources and never emitted in responses",
  timeout:
    "Keycloak calls are bounded by route/proof fetch timeout handling and readiness probes classify unreachable provider states",
  retry:
    "retry is explicit in live proof/operator retry flows; failed calls are surfaced as unavailable or forbidden provider states instead of silently succeeding",
  degradedMode:
    "read-only readiness degrades when Keycloak is unreachable; mutation and policy paths fail closed when Keycloak is sole authority",
  failClosed:
    "authorization, credential validation, realm mutation, and IdP management deny or throw on unavailable/misconfigured Keycloak state",
  fallbackRationale:
    "no fallback identity provider is attempted for tenant realm mutations; static permission fallback is limited to routes that declare a non-sole UMA boundary",
  healthCheck:
    "auth-settings, credential lifecycle, IdP, OIDC enterprise, and server health proofs exercise Keycloak readiness",
  operatorRecovery:
    "operator recovery: verify Keycloak URL/realm/admin credentials/client secrets, rotate credentials, rerun seed-idps when needed, then retry auth provider proofs",
};

export { KeycloakRealmAdminAdapter } from "@platform/adapters-keycloak";
