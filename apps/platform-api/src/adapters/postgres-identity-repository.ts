/**
 * Provider reliability evidence for the PostgresIdentityRepository runtime provider.
 *
 * The implementation lives in @platform/adapters-postgres and is constructed by
 * platform-api server dependencies. This entry gives the environment matrix a
 * concrete app-visible provider ID tied to runtime identity storage semantics.
 */
export const postgresIdentityRepositoryReliabilityEvidence = {
  configSource:
    "process.env-backed POSTGRES_APP_URL/bootstrap database configuration supplies the identity repository connection string before construction",
  secretSource:
    "POSTGRES_APP_URL is a secret-bearing database credential source; no token or apiKey is returned by repository operations",
  timeout:
    "Postgres identity operations execute through bounded database clients and stage health/readiness probes detect unavailable database state",
  retry:
    "operator retry is explicit after transient database failures; repository operations propagate errors instead of hiding failed writes",
  degradedMode:
    "identity/session readiness degrades when Postgres is unavailable; membership and external-identity mutations fail closed",
  failClosed:
    "membership, external identity, tenant identity, and RBAC reads/writes throw or return no access on unavailable or inconsistent storage",
  fallbackRationale:
    "no fallback identity store is used; the Postgres identity repository is the sole semantic source for user, membership, group, and RBAC state",
  healthCheck:
    "health, auth, membership, domain identity, groups, and sub-organisation tests/proofs exercise identity repository readiness and behavior",
  operatorRecovery:
    "operator recovery: verify POSTGRES_APP_URL, migrations 001/016 identity tables, grants/RLS, and rerun identity/auth proofs",
};

export { PostgresIdentityRepository } from "@platform/adapters-postgres";
