import pg from "pg";
import { isMigrated } from "./migrate.ts";

const POSTGRES_URL =
  process.env["POSTGRES_URL"] ?? "postgresql://platform:platformpassword@localhost:5433/platform";

export const FIXTURE = {
  ORG_ID: "00000000-0000-4000-8000-000000000001",
  ORG_SLUG: "fixture-org",
  ADMIN_ID: "00000000-0000-0000-0000-000000000002",
  VIEWER_ID: "00000000-0000-0000-0000-000000000003",
  FORBIDDEN_ID: "00000000-0000-0000-0000-000000000004",
  MANAGER_ID: "00000000-0000-0000-0000-000000000005",
  MEMBER_ID: "00000000-0000-0000-0000-000000000006",
} as const;

export async function seedFixtures(): Promise<void> {
  if (!(await isMigrated())) {
    throw new Error("Database is not migrated. Run npm run db:migrate first.");
  }

  const client = new pg.Client(POSTGRES_URL);
  await client.connect();
  try {
    // Reconcile a legacy fixture organisation. Earlier seeds used a non-v4 id
    // (00000000-0000-0000-0000-000000000001); the organisation id MUST be a UUID
    // v4 (tenantSchemaIdentifier / ADR-0029 schema-per-tenant), so the fixture id
    // was corrected. On a database seeded before that change, the row below would
    // hit the organisations_slug UNIQUE constraint (same slug, different id) and
    // crash the container's boot-time seed. Remove the stale fixture row first
    // (FK ON DELETE CASCADE clears only its fixture children — real provisioned
    // tenants have different ids and are untouched). Idempotent: matches nothing
    // once the database is already on the v4 id.
    await client.query("DELETE FROM organisations WHERE slug = $1 AND id <> $2", [
      FIXTURE.ORG_SLUG,
      FIXTURE.ORG_ID,
    ]);
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
        ($3, 'forbidden@fixture.local', 'Fixture Forbidden'),
        ($4, 'manager@fixture.local', 'Fixture Manager'),
        ($5, 'member@fixture.local', 'Fixture Member')
      -- No conflict target: idempotent against BOTH the id PK and the email UNIQUE
      -- constraint. The container entrypoint re-seeds on every start; a fixture email
      -- that already exists under a different id (e.g. created by a prior login/relink)
      -- must not crash the boot — skip the row instead of erroring on users_email_key.
      ON CONFLICT DO NOTHING
    `,
      [
        FIXTURE.ADMIN_ID,
        FIXTURE.VIEWER_ID,
        FIXTURE.FORBIDDEN_ID,
        FIXTURE.MANAGER_ID,
        FIXTURE.MEMBER_ID,
      ]
    );

    // Resolve the membership user_id by EMAIL, not the hardcoded fixture id: a fixture
    // persona that has actually logged in (e.g. manager@/member@fixture.local during the
    // persona-matrix E2E) exists under its REAL Keycloak sub id, not FIXTURE.*_ID — so the
    // ON CONFLICT-skipped fixture-id row never exists and a hardcoded-id membership insert
    // hits memberships_user_id_fkey. Joining on email is correct whether the user was
    // seeded (fixture id) or created by login (real id), and stays idempotent.
    await client.query(
      `
      INSERT INTO memberships (user_id, organisation_id, role)
      SELECT u.id, $1, v.role
      FROM (VALUES
        ('admin@fixture.local', 'tenant-admin'),
        ('viewer@fixture.local', 'viewer'),
        ('manager@fixture.local', 'manager'),
        ('member@fixture.local', 'member')
      ) AS v(email, role)
      JOIN users u ON u.email = v.email
      ON CONFLICT (user_id, organisation_id) DO NOTHING
    `,
      [FIXTURE.ORG_ID]
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
