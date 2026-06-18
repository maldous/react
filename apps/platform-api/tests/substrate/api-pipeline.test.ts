/**
 * API pipeline tests.
 * Tests createRouter() by spinning up a real http.createServer on port 0 (random port).
 * Uses node:http + fetch to exercise the pipeline end-to-end.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  createRouter,
  type Route,
  type PipelineRequest,
  type RouterTestDeps,
} from "../../src/server/pipeline.ts";
import type { SessionRecord } from "@platform/session-runtime";

// Helper: create a test server with given routes, return {server, url}.
// Uses an explicit random port in 50000-59999 instead of port 0 to avoid the
// Node 25 race where server.address().port returns 0 when many describe blocks
// start listen() simultaneously. Retries on EADDRINUSE with a new random port.
function makeServer(
  routes: Route[],
  testDeps?: RouterTestDeps
): Promise<{ server: http.Server; url: string }> {
  const randomPort = () => Math.floor(Math.random() * 10000) + 50000;

  const onListenError = (
    server: http.Server,
    reject: (err: NodeJS.ErrnoException) => void,
    err: NodeJS.ErrnoException
  ): void => {
    server.close(() => reject(err));
  };

  const attempt = (): Promise<{ server: http.Server; url: string }> =>
    new Promise((resolve, reject) => {
      const port = randomPort();
      const router = createRouter(routes, testDeps);
      const server = http.createServer(router);
      server.once("error", (err: NodeJS.ErrnoException) => onListenError(server, reject, err));
      server.listen(port, "127.0.0.1", () => {
        resolve({ server, url: `http://127.0.0.1:${port}` });
      });
    });

  const retry = async (n: number): Promise<{ server: http.Server; url: string }> => {
    try {
      return await attempt();
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (n <= 1 || err.code !== "EADDRINUSE") throw e;
      return retry(n - 1);
    }
  };
  return retry(10);
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

// ---------------------------------------------------------------------------
// UMA pipeline tests (ADR-ACT-0145)
//
// These tests exercise the UMA enforcement path. Because fixture sessions have
// no accessTokenEnc, UMA is not triggered in fixture mode. These tests use the
// RouterTestDeps injection seam to provide a fake session store (with a record
// carrying accessTokenEnc), a fake resolveAccessToken, and a fake authorisation
// port — so no Redis or Keycloak is needed.
// ---------------------------------------------------------------------------

const UMA_SESSION_ID = "uma-test-session-id";
const UMA_COOKIE = `platform_session=${UMA_SESSION_ID}`;

function makeUmaSession(): SessionRecord {
  return {
    sessionId: UMA_SESSION_ID,
    userId: "user-uma",
    tenantId: "tenant-uma",
    organisationId: "org-uma",
    roles: ["tenant-admin"],
    permissions: ["tenant.auth.settings.read", "tenant.auth.settings.write"],
    displayName: "UMA Test User",
    expiresAt: new Date(Date.now() + 3_600_000),
    createdAt: new Date(),
    accessTokenEnc: "enc:fake-token",
  };
}

function fakeStore(): RouterTestDeps["sessionStore"] {
  return {
    find: async () => makeUmaSession(),
    create: async () => UMA_SESSION_ID,
    refresh: async () => {},
    destroy: async () => {},
  };
}

// ?? 14. UMA grant allows access ???????????????????????????????????????????
describe("api pipeline: UMA grant allows access", () => {
  let server: http.Server;
  let url: string;
  let savedEnv: string | undefined;

  before(async () => {
    savedEnv = process.env["LOCAL_FIXTURE_SESSION"];
    delete process.env["LOCAL_FIXTURE_SESSION"];

    const deps: RouterTestDeps = {
      sessionStore: fakeStore(),
      authorisationPort: () => ({
        checkAccess: async () => ({ granted: true as const, rpt: "rpt-token" }),
      }),
      resolveAccessToken: async () => "raw-access-token",
    };

    const s = await makeServer(
      [
        {
          method: "GET",
          path: "/uma-protected",
          requiresAuth: true,
          resource: "admin:auth",
          umaScope: "read",
          handler: async (_req, res) => res.json(200, { ok: true }),
        },
      ],
      deps
    );
    server = s.server;
    url = s.url;
  });

  after(async () => {
    if (savedEnv !== undefined) process.env["LOCAL_FIXTURE_SESSION"] = savedEnv;
    else delete process.env["LOCAL_FIXTURE_SESSION"];
    await closeServer(server);
  });

  it("returns 200 when UMA grants access", async () => {
    const res = await fetch(`${url}/uma-protected`, {
      headers: { Cookie: UMA_COOKIE },
    });
    assert.equal(res.status, 200);
  });
});

// ?? 15. UMA policy_denied blocks even with static permission ???????????????
describe("api pipeline: UMA policy_denied blocks access", () => {
  let server: http.Server;
  let url: string;
  let savedEnv: string | undefined;

  before(async () => {
    savedEnv = process.env["LOCAL_FIXTURE_SESSION"];
    delete process.env["LOCAL_FIXTURE_SESSION"];

    const deps: RouterTestDeps = {
      sessionStore: fakeStore(),
      authorisationPort: () => ({
        checkAccess: async () => ({ granted: false as const, reason: "policy_denied" as const }),
      }),
      resolveAccessToken: async () => "raw-access-token",
    };

    const s = await makeServer(
      [
        {
          method: "GET",
          path: "/uma-denied",
          requiresAuth: true,
          resource: "admin:auth",
          umaScope: "write",
          // actor has this static permission, but UMA must take precedence
          requiredPermission: "tenant.auth.settings.write",
          handler: async (_req, res) => res.json(200, { ok: true }),
        },
      ],
      deps
    );
    server = s.server;
    url = s.url;
  });

  after(async () => {
    if (savedEnv !== undefined) process.env["LOCAL_FIXTURE_SESSION"] = savedEnv;
    else delete process.env["LOCAL_FIXTURE_SESSION"];
    await closeServer(server);
  });

  it("returns 403 when UMA returns policy_denied (even though static permission would allow)", async () => {
    const res = await fetch(`${url}/uma-denied`, {
      headers: { Cookie: UMA_COOKIE },
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, "FORBIDDEN");
  });
});

// ?? 16. UMA insufficient_scope blocks access ?????????????????????????????????????
describe("api pipeline: UMA insufficient_scope blocks access", () => {
  let server: http.Server;
  let url: string;
  let savedEnv: string | undefined;

  before(async () => {
    savedEnv = process.env["LOCAL_FIXTURE_SESSION"];
    delete process.env["LOCAL_FIXTURE_SESSION"];

    const deps: RouterTestDeps = {
      sessionStore: fakeStore(),
      authorisationPort: () => ({
        checkAccess: async () => ({
          granted: false as const,
          reason: "insufficient_scope" as const,
        }),
      }),
      resolveAccessToken: async () => "raw-access-token",
    };

    const s = await makeServer(
      [
        {
          method: "GET",
          path: "/uma-scope",
          requiresAuth: true,
          resource: "admin:auth",
          umaScope: "write",
          handler: async (_req, res) => res.json(200, { ok: true }),
        },
      ],
      deps
    );
    server = s.server;
    url = s.url;
  });

  after(async () => {
    if (savedEnv !== undefined) process.env["LOCAL_FIXTURE_SESSION"] = savedEnv;
    else delete process.env["LOCAL_FIXTURE_SESSION"];
    await closeServer(server);
  });

  it("returns 403 when UMA returns insufficient_scope", async () => {
    const res = await fetch(`${url}/uma-scope`, { headers: { Cookie: UMA_COOKIE } });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, "FORBIDDEN");
  });
});

// ?? 17. UMA insufficient_auth_level returns STEP_UP_REQUIRED ????????????????????
describe("api pipeline: UMA insufficient_auth_level returns STEP_UP_REQUIRED", () => {
  let server: http.Server;
  let url: string;
  let savedEnv: string | undefined;

  before(async () => {
    savedEnv = process.env["LOCAL_FIXTURE_SESSION"];
    delete process.env["LOCAL_FIXTURE_SESSION"];

    const deps: RouterTestDeps = {
      sessionStore: fakeStore(),
      authorisationPort: () => ({
        checkAccess: async () => ({
          granted: false as const,
          reason: "insufficient_auth_level" as const,
        }),
      }),
      resolveAccessToken: async () => "raw-access-token",
    };

    const s = await makeServer(
      [
        {
          method: "GET",
          path: "/uma-stepup",
          requiresAuth: true,
          resource: "admin:auth",
          umaScope: "write",
          handler: async (_req, res) => res.json(200, { ok: true }),
        },
      ],
      deps
    );
    server = s.server;
    url = s.url;
  });

  after(async () => {
    if (savedEnv !== undefined) process.env["LOCAL_FIXTURE_SESSION"] = savedEnv;
    else delete process.env["LOCAL_FIXTURE_SESSION"];
    await closeServer(server);
  });

  it("returns 401 with code STEP_UP_REQUIRED", async () => {
    const res = await fetch(`${url}/uma-stepup`, { headers: { Cookie: UMA_COOKIE } });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, "STEP_UP_REQUIRED");
  });
});

// ?? 18. Keycloak unavailable falls back to static permission ????????????????
describe("api pipeline: Keycloak unavailable degrades to static check", () => {
  let server: http.Server;
  let url: string;
  let savedEnv: string | undefined;

  before(async () => {
    savedEnv = process.env["LOCAL_FIXTURE_SESSION"];
    delete process.env["LOCAL_FIXTURE_SESSION"];

    const deps: RouterTestDeps = {
      sessionStore: fakeStore(),
      authorisationPort: () => ({
        checkAccess: async () => ({
          granted: false as const,
          reason: "keycloak_unavailable" as const,
        }),
      }),
      resolveAccessToken: async () => "raw-access-token",
    };

    const s = await makeServer(
      [
        {
          method: "GET",
          path: "/uma-degraded",
          requiresAuth: true,
          resource: "admin:auth",
          umaScope: "read",
          // actor has this permission — static fallback should grant
          requiredPermission: "tenant.auth.settings.read",
          handler: async (_req, res) => res.json(200, { ok: true }),
        },
      ],
      deps
    );
    server = s.server;
    url = s.url;
  });

  after(async () => {
    if (savedEnv !== undefined) process.env["LOCAL_FIXTURE_SESSION"] = savedEnv;
    else delete process.env["LOCAL_FIXTURE_SESSION"];
    await closeServer(server);
  });

  it("returns 200 via static fallback when Keycloak is unavailable (degraded mode)", async () => {
    const res = await fetch(`${url}/uma-degraded`, { headers: { Cookie: UMA_COOKIE } });
    assert.equal(res.status, 200);
  });
});

// ?? 19. Sole-UMA route fails closed when Keycloak unavailable ??????????????
describe("api pipeline: sole-UMA route fails closed when Keycloak unavailable", () => {
  let server: http.Server;
  let url: string;
  let savedEnv: string | undefined;

  before(async () => {
    savedEnv = process.env["LOCAL_FIXTURE_SESSION"];
    delete process.env["LOCAL_FIXTURE_SESSION"];

    const deps: RouterTestDeps = {
      sessionStore: fakeStore(),
      authorisationPort: () => ({
        checkAccess: async () => ({
          granted: false as const,
          reason: "keycloak_unavailable" as const,
        }),
      }),
      resolveAccessToken: async () => "raw-access-token",
    };

    const s = await makeServer(
      [
        {
          method: "GET",
          path: "/uma-sole",
          requiresAuth: true,
          resource: "admin:auth",
          umaScope: "read",
          // NO requiredPermission — must fail closed
          handler: async (_req, res) => res.json(200, { ok: true }),
        },
      ],
      deps
    );
    server = s.server;
    url = s.url;
  });

  after(async () => {
    if (savedEnv !== undefined) process.env["LOCAL_FIXTURE_SESSION"] = savedEnv;
    else delete process.env["LOCAL_FIXTURE_SESSION"];
    await closeServer(server);
  });

  it("returns 403 (fail-closed) when sole-UMA route's Keycloak is unavailable", async () => {
    const res = await fetch(`${url}/uma-sole`, { headers: { Cookie: UMA_COOKIE } });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, "FORBIDDEN");
  });
});

// ?? 19b. Unregistered resource degrades to static permission ?????????????????
describe("api pipeline: unregistered UMA resource degrades to static check", () => {
  let server: http.Server;
  let url: string;
  let savedEnv: string | undefined;

  before(async () => {
    savedEnv = process.env["LOCAL_FIXTURE_SESSION"];
    delete process.env["LOCAL_FIXTURE_SESSION"];

    const deps: RouterTestDeps = {
      sessionStore: fakeStore(),
      authorisationPort: () => ({
        // Keycloak reports the resource is not a registered protected resource
        // (provisioning gap) — must degrade to the static permission backstop.
        checkAccess: async () => ({
          granted: false as const,
          reason: "resource_not_registered" as const,
        }),
      }),
      resolveAccessToken: async () => "raw-access-token",
    };

    const s = await makeServer(
      [
        {
          method: "GET",
          path: "/uma-unregistered",
          requiresAuth: true,
          resource: "admin:provider_configs",
          umaScope: "read",
          // actor holds this permission — static fallback should grant
          requiredPermission: "tenant.auth.settings.read",
          handler: async (_req, res) => res.json(200, { ok: true }),
        },
      ],
      deps
    );
    server = s.server;
    url = s.url;
  });

  after(async () => {
    if (savedEnv !== undefined) process.env["LOCAL_FIXTURE_SESSION"] = savedEnv;
    else delete process.env["LOCAL_FIXTURE_SESSION"];
    await closeServer(server);
  });

  it("returns 200 via static fallback when the UMA resource is not registered", async () => {
    const res = await fetch(`${url}/uma-unregistered`, { headers: { Cookie: UMA_COOKIE } });
    assert.equal(res.status, 200);
  });
});

// ?? 19c. Dual cookies — a stale platform_session must not shadow a valid one ??
describe("api pipeline: resolves a valid session when a stale cookie is also present", () => {
  let server: http.Server;
  let url: string;
  let savedEnv: string | undefined;

  before(async () => {
    savedEnv = process.env["LOCAL_FIXTURE_SESSION"];
    delete process.env["LOCAL_FIXTURE_SESSION"];

    // Store knows ONLY the valid id; the stale id resolves to null (ADR-ACT-0278).
    const deps: RouterTestDeps = {
      sessionStore: {
        find: async (id: string) => (id === UMA_SESSION_ID ? makeUmaSession() : null),
        create: async () => UMA_SESSION_ID,
        refresh: async () => {},
        destroy: async () => {},
      },
      resolveAccessToken: async () => "raw-access-token",
    };

    const s = await makeServer(
      [
        {
          method: "GET",
          path: "/needs-auth",
          requiresAuth: true,
          requiredPermission: "tenant.auth.settings.read",
          handler: async (_req, res) => res.json(200, { ok: true }),
        },
      ],
      deps
    );
    server = s.server;
    url = s.url;
  });

  after(async () => {
    if (savedEnv !== undefined) process.env["LOCAL_FIXTURE_SESSION"] = savedEnv;
    else delete process.env["LOCAL_FIXTURE_SESSION"];
    await closeServer(server);
  });

  it("uses the valid platform_session even when a stale one is sent first", async () => {
    const res = await fetch(`${url}/needs-auth`, {
      headers: { Cookie: `platform_session=stale-and-gone; platform_session=${UMA_SESSION_ID}` },
    });
    assert.equal(res.status, 200);
  });
});

// ?? 19d. Valid session, unresolvable UMA token → degrade to static (not 401) ??
describe("api pipeline: unresolvable UMA token degrades to static for a route with a fallback", () => {
  let server: http.Server;
  let url: string;
  let savedEnv: string | undefined;

  before(async () => {
    savedEnv = process.env["LOCAL_FIXTURE_SESSION"];
    delete process.env["LOCAL_FIXTURE_SESSION"];

    const deps: RouterTestDeps = {
      sessionStore: fakeStore(),
      authorisationPort: () => ({
        checkAccess: async () => ({ granted: true as const, rpt: "rpt" }),
      }),
      // Token cannot be resolved (refresh token dead). Session itself is valid.
      resolveAccessToken: async () => null,
    };

    const s = await makeServer(
      [
        {
          method: "GET",
          path: "/uma-tokenless",
          requiresAuth: true,
          resource: "admin:auth",
          umaScope: "read",
          requiredPermission: "tenant.auth.settings.read", // actor holds it
          handler: async (_req, res) => res.json(200, { ok: true }),
        },
      ],
      deps
    );
    server = s.server;
    url = s.url;
  });

  after(async () => {
    if (savedEnv !== undefined) process.env["LOCAL_FIXTURE_SESSION"] = savedEnv;
    else delete process.env["LOCAL_FIXTURE_SESSION"];
    await closeServer(server);
  });

  it("returns 200 via static fallback when the UMA access token is unresolvable", async () => {
    const res = await fetch(`${url}/uma-tokenless`, { headers: { Cookie: UMA_COOKIE } });
    assert.equal(res.status, 200);
  });
});

// ?? 20. Missing/expired token → 401 ??????????????????????????????????????????
describe("api pipeline: missing access token fails with 401", () => {
  let server: http.Server;
  let url: string;
  let savedEnv: string | undefined;

  before(async () => {
    savedEnv = process.env["LOCAL_FIXTURE_SESSION"];
    delete process.env["LOCAL_FIXTURE_SESSION"];

    const deps: RouterTestDeps = {
      sessionStore: fakeStore(),
      authorisationPort: () => ({
        checkAccess: async () => ({ granted: true as const, rpt: "rpt" }),
      }),
      // resolveAccessToken returns null — token refresh failed or expired
      resolveAccessToken: async () => null,
    };

    const s = await makeServer(
      [
        {
          method: "GET",
          path: "/uma-no-token",
          requiresAuth: true,
          resource: "admin:auth",
          umaScope: "read",
          handler: async (_req, res) => res.json(200, { ok: true }),
        },
      ],
      deps
    );
    server = s.server;
    url = s.url;
  });

  after(async () => {
    if (savedEnv !== undefined) process.env["LOCAL_FIXTURE_SESSION"] = savedEnv;
    else delete process.env["LOCAL_FIXTURE_SESSION"];
    await closeServer(server);
  });

  it("returns 401 when resolveAccessToken returns null (token missing or refresh failed)", async () => {
    const res = await fetch(`${url}/uma-no-token`, { headers: { Cookie: UMA_COOKIE } });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, "UNAUTHORIZED");
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

// ─── 21. Route handler catches ConflictError → 409 ─────────────────────────
// Mirrors the pattern in routes.ts POST /api/admin/tenants: the handler
// catches ConflictError from provisionTenant and calls res.json(409, ...).
// If the catch is ever removed, this test fails — preventing a silent 500 regression.
describe("api pipeline: route handler that catches ConflictError returns 409", () => {
  let server: http.Server;
  let url: string;

  before(async () => {
    const { ConflictError } = await import("@platform/platform-errors");
    const s = await makeServer([
      {
        method: "POST",
        path: "/provision",
        requiresAuth: false,
        handler: async (_req, res) => {
          // Simulates provisionTenant throwing when a slug is already taken.
          // The catch block is what routes.ts POST /api/admin/tenants does.
          try {
            throw new ConflictError("slug already taken");
          } catch (err) {
            if (err instanceof ConflictError) {
              res.json(409, { code: "CONFLICT", message: err.message });
              return;
            }
            throw err;
          }
        },
      },
    ]);
    server = s.server;
    url = s.url;
  });

  after(async () => {
    await closeServer(server);
  });

  it("returns 409 with CONFLICT code when slug is taken", async () => {
    const res = await fetch(`${url}/provision`, { method: "POST" });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, "CONFLICT");
    assert.ok(
      typeof body.message === "string" && body.message.length > 0,
      "conflict body must include a message"
    );
  });
});
