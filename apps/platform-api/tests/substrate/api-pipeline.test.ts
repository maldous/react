/**
 * API pipeline tests.
 * Tests createRouter() by spinning up a real http.createServer on port 0 (random port).
 * Uses node:http + fetch to exercise the pipeline end-to-end.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRouter, type Route, type PipelineRequest } from "../../src/server/pipeline.ts";

// Helper: create a test server with given routes, return {server, url}
function makeServer(routes: Route[]): Promise<{ server: http.Server; url: string }> {
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
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// ?? 1. 404 for unknown path ????????????????????????????????????????????????
describe("api pipeline: 404 for unknown path", () => {
  let server: http.Server;
  let url: string;

  before(async () => {
    const s = await makeServer([
      { method: "GET", path: "/known", handler: async (_req, res) => res.json(200, { ok: true }) },
    ]);
    server = s.server;
    url = s.url;
  });

  after(async () => {
    await closeServer(server);
  });

  it("returns 404 for an unregistered path", async () => {
    const res = await fetch(`${url}/not-registered`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.code, "NOT_FOUND");
  });
});

// ?? 2. 405 for wrong method ???????????????????????????????????????????????
describe("api pipeline: 405 for wrong method", () => {
  let server: http.Server;
  let url: string;

  before(async () => {
    const s = await makeServer([
      {
        method: "GET",
        path: "/get-only",
        handler: async (_req, res) => res.json(200, { ok: true }),
      },
    ]);
    server = s.server;
    url = s.url;
  });

  after(async () => {
    await closeServer(server);
  });

  it("returns 405 when method does not match the registered route", async () => {
    const res = await fetch(`${url}/get-only`, { method: "POST" });
    assert.equal(res.status, 405);
    const allow = res.headers.get("allow");
    assert.ok(allow?.includes("GET"), `Expected Allow header to contain GET, got: ${allow}`);
  });
});

// ?? 3. Malformed JSON body ? 400 ?????????????????????????????????????????
describe("api pipeline: malformed JSON body", () => {
  let server: http.Server;
  let url: string;

  before(async () => {
    const s = await makeServer([
      { method: "POST", path: "/echo", handler: async (_req, res) => res.json(200, { ok: true }) },
    ]);
    server = s.server;
    url = s.url;
  });

  after(async () => {
    await closeServer(server);
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await fetch(`${url}/echo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not: valid json}",
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, "VALIDATION_ERROR");
  });
});

// ?? 4. requiresAuth=true without session ? 401 ???????????????????????????
describe("api pipeline: auth required without session", () => {
  let server: http.Server;
  let url: string;
  let savedEnv: string | undefined;

  before(async () => {
    savedEnv = process.env["LOCAL_FIXTURE_SESSION"];
    delete process.env["LOCAL_FIXTURE_SESSION"];

    const s = await makeServer([
      {
        method: "GET",
        path: "/protected",
        requiresAuth: true,
        handler: async (_req, res) => res.json(200, { secret: true }),
      },
    ]);
    server = s.server;
    url = s.url;
  });

  after(async () => {
    if (savedEnv !== undefined) {
      process.env["LOCAL_FIXTURE_SESSION"] = savedEnv;
    } else {
      delete process.env["LOCAL_FIXTURE_SESSION"];
    }
    await closeServer(server);
  });

  it("returns 401 when no session is set", async () => {
    const res = await fetch(`${url}/protected`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, "UNAUTHORIZED");
  });
});

// ?? 5. requiresAuth=true with session but missing permission ? 403 ????????
describe("api pipeline: auth with insufficient permission", () => {
  let server: http.Server;
  let url: string;
  let savedEnv: string | undefined;

  before(async () => {
    savedEnv = process.env["LOCAL_FIXTURE_SESSION"];
    process.env["LOCAL_FIXTURE_SESSION"] = "viewer";

    const s = await makeServer([
      {
        method: "GET",
        path: "/admin-only",
        requiresAuth: true,
        requiredPermission: "platform.admin.access",
        handler: async (_req, res) => res.json(200, { secret: true }),
      },
    ]);
    server = s.server;
    url = s.url;
  });

  after(async () => {
    if (savedEnv !== undefined) {
      process.env["LOCAL_FIXTURE_SESSION"] = savedEnv;
    } else {
      delete process.env["LOCAL_FIXTURE_SESSION"];
    }
    await closeServer(server);
  });

  it("returns 403 when session lacks required permission", async () => {
    const res = await fetch(`${url}/admin-only`);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, "FORBIDDEN");
  });
});

// ?? 6. Successful handler ? 200 ??????????????????????????????????????????
describe("api pipeline: successful handler", () => {
  let server: http.Server;
  let url: string;

  before(async () => {
    const s = await makeServer([
      {
        method: "GET",
        path: "/ok",
        handler: async (_req, res) => res.json(200, { message: "hello" }),
      },
    ]);
    server = s.server;
    url = s.url;
  });

  after(async () => {
    await closeServer(server);
  });

  it("returns 200 with handler body", async () => {
    const res = await fetch(`${url}/ok`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.message, "hello");
  });
});

// ?? 7. Handler that throws ? 500, no internalDetails leaked ??????????????
describe("api pipeline: handler error is handled safely", () => {
  let server: http.Server;
  let url: string;

  before(async () => {
    const s = await makeServer([
      {
        method: "GET",
        path: "/boom",
        handler: async () => {
          const err = new Error("something internal went wrong");
          (err as unknown as Record<string, unknown>)["internalDetails"] = {
            secret: "do-not-leak",
          };
          throw err;
        },
      },
    ]);
    server = s.server;
    url = s.url;
  });

  after(async () => {
    await closeServer(server);
  });

  it("returns 500 with safe error body and no internal details", async () => {
    const res = await fetch(`${url}/boom`);
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.code, "UNEXPECTED_ERROR");
    // internalDetails must not appear in safe response
    assert.ok(!JSON.stringify(body).includes("do-not-leak"), "internalDetails must not be leaked");
  });
});

// ?? 8. requestId appears in X-Request-Id header ??????????????????????????
describe("api pipeline: X-Request-Id header", () => {
  let server: http.Server;
  let url: string;

  before(async () => {
    const s = await makeServer([
      {
        method: "GET",
        path: "/req-id",
        handler: async (_req, res) => res.json(200, { ok: true }),
      },
    ]);
    server = s.server;
    url = s.url;
  });

  after(async () => {
    await closeServer(server);
  });

  it("includes X-Request-Id header in successful response", async () => {
    const res = await fetch(`${url}/req-id`);
    assert.equal(res.status, 200);
    const requestId = res.headers.get("x-request-id");
    assert.ok(requestId, "X-Request-Id header should be present");
    // UUID format check
    assert.match(
      requestId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      "X-Request-Id should be a UUID"
    );
  });
});

// ?? 9. Authenticated route receives actor in pipelineReq ?????????????????
describe("api pipeline: authenticated route receives actor", () => {
  let server: http.Server;
  let url: string;
  let savedEnv: string | undefined;
  let captured: PipelineRequest | undefined;

  before(async () => {
    savedEnv = process.env["LOCAL_FIXTURE_SESSION"];
    process.env["LOCAL_FIXTURE_SESSION"] = "tenant-admin";

    const s = await makeServer([
      {
        method: "GET",
        path: "/actor-check",
        requiresAuth: true,
        handler: async (req, res) => {
          captured = req;
          res.json(200, { ok: true });
        },
      },
    ]);
    server = s.server;
    url = s.url;
  });

  after(async () => {
    if (savedEnv !== undefined) {
      process.env["LOCAL_FIXTURE_SESSION"] = savedEnv;
    } else {
      delete process.env["LOCAL_FIXTURE_SESSION"];
    }
    await closeServer(server);
  });

  it("authenticated route receives actor in pipelineReq", async () => {
    const res = await fetch(`${url}/actor-check`);
    assert.equal(res.status, 200);
    assert.ok(captured, "handler should have been called");
    assert.ok(captured.actor !== null, "actor should not be null for authenticated route");
    assert.ok(captured.actor!.userId, "actor should have userId");
  });
});

// ?? 10. Authenticated route receives tenantId and permissions in context ??
describe("api pipeline: actor context propagated", () => {
  let server: http.Server;
  let url: string;
  let savedEnv: string | undefined;
  let captured: PipelineRequest | undefined;

  before(async () => {
    savedEnv = process.env["LOCAL_FIXTURE_SESSION"];
    process.env["LOCAL_FIXTURE_SESSION"] = "tenant-admin";

    const s = await makeServer([
      {
        method: "GET",
        path: "/context-check",
        requiresAuth: true,
        handler: async (req, res) => {
          captured = req;
          res.json(200, { ok: true });
        },
      },
    ]);
    server = s.server;
    url = s.url;
  });

  after(async () => {
    if (savedEnv !== undefined) {
      process.env["LOCAL_FIXTURE_SESSION"] = savedEnv;
    } else {
      delete process.env["LOCAL_FIXTURE_SESSION"];
    }
    await closeServer(server);
  });

  it("authenticated route receives tenantId in context and permissions on actor", async () => {
    const res = await fetch(`${url}/context-check`);
    assert.equal(res.status, 200);
    assert.ok(captured, "handler should have been called");
    assert.ok(captured.context.tenantId, "context should have tenantId");
    assert.ok(
      Array.isArray(captured.actor!.permissions) && captured.actor!.permissions.length > 0,
      "actor should have non-empty permissions"
    );
  });
});

// ?? 11. Permission guard: handler can read permission from req.actor ??????
describe("api pipeline: handler reads permission from req.actor", () => {
  let server: http.Server;
  let url: string;
  let savedEnv: string | undefined;
  let capturedHasPermission = false;

  before(async () => {
    savedEnv = process.env["LOCAL_FIXTURE_SESSION"];
    process.env["LOCAL_FIXTURE_SESSION"] = "tenant-admin";

    const s = await makeServer([
      {
        method: "GET",
        path: "/perm-guard",
        requiresAuth: true,
        requiredPermission: "organisation.read",
        handler: async (req, res) => {
          // Handler can verify the permission directly from req.actor without re-calling getFixtureSession()
          capturedHasPermission =
            req.actor !== null && req.actor.permissions.includes("organisation.read");
          res.json(200, { ok: true });
        },
      },
    ]);
    server = s.server;
    url = s.url;
  });

  after(async () => {
    if (savedEnv !== undefined) {
      process.env["LOCAL_FIXTURE_SESSION"] = savedEnv;
    } else {
      delete process.env["LOCAL_FIXTURE_SESSION"];
    }
    await closeServer(server);
  });

  it("permission guard does not require handler to call getFixtureSession again", async () => {
    const res = await fetch(`${url}/perm-guard`);
    assert.equal(res.status, 200);
    assert.ok(capturedHasPermission, "actor in req has the required permission directly");
  });
});

// ?? 12. 405 response includes X-Request-Id header ????????????????????????
describe("api pipeline: 405 includes X-Request-Id", () => {
  let server: http.Server;
  let url: string;

  before(async () => {
    const s = await makeServer([
      {
        method: "GET",
        path: "/get-only-405",
        handler: async (_req, res) => res.json(200, { ok: true }),
      },
    ]);
    server = s.server;
    url = s.url;
  });

  after(async () => {
    await closeServer(server);
  });

  it("405 response includes X-Request-Id header", async () => {
    const res = await fetch(`${url}/get-only-405`, { method: "POST" });
    assert.equal(res.status, 405);
    const requestId = res.headers.get("x-request-id");
    assert.ok(requestId, "X-Request-Id header should be present on 405 response");
    assert.match(
      requestId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      "X-Request-Id should be a UUID"
    );
  });
});

// ?? 13. 500 response includes X-Request-Id and safe body only ????????????
describe("api pipeline: 500 with UnexpectedError does not leak internalDetails", () => {
  let server: http.Server;
  let url: string;

  before(async () => {
    const s = await makeServer([
      {
        method: "GET",
        path: "/unexpected-error",
        handler: async () => {
          const { UnexpectedError } = await import("@platform/platform-errors");
          throw new UnexpectedError("Something went wrong", {
            internalDetails: { secret: "do-not-expose-this" },
          });
        },
      },
    ]);
    server = s.server;
    url = s.url;
  });

  after(async () => {
    await closeServer(server);
  });

  it("500 response includes X-Request-Id and internalDetails is not in body", async () => {
    const res = await fetch(`${url}/unexpected-error`);
    assert.equal(res.status, 500);
    const requestId = res.headers.get("x-request-id");
    assert.ok(requestId, "X-Request-Id header should be present on 500 response");
    const body = await res.json();
    assert.equal(body.code, "UNEXPECTED_ERROR");
    assert.ok(
      !JSON.stringify(body).includes("do-not-expose-this"),
      "internalDetails must not be leaked in 500 response body"
    );
  });
});
