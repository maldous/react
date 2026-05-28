import pg from "pg";
import type { OrganisationProfile } from "@platform/contracts-organisation";
import type { OrganisationRepository } from "../ports/organisation-repository.ts";

function rowToProfile(row: Record<string, unknown>): OrganisationProfile {
  return {
    id: row["id"] as string,
    slug: row["slug"] as string,
    displayName: row["display_name"] as string,
    createdAt: (row["created_at"] as Date).toISOString(),
    updatedAt: (row["updated_at"] as Date).toISOString(),
  };
}

/**
 * Postgres-backed implementation of OrganisationRepository.
 *
 * Owns:
 *  - SQL statements
 *  - row-to-contract mapping
 *  - the pg connection pool
 *
 * Does not own:
 *  - permission checks (pipeline)
 *  - business validation (use case)
 *  - session/runtime context (handler)
 *
 * Uses a shared pg.Pool so repeated calls reuse pooled connections rather
 * than opening a new client per query (first-slice baseline; future slices
 * may promote a shared platform DB abstraction).
 */
export class PostgresOrganisationRepository implements OrganisationRepository {
  private readonly pool: pg.Pool;

  constructor(connectionString: string, pool?: pg.Pool) {
    this.pool = pool ?? new pg.Pool({ connectionString, max: 10 });
  }

  async getById(organisationId: string): Promise<OrganisationProfile | null> {
    const { rows } = await this.pool.query(
      "SELECT id, slug, display_name, created_at, updated_at FROM organisations WHERE id = $1",
      [organisationId]
    );
    if (!rows.length) return null;
    return rowToProfile(rows[0] as Record<string, unknown>);
  }

  async updateDisplayName(
    organisationId: string,
    displayName: string
  ): Promise<OrganisationProfile | null> {
    const { rows } = await this.pool.query(
      "UPDATE organisations SET display_name = $1, updated_at = now() WHERE id = $2 RETURNING id, slug, display_name, created_at, updated_at",
      [displayName, organisationId]
    );
    if (!rows.length) return null;
    return rowToProfile(rows[0] as Record<string, unknown>);
  }

  /** Test/teardown helper: close the pool so the process can exit cleanly. */
  async close(): Promise<void> {
    await this.pool.end();
  }
}
