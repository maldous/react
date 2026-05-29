export const packageName = "@platform/adapters-postgres";

export { PostgresIdentityRepository } from "./postgres-identity-repository.ts";
export { PostgresOrganisationRepository } from "./postgres-organisation-repository.ts";
export { PostgresReadinessAdapter } from "./postgres-readiness-adapter.ts";
export type { IdentityRepository, OrganisationRepository } from "./ports.ts";
