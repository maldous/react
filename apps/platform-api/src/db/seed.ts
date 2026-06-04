import pg from "pg";
import { isMigrated } from "./migrate.ts";

const POSTGRES_URL =
  process.env["POSTGRES_URL"] ?? "postgresql://platform:platformpassword@localhost:5433/platform";

export const FIXTURE = {
  ORG_ID: "00000000-0000-0000-0000-000000000001",
  ORG_SLUG: "fixture-org",
  ADMIN_ID: "00000000-0000-0000-0000-000000000002",
  VIEWER_ID: "00000000-0000-0000-0000-000000000003",
  FORBIDDEN_ID: "00000000-0000-0000-0000-000000000004",
} as const;

export async function seedFixtures(): Promise<void> {
  if (!(await isMigrated())) {
    throw new Error("Database is not migrated. Run npm run db:migrate first.");
  }

  const client = new pg.Client(POSTGRES_URL);
  await client.connect();
  try {
    await client.query(
      `
      INSERT INTO organisations (id, slug, display_name)
      VALUES ($1, $2, $3)
      ON CONFLICT (id) DO NOTHING
    `,
      [FIXTURE.ORG_ID, FIXTURE.ORG_SLUG, "Fixture Organisation"]
    );

    await client.query(
      `
      INSERT INTO users (id, email, display_name) VALUES
        ($1, 'admin@fixture.local', 'Fixture Admin'),
        ($2, 'viewer@fixture.local', 'Fixture Viewer'),
        ($3, 'forbidden@fixture.local', 'Fixture Forbidden')
      ON CONFLICT (id) DO NOTHING
    `,
      [FIXTURE.ADMIN_ID, FIXTURE.VIEWER_ID, FIXTURE.FORBIDDEN_ID]
    );

    await client.query(
      `
      INSERT INTO memberships (user_id, organisation_id, role) VALUES
        ($1, $2, 'tenant-admin'),
        ($3, $2, 'viewer')
      ON CONFLICT (user_id, organisation_id) DO NOTHING
    `,
      [FIXTURE.ADMIN_ID, FIXTURE.ORG_ID, FIXTURE.VIEWER_ID]
    );
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedFixtures()
    .then(() => {
      process.stdout.write("Seed complete\n");
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
      process.stderr.write(`\nFatal error: ${msg}\n`);
      process.exitCode = 1;
    });
}
