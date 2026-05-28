/**
 * Dependency composition root for platform-api.
 *
 * Centralises POSTGRES_URL lookup and repository construction so route
 * handlers do not duplicate wiring code. This is intentionally minimal —
 * just enough to remove copy-paste — not a DI container.
 */
import { PostgresOrganisationRepository } from "../adapters/postgres-organisation-repository.ts";
import { PostgresReadinessAdapter } from "../adapters/postgres-readiness-adapter.ts";
import type { OrganisationRepository } from "../ports/organisation-repository.ts";

const DEFAULT_POSTGRES_URL = "postgresql://platform:platformpassword@localhost:5433/platform";

export function getPostgresUrl(): string {
  return process.env["POSTGRES_URL"] ?? DEFAULT_POSTGRES_URL;
}

// Shared singletons — adapters back themselves with a pg.Pool so repeated
// access does not open a fresh client per request.
let organisationRepository: OrganisationRepository | undefined;
let readinessAdapter: PostgresReadinessAdapter | undefined;

export function getOrganisationRepository(): OrganisationRepository {
  if (!organisationRepository) {
    organisationRepository = new PostgresOrganisationRepository(getPostgresUrl());
  }
  return organisationRepository;
}

export function getPostgresReadinessAdapter(): PostgresReadinessAdapter {
  if (!readinessAdapter) {
    readinessAdapter = new PostgresReadinessAdapter(getPostgresUrl());
  }
  return readinessAdapter;
}

export interface OrganisationDependencies {
  organisations: OrganisationRepository;
}

/**
 * Build the dependency bundle handed to organisation use cases.
 * Tests can substitute by passing their own bundle directly to the use case.
 */
export function createOrganisationDependencies(): OrganisationDependencies {
  return { organisations: getOrganisationRepository() };
}
