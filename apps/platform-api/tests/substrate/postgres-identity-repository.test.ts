/**
 * PostgresIdentityRepository integration tests.
 * Requires: local Postgres at POSTGRES_URL (default: localhost:5433).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { PostgresIdentityRepository } from "../../src/adapters/postgres-identity-repository.ts";

const POSTGRES_URL =
  process.env["POSTGRES_URL"] ?? "postgresql://platform:platformpassword@localhost:5433/platform";

const FIXTURE_ORG_ID = "00000000-0000-0000-0000-000000000001";
const FIXTURE_ADMIN_ID = "00000000-0000-0000-0000-000000000002";

// Test provider subject (unique per run to avoid cross-test pollution)
const TEST_SUBJECT = `test-subject-${Date.now()}`;
const TEST_EMAIL = `test-${Date.now()}@example.local`;

describe("PostgresIdentityRepository", () => {
  const repo = new PostgresIdentityRepository(POSTGRES_URL);
  let pgClient: pg.Client;

  before(async () => {
    pgClient = new pg.Client(POSTGRES_URL);
    await pgClient.connect();
  });

  after(async () => {
    // Clean up test-created records
    await pgClient.query("DELETE FROM external_identities WHERE provider_subject = $1", [
      TEST_SUBJECT,
    ]);
    await pgClient.query("DELETE FROM users WHERE email = $1", [TEST_EMAIL]);
    await pgClient.end();
  });

  describe("findExternalIdentity", () => {
    it("returns null when no matching identity exists", async () => {
      const result = await repo.findExternalIdentity("keycloak", "does-not-exist");
      assert.equal(result, null);
    });

    it("returns user+identity after createUserAndExternalIdentity", async () => {
      await repo.createUserAndExternalIdentity({
        email: TEST_EMAIL,
        displayName: "Test User",
        provider: "keycloak",
        providerSubject: TEST_SUBJECT,
      });
      const result = await repo.findExternalIdentity("keycloak", TEST_SUBJECT);
      assert.ok(result !== null);
      assert.equal(result.user.email, TEST_EMAIL);
      assert.equal(result.externalIdentity.provider, "keycloak");
      assert.equal(result.externalIdentity.providerSubject, TEST_SUBJECT);
    });
  });

  describe("createUserAndExternalIdentity", () => {
    it("creates user and external identity transactionally", async () => {
      const { user, externalIdentity } = await repo.createUserAndExternalIdentity({
        email: TEST_EMAIL,
        displayName: "Test User",
        provider: "keycloak",
        providerSubject: TEST_SUBJECT,
      });
      assert.ok(user.id);
      assert.equal(user.email, TEST_EMAIL);
      assert.equal(user.displayName, "Test User");
      assert.equal(externalIdentity.provider, "keycloak");
      assert.equal(externalIdentity.providerSubject, TEST_SUBJECT);
      assert.equal(externalIdentity.userId, user.id);
    });

    it("is idempotent: second call returns same records", async () => {
      const first = await repo.createUserAndExternalIdentity({
        email: TEST_EMAIL,
        displayName: "Test User",
        provider: "keycloak",
        providerSubject: TEST_SUBJECT,
      });
      const second = await repo.createUserAndExternalIdentity({
        email: TEST_EMAIL,
        displayName: "Updated Name",
        provider: "keycloak",
        providerSubject: TEST_SUBJECT,
      });
      assert.equal(first.externalIdentity.id, second.externalIdentity.id);
      assert.equal(first.user.id, second.user.id);
    });
  });

  describe("findMembershipByUser", () => {
    it("returns membership for fixture admin user", async () => {
      const membership = await repo.findMembershipByUser(FIXTURE_ADMIN_ID);
      assert.ok(membership !== null);
      assert.equal(membership.userId, FIXTURE_ADMIN_ID);
      assert.equal(membership.organisationId, FIXTURE_ORG_ID);
      assert.equal(membership.role, "tenant-admin");
    });

    it("returns null for user with no membership", async () => {
      const { user } = await repo.createUserAndExternalIdentity({
        email: TEST_EMAIL,
        displayName: "No Membership",
        provider: "keycloak",
        providerSubject: TEST_SUBJECT,
      });
      const membership = await repo.findMembershipByUser(user.id);
      assert.equal(membership, null);
    });
  });
});
