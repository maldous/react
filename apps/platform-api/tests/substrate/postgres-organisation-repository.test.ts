/**
 * PostgresOrganisationRepository integration tests.
 * Requires: local Postgres at POSTGRES_URL (default: localhost:5433).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { PostgresOrganisationRepository } from "@platform/adapters-postgres";

const POSTGRES_URL = process.env["POSTGRES_URL"] ?? "";

const FIXTURE_ORG_ID = "00000000-0000-4000-8000-000000000001";
const FIXTURE_ORG_SLUG = "fixture-org";

async function resetDisplayName(name: string): Promise<void> {
  const client = new pg.Client(POSTGRES_URL);
  await client.connect();
  try {
    await client.query(
      "UPDATE organisations SET display_name = $1, updated_at = now() WHERE id = $2",
      [name, FIXTURE_ORG_ID]
    );
  } finally {
    await client.end();
  }
}

describe("PostgresOrganisationRepository", () => {
  const repo = new PostgresOrganisationRepository(POSTGRES_URL);

  before(async () => {
    await resetDisplayName("Fixture Organisation");
  });

  after(async () => {
    await resetDisplayName("Fixture Organisation");
  });

  describe("getById", () => {
    it("returns OrganisationProfile for known org", async () => {
      const result = await repo.getById(FIXTURE_ORG_ID);
      assert.ok(result !== null);
      assert.equal(result.id, FIXTURE_ORG_ID);
      assert.equal(result.slug, FIXTURE_ORG_SLUG);
      assert.equal(typeof result.displayName, "string");
      assert.ok(result.displayName.length > 0);
      assert.equal(typeof result.createdAt, "string");
      assert.equal(typeof result.updatedAt, "string");
    });

    it("returns null for unknown org", async () => {
      const result = await repo.getById("00000000-0000-0000-0000-000000000099");
      assert.equal(result, null);
    });

    it("does not throw for missing org ? returns null", async () => {
      await assert.doesNotReject(() => repo.getById("00000000-0000-0000-0000-000000000099"));
    });
  });

  describe("updateDisplayName", () => {
    it("updates display_name and returns updated profile", async () => {
      const result = await repo.updateDisplayName(FIXTURE_ORG_ID, "Adapter Test Name");
      assert.ok(result !== null);
      assert.equal(result.displayName, "Adapter Test Name");
      assert.equal(result.id, FIXTURE_ORG_ID);
      assert.equal(result.slug, FIXTURE_ORG_SLUG);
    });

    it("does not update slug or id", async () => {
      const result = await repo.updateDisplayName(FIXTURE_ORG_ID, "Name Check");
      assert.ok(result !== null);
      assert.equal(result.slug, FIXTURE_ORG_SLUG);
      assert.equal(result.id, FIXTURE_ORG_ID);
    });

    it("returns null for unknown org", async () => {
      const result = await repo.updateDisplayName("00000000-0000-0000-0000-000000000099", "Ghost");
      assert.equal(result, null);
    });

    it("does not throw for missing org ? returns null", async () => {
      await assert.doesNotReject(() =>
        repo.updateDisplayName("00000000-0000-0000-0000-000000000099", "Ghost")
      );
    });
  });
});
