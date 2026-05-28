import pg from "pg";
import type { OrganisationProfile } from "@platform/contracts-organisation";
import { NotFoundError } from "@platform/platform-errors";

const POSTGRES_URL =
  process.env["POSTGRES_URL"] ?? "postgresql://platform:platformpassword@localhost:5433/platform";

export async function getOrganisationProfile(organisationId: string): Promise<OrganisationProfile> {
  const client = new pg.Client(POSTGRES_URL);
  await client.connect();
  try {
    const { rows } = await client.query(
      "SELECT id, slug, display_name, created_at, updated_at FROM organisations WHERE id = $1",
      [organisationId]
    );
    if (!rows.length) throw new NotFoundError("Organisation not found");
    const row = rows[0];
    return {
      id: row.id as string,
      slug: row.slug as string,
      displayName: row.display_name as string,
      createdAt: (row.created_at as Date).toISOString(),
      updatedAt: (row.updated_at as Date).toISOString(),
    };
  } finally {
    await client.end();
  }
}

export async function updateOrganisationDisplayName(
  organisationId: string,
  displayName: string
): Promise<OrganisationProfile> {
  const client = new pg.Client(POSTGRES_URL);
  await client.connect();
  try {
    const { rows } = await client.query(
      "UPDATE organisations SET display_name = $1, updated_at = now() WHERE id = $2 RETURNING id, slug, display_name, created_at, updated_at",
      [displayName, organisationId]
    );
    if (!rows.length) throw new NotFoundError("Organisation not found");
    const row = rows[0];
    return {
      id: row.id as string,
      slug: row.slug as string,
      displayName: row.display_name as string,
      createdAt: (row.created_at as Date).toISOString(),
      updatedAt: (row.updated_at as Date).toISOString(),
    };
  } finally {
    await client.end();
  }
}
