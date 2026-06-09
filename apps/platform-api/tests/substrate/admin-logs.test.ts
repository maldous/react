/**
 * Admin log search route authorization (ADR-ACT-0194).
 * Uses the PRODUCTION route list + a real HTTP server. The success path is
 * covered by adapters-loki + logs-usecase unit tests; here we prove the route
 * is wired and gated by platform.logs.read (system-admin only). No fixture role
 * holds platform.logs.read, so every fixture role is correctly denied —
 * end-to-end success with a real system-admin session rides on the deferred
 * auth-E2E fixture work (ADR-ACT-0157/0158/0159/0160).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import process from "node:process";
import { createRouter } from "../../src/server/pipeline.ts";
import { routes } from "../../src/server/routes.ts";

function makeServer(): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve, reject) => {
    const router = createRouter(routes);
    const server = http.createServer(router);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") return reject(new Error("no address"));
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
    server.on("error", reject);
  });
}

function setFixtureRole(role: string | undefined): void {
  if (role === undefined) delete process.env["LOCAL_FIXTURE_SESSION"];
  else process.env["LOCAL_FIXTURE_SESSION"] = role;
}

describe("GET /api/admin/logs/search — authorization", () => {
  let server: http.Server;
  let url: string;
  let saved: string | undefined;

  before(async () => {
    saved = process.env["LOCAL_FIXTURE_SESSION"];
    const s = await makeServer();
    server = s.server;
    url = s.url;
  });
  after(async () => {
    setFixtureRole(saved);
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("unauthenticated → 401", async () => {
    setFixtureRole(undefined);
    const res = await fetch(`${url}/api/admin/logs/search?requestId=abc`);
    assert.equal(res.status, 401);
  });

  it("viewer → 403 (lacks platform.logs.read)", async () => {
    setFixtureRole("viewer");
    const res = await fetch(`${url}/api/admin/logs/search?requestId=abc`);
    assert.equal(res.status, 403);
  });

  it("tenant-admin → 403 (platform.logs.read is system-admin only)", async () => {
    setFixtureRole("tenant-admin");
    const res = await fetch(`${url}/api/admin/logs/search?service=platform-api`);
    assert.equal(res.status, 403);
  });
});
