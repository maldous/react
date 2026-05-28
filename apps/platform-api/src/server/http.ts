/**
 * Minimal platform-api HTTP server for local development and E2E testing.
 * Serves: /healthz, /readyz, /version, /api/session
 * Configure fixture session via LOCAL_FIXTURE_SESSION env var.
 *
 * Usage:
 *   node --loader apps/platform-api/loader.mjs apps/platform-api/src/server/http.ts
 *
 * Fixture session roles (LOCAL_FIXTURE_SESSION):
 *   tenant-admin — full permissions
 *   viewer       — read-only permissions
 *   unauthenticated (or unset) — returns 401 on /api/session
 */
import http from "node:http";
import process from "node:process";
import { getHealth, getReadiness, getVersion } from "./health.ts";
import { getFixtureSession } from "./session.ts";

const PORT = Number(process.env["PLATFORM_API_PORT"] ?? 3001);

function jsonResponse(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
    });
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  try {
    if (url.pathname === "/healthz") {
      jsonResponse(res, 200, getHealth());
    } else if (url.pathname === "/readyz") {
      const result = await getReadiness();
      jsonResponse(res, result.status === "ready" ? 200 : 503, result);
    } else if (url.pathname === "/version") {
      jsonResponse(res, 200, getVersion());
    } else if (url.pathname === "/api/session") {
      const actor = getFixtureSession();
      if (actor) {
        jsonResponse(res, 200, actor);
      } else {
        jsonResponse(res, 401, { code: "UNAUTHENTICATED", message: "No session" });
      }
    } else {
      jsonResponse(res, 404, { code: "NOT_FOUND", message: `${url.pathname} not found` });
    }
  } catch {
    jsonResponse(res, 500, { code: "UNEXPECTED_ERROR", message: "Internal error" });
  }
});

server.listen(PORT, () => {
  process.stdout.write(`platform-api listening on http://localhost:${PORT}\n`);
});
