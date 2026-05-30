/**
 * PostgresIdentityRepository integration tests.
 * Requires: local Postgres at POSTGRES_URL (default: localhost:5433).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { ConflictError } from "@platform/platform-errors";
import { PostgresIdentityRepository } from "@platform/adapters-postgres";

const POSTGRES_URL =
  process.env["POSTGRES_URL"] ?? "postgresql://platform:platformpassword@localhost:5433/platform";

const FIXTURE_ORG_ID = "00000000-0000-0000-0000-000000000001";
const FIXTURE_ADMIN_ID = "00000000-0000-0000-0000-000000000002";

// Generate per-test unique email/subject. Each call returns a fresh pair so
// tests never share state. ConflictError on email collision is correct behaviour,
// not a test bug ? isolation prevents it from appearing unexpectedly.
let _seq = 0;
const _createdEmails: string[] = [];
const _createdSubjects: string[] = [];
function fresh(): { email: string; subject: string } {
  _seq++;
  const ts = Date.now();
  const pair = {
    email: `test-${ts}-${_seq}@example.local`,
    subject: `test-subject-${ts}-${_seq}`,
  };
  _createdEmails.push(pair.email);
  _createdSubjects.push(pair.subject);
  return pair;
}

describe("PostgresIdentityRepository", () => {
  const repo = new PostgresIdentityRepository(POSTGRES_URL);
  let pgClient: pg.Client;

  before(async () => {
    pgClient = new pg.Client(POSTGRES_URL);
    await pgClient.connect();
  });

  after(async () => {
    for (const subj of _createdSubjects) {
      await pgClient.query("DELETE FROM external_identities WHERE provider_subject = $1", [subj]);
    }
    for (const email of _createdEmails) {
      await pgClient.query("DELETE FROM users WHERE email = $1", [email]);
    }
    await pgClient.end();
  });

  describe("findExternalIdentity", () => {
    it("returns null when no matching identity exists", async () => {
      const result = await repo.findExternalIdentity("keycloak", "does-not-exist");
      assert.equal(result, null);
    });

    it("returns user+identity after createUserAndExternalIdentity", async () => {
      const { email, subject } = fresh();
      await repo.createUserAndExternalIdentity({
        email,
        displayName: "Test User",
        provider: "keycloak",
        providerSubject: subject,
      });
      const result = await repo.findExternalIdentity("keycloak", subject);
      assert.ok(result !== null);
      assert.equal(result.user.email, email);
      assert.equal(result.externalIdentity.provider, "keycloak");
      assert.equal(result.externalIdentity.providerSubject, subject);
    });
  });

  describe("createUserAndExternalIdentity", () => {
    it("creates user and external identity transactionally", async () => {
      const { email, subject } = fresh();
      const { user, externalIdentity } = await repo.createUserAndExternalIdentity({
        email,
        displayName: "Test User",
        provider: "keycloak",
        providerSubject: subject,
      });
      assert.ok(user.id);
      assert.equal(user.email, email);
      assert.equal(user.displayName, "Test User");
      assert.equal(externalIdentity.provider, "keycloak");
      assert.equal(externalIdentity.providerSubject, subject);
      assert.equal(externalIdentity.userId, user.id);
    });

    it("rejects second call with same email ? no silent account merge (security fix)", async () => {
      const { email, subject } = fresh();
      // First call creates user + external identity
      await repo.createUserAndExternalIdentity({
        email,
        displayName: "Test User",
        provider: "keycloak",
        providerSubject: subject,
      });
      // Second call with the same email but different subject must throw.
      // A new external identity must never be silently merged into an existing
      // user purely because the emails happen to match.
      const diffSubject = subject + "-different";
      _createdSubjects.push(diffSubject);
      await assert.rejects(
        () =>
          repo.createUserAndExternalIdentity({
            email,
            displayName: "Updated Name",
            provider: "keycloak",
            providerSubject: diffSubject,
          }),
        (err: unknown) => {
          assert.ok(err instanceof ConflictError, `Expected ConflictError, got: ${String(err)}`);
          assert.equal(err.code, "CONFLICT");
          return true;
        }
      );
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
      const { email, subject } = fresh();
      const { user } = await repo.createUserAndExternalIdentity({
        email,
        displayName: "No Membership",
        provider: "keycloak",
        providerSubject: subject,
      });
      const membership = await repo.findMembershipByUser(user.id);
      assert.equal(membership, null);
    });
  });
});
