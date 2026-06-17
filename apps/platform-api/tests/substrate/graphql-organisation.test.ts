/**
 * GraphQL boundary tests (ADR-0013, ADR-ACT-0199).
 * Exercises POST /api/graphql using the PRODUCTION route list from
 * server/routes.ts against a real HTTP server + real Postgres, driving the same
 * organisation profile read/update the SPA uses.
 *
 * Requires: Postgres running at POSTGRES_URL (default: localhost:5433).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import process from "node:process";
import { createRouter } from "../../src/server/pipeline.ts";
import { routes } from "../../src/server/routes.ts";

const FIXTURE_ORG_ID = "00000000-0000-4000-8000-000000000001";

interface GraphQLBody {
  data?: Record<string, unknown> | null;
  errors?: Array<{ message: string }>;
}

function makeServer(): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve, reject) => {
    const router = createRouter(routes);
    const server = http.createServer(router);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Could not get server address"));
        return;
      }
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
    server.on("error", reject);
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function setFixtureRole(role: string | undefined): void {
  if (role === undefined) delete process.env["LOCAL_FIXTURE_SESSION"];
  else process.env["LOCAL_FIXTURE_SESSION"] = role;
}

function gql(url: string, query: string, variables?: Record<string, unknown>): Promise<Response> {
  return fetch(`${url}/api/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
}

const PROFILE_QUERY = `query { organisationProfile { id slug displayName } }`;
const UPDATE_MUTATION = `mutation Update($displayName: String!) {
  updateOrganisationProfile(displayName: $displayName) { id displayName }
}`;

describe("graphql: organisationProfile query", () => {
  let server: http.Server;
  let url: string;
  let savedEnv: string | undefined;

  before(async () => {
    savedEnv = process.env["LOCAL_FIXTURE_SESSION"];
    const s = await makeServer();
    server = s.server;
    url = s.url;
  });
  after(async () => {
    setFixtureRole(savedEnv);
    await closeServer(server);
  });

  it("tenant-admin: 200 with session-scoped profile", async () => {
    setFixtureRole("tenant-admin");
    const res = await gql(url, PROFILE_QUERY);
    assert.equal(res.status, 200);
    const body = (await res.json()) as GraphQLBody;
    assert.equal(body.errors, undefined);
    const profile = body.data?.["organisationProfile"] as { id: string; slug: string };
    assert.equal(profile.id, FIXTURE_ORG_ID);
    assert.equal(profile.slug, "fixture-org");
  });

  it("viewer: 200 (read permission)", async () => {
    setFixtureRole("viewer");
    const res = await gql(url, PROFILE_QUERY);
    assert.equal(res.status, 200);
    const body = (await res.json()) as GraphQLBody;
    assert.equal(body.errors, undefined);
  });

  it("no-membership: 403 (lacks organisation.read)", async () => {
    setFixtureRole("no-membership");
    const res = await gql(url, PROFILE_QUERY);
    assert.equal(res.status, 403);
  });

  it("unauthenticated: 401", async () => {
    setFixtureRole(undefined);
    const res = await gql(url, PROFILE_QUERY);
    assert.equal(res.status, 401);
  });
});

describe("graphql: updateOrganisationProfile mutation", () => {
  let server: http.Server;
  let url: string;
  let savedEnv: string | undefined;

  before(async () => {
    savedEnv = process.env["LOCAL_FIXTURE_SESSION"];
    const s = await makeServer();
    server = s.server;
    url = s.url;
  });
  after(async () => {
    setFixtureRole(savedEnv);
    await closeServer(server);
  });

  it("tenant-admin: 200 updates display name (session-scoped, no id arg)", async () => {
    setFixtureRole("tenant-admin");
    const res = await gql(url, UPDATE_MUTATION, { displayName: "GraphQL Updated Org" });
    assert.equal(res.status, 200);
    const body = (await res.json()) as GraphQLBody;
    assert.equal(body.errors, undefined);
    const updated = body.data?.["updateOrganisationProfile"] as { displayName: string };
    assert.equal(updated.displayName, "GraphQL Updated Org");
    // Restore for other tests.
    const restore = await gql(url, UPDATE_MUTATION, { displayName: "Fixture Organisation" });
    assert.equal(restore.status, 200);
  });

  it("viewer: 403 (lacks organisation.update)", async () => {
    setFixtureRole("viewer");
    const res = await gql(url, UPDATE_MUTATION, { displayName: "Should Not Update" });
    assert.equal(res.status, 403);
  });

  it("validation error surfaces as a GraphQL error (200 with errors)", async () => {
    setFixtureRole("tenant-admin");
    const res = await gql(url, UPDATE_MUTATION, { displayName: "x" }); // too short
    assert.equal(res.status, 200);
    const body = (await res.json()) as GraphQLBody;
    assert.ok(body.errors && body.errors.length > 0, "expected a GraphQL error for invalid input");
  });
});

describe("graphql: hardening", () => {
  let server: http.Server;
  let url: string;
  let savedEnv: string | undefined;
  let savedPlatformEnv: string | undefined;

  before(async () => {
    savedEnv = process.env["LOCAL_FIXTURE_SESSION"];
    savedPlatformEnv = process.env["PLATFORM_ENV"];
    const s = await makeServer();
    server = s.server;
    url = s.url;
  });
  after(async () => {
    setFixtureRole(savedEnv);
    if (savedPlatformEnv === undefined) delete process.env["PLATFORM_ENV"];
    else process.env["PLATFORM_ENV"] = savedPlatformEnv;
    await closeServer(server);
  });

  it("rejects introspection outside development (400)", async () => {
    setFixtureRole("tenant-admin");
    process.env["PLATFORM_ENV"] = "test";
    const res = await gql(url, `query { __schema { types { name } } }`);
    assert.equal(res.status, 400);
  });

  it("rejects an unknown operation field (400)", async () => {
    setFixtureRole("tenant-admin");
    const res = await gql(url, `query { organisationProfile { id } notARealField }`);
    assert.equal(res.status, 400);
  });

  it("rejects a malformed document (400)", async () => {
    setFixtureRole("tenant-admin");
    const res = await gql(url, `query { organisationProfile {`);
    assert.equal(res.status, 400);
  });

  it("rejects a missing query (400)", async () => {
    setFixtureRole("tenant-admin");
    const res = await fetch(`${url}/api/graphql`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });
});
