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

export class PostgresOrganisationRepository implements OrganisationRepository {
  private readonly connectionString: string;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
  }

  async getById(organisationId: string): Promise<OrganisationProfile | null> {
    const client = new pg.Client(this.connectionString);
    await client.connect();
    try {
      const { rows } = await client.query(
        "SELECT id, slug, display_name, created_at, updated_at FROM organisations WHERE id = $1",
        [organisationId]
      );
      if (!rows.length) return null;
      return rowToProfile(rows[0] as Record<string, unknown>);
    } finally {
      await client.end();
    }
  }

  async updateDisplayName(
    organisationId: string,
    displayName: string
  ): Promise<OrganisationProfile | null> {
    const client = new pg.Client(this.connectionString);
    await client.connect();
    try {
      const { rows } = await client.query(
        "UPDATE organisations SET display_name = $1, updated_at = now() WHERE id = $2 RETURNING id, slug, display_name, created_at, updated_at",
        [displayName, organisationId]
      );
      if (!rows.length) return null;
      return rowToProfile(rows[0] as Record<string, unknown>);
    } finally {
      await client.end();
    }
  }
}
