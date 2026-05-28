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
import { createRouter } from "./pipeline.ts";
import { getHealth, getReadiness, getVersion } from "./health.ts";
import { getFixtureSession } from "./session.ts";
import { handleGetOrganisationProfile, handlePatchOrganisationProfile } from "./organisation.ts";

const PORT = Number(process.env["PLATFORM_API_PORT"] ?? 3001);

const router = createRouter([
  {
    method: "GET",
    path: "/healthz",
    handler: async (_req, res) => res.json(200, getHealth()),
  },
  {
    method: "GET",
    path: "/readyz",
    handler: async (_req, res) => {
      const result = await getReadiness();
      res.json(result.status === "ready" ? 200 : 503, result);
    },
  },
  {
    method: "GET",
    path: "/version",
    handler: async (_req, res) => res.json(200, getVersion()),
  },
  {
    method: "GET",
    path: "/api/session",
    handler: async (_req, res) => {
      const actor = getFixtureSession();
      if (actor) res.json(200, actor);
      else res.json(401, { code: "UNAUTHENTICATED", message: "No session" });
    },
  },
  {
    method: "GET",
    path: "/api/organisation/profile",
    requiresAuth: true,
    requiredPermission: "organisation.read",
    handler: handleGetOrganisationProfile,
  },
  {
    method: "PATCH",
    path: "/api/organisation/profile",
    requiresAuth: true,
    requiredPermission: "organisation.update",
    handler: handlePatchOrganisationProfile,
  },
]);

const server = http.createServer(router);

server.listen(PORT, () => {
  process.stdout.write(`platform-api listening on http://localhost:${PORT}\n`);
});
