import http from "node:http";
import crypto from "node:crypto";
import { createLogger } from "@platform/platform-logging";
import {
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
  toSafeResponse,
} from "@platform/platform-errors";
import { type SessionActor } from "@platform/contracts-auth";
import { createRequestContext, type RuntimeContext } from "@platform/platform-runtime-context";
import { getFixtureSession } from "./session.ts";
import { parseSessionCookie } from "./auth.ts";
import { getSessionStore, getApplicationPool } from "./dependencies.ts";
import { serverT } from "./i18n.ts";
import { resolveTenantFromRequest } from "./tenant-resolver.ts";

// Types
export interface PipelineRequest {
  method: string;
  path: string;
  requestId: string;
  body: unknown;
  actor: SessionActor | null;
  context: RuntimeContext;
  raw: http.IncomingMessage;
}

export interface PipelineResponse {
  raw: http.ServerResponse;
  json: (status: number, body: unknown) => void;
}

export type PipelineHandler = (req: PipelineRequest, res: PipelineResponse) => Promise<void>;

export interface Route {
  method: string;
  path: string;
  operationName?: string;
  handler: PipelineHandler;
  requiresAuth?: boolean;
  /**
   * INTERIM STATIC PERMISSION BRIDGE — ADR-ACT-0145
   *
   * requiredPermission is checked against the actor's resolved permission set
   * from the session record. This is a static, pre-resolved check — it does
   * NOT call Keycloak Authorization Services at runtime and does NOT support
   * no-deploy policy changes.
   *
   * Full runtime dynamic policy enforcement (UMA ticket evaluation via
   * KeycloakAuthorisationAdapter) is tracked in ADR-ACT-0145 and requires
   * the access token to be stored in the session record (ADR-ACT-0153 scope).
   * Until ADR-ACT-0145 is complete, permission checks are static and
   * ADR-0030's "no-deploy policy changes" claim is NOT fully satisfied.
   */
  requiredPermission?: string;
  /**
   * FQDN scope enforcement — ADR-0029.
   * "global": route must be called from the global/apex host (no tenant FQDN).
   *           Rejects requests from {slug}.aldous.info.
   * "tenant": route must be called from a tenant FQDN.
   *           Rejects requests from the bare apex aldous.info.
   * undefined: no FQDN scope enforcement (public routes, session, health checks).
   */
  scope?: "global" | "tenant";
}

// requestId generator
export function generateRequestId(): string {
  return crypto.randomUUID();
}

// JSON response helper
export function jsonResponse(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  requestId?: string
): void {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-cache, no-store, must-revalidate",
  };
  if (requestId) headers["X-Request-Id"] = requestId;
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

// Parse JSON body from request (returns null on malformed JSON)
export async function parseJsonBody(
  req: http.IncomingMessage
): Promise<{ ok: true; body: unknown } | { ok: false; error: string }> {
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.includes("application/json")) return { ok: true, body: undefined };
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk: Buffer) => {
      data += chunk.toString();
    });
    req.on("end", () => {
      if (!data) return resolve({ ok: true, body: undefined });
      try {
        resolve({ ok: true, body: JSON.parse(data) });
      } catch {
        resolve({ ok: false, error: "Malformed JSON body" });
      }
    });
    req.on("error", () => resolve({ ok: false, error: "Request body read error" }));
  });
}

// Create the HTTP request handler from a route list
export function createRouter(
  routes: Route[]
): (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void> {
  const logger = createLogger({ name: "platform-api", level: process.env["LOG_LEVEL"] ?? "debug" });

  return async (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-cache, no-store, must-revalidate",
      });
      res.end();
      return;
    }

    const requestId = generateRequestId();
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const reqLogger = logger.child({ requestId, method, path });
    reqLogger.info("incoming request");

    // Parse body
    const bodyResult = await parseJsonBody(req);
    if (!bodyResult.ok) {
      const err = new ValidationError("api.error.malformedJsonBody");
      jsonResponse(
        res,
        400,
        toSafeResponse(err, (message) => serverT(message)),
        requestId
      );
      return;
    }

    // Find matching route
    const matchingMethod = routes.filter((r) => r.path === path);
    const matchingRoute = matchingMethod.find((r) => r.method === method.toUpperCase());

    if (matchingMethod.length === 0) {
      jsonResponse(
        res,
        404,
        { code: "NOT_FOUND", message: serverT("api.error.pathNotFound", { path }) },
        requestId
      );
      return;
    }
    if (!matchingRoute) {
      const allowed = matchingMethod.map((r) => r.method).join(", ");
      res.setHeader("Allow", allowed);
      jsonResponse(
        res,
        405,
        {
          code: "METHOD_NOT_ALLOWED",
          message: serverT("api.error.methodNotAllowed", { method, path }),
        },
        requestId
      );
      return;
    }

    // Auth check ? resolve actor (null when unauthenticated)
    //
    // FQDN tenant resolution (ADR-0029 ?1) ? resolve which tenant owns this request
    // from the Host header. Skipped for fixture sessions (local dev + E2E).
    // When a real tenant is resolved, the session tenant must match.
    const isFixtureMode = !!getFixtureSession();
    const fqdnTenant = isFixtureMode
      ? null
      : await resolveTenantFromRequest(req, getApplicationPool()).catch(() => null);

    // Precedence (Tier 1 fixture always wins for deterministic E2E tests):
    //   1. LOCAL_FIXTURE_SESSION env var ? fixture actor (no Redis/DB)
    //   2. session cookie ? real Redis-backed session actor
    //   3. neither ? unauthenticated (null)
    let actor: SessionActor | null = null;
    if (matchingRoute.requiresAuth) {
      actor = getFixtureSession();
      if (!actor) {
        // Real session: read the HTTP-only cookie
        const sessionId = parseSessionCookie(req.headers["cookie"]);
        if (sessionId) {
          try {
            const record = await getSessionStore().find(sessionId);
            if (record) {
              actor = {
                userId: record.userId,
                tenantId: record.tenantId,
                organisationId: record.organisationId,
                roles: record.roles,
                permissions: record.permissions,
                displayName: record.displayName,
              };
            }
          } catch {
            // Redis unavailable ? treat as unauthenticated (do not crash)
          }
        }
      }

      // FQDN tenant cross-check (ADR-0029 invariant #2):
      // If the request came in on a tenant subdomain, the session must belong
      // to that same tenant. Prevents a user from one tenant accessing another
      // tenant's data by navigating to a different subdomain.
      // system-admin is NOT exempt — they must operate from the global host.
      // Cross-tenant support access requires an explicit audited support session
      // (not yet implemented; tracked as future work in ACTION-REGISTER).
      if (actor && fqdnTenant) {
        if (actor.organisationId !== fqdnTenant.organisationId) {
          const err = new ForbiddenError("api.error.permissionRequired", {
            safeDetails: { permission: "tenant:own" },
          });
          jsonResponse(
            res,
            403,
            toSafeResponse(err, (m) => serverT(m, { permission: "own tenant" })),
            requestId
          );
          return;
        }
      }

      if (!actor) {
        const err = new UnauthorizedError("api.error.authenticationRequired");
        jsonResponse(
          res,
          401,
          toSafeResponse(err, (message) => serverT(message)),
          requestId
        );
        return;
      }
      if (
        matchingRoute.requiredPermission &&
        !actor.permissions.includes(matchingRoute.requiredPermission)
      ) {
        const requiredPermission = matchingRoute.requiredPermission;
        const err = new ForbiddenError("api.error.permissionRequired", {
          safeDetails: { permission: requiredPermission },
        });
        jsonResponse(
          res,
          403,
          toSafeResponse(err, (message) => serverT(message, { permission: requiredPermission })),
          requestId
        );
        return;
      }

      // Route scope enforcement (ADR-0029 §3):
      // "global" routes require no tenant in FQDN — must arrive at the apex host.
      // "tenant" routes require a tenant resolved from FQDN.
      // Fixture mode skips FQDN resolution so scope checks are also skipped.
      if (!isFixtureMode) {
        if (matchingRoute.scope === "global" && fqdnTenant !== null) {
          const err = new ForbiddenError("api.error.permissionRequired", {
            safeDetails: { permission: "platform:global-host-required" },
          });
          jsonResponse(
            res,
            403,
            toSafeResponse(err, (m) => serverT(m, { permission: "global host" })),
            requestId
          );
          return;
        }
        if (matchingRoute.scope === "tenant" && fqdnTenant === null) {
          const err = new ForbiddenError("api.error.permissionRequired", {
            safeDetails: { permission: "tenant:fqdn-required" },
          });
          jsonResponse(
            res,
            403,
            toSafeResponse(err, (m) => serverT(m, { permission: "tenant host" })),
            requestId
          );
          return;
        }
      }
    }

    // Build RuntimeContext after auth resolution
    const context = createRequestContext(requestId, {
      ...(actor
        ? {
            actorId: actor.userId,
            tenantId: actor.tenantId,
            organisationId: actor.organisationId,
            operationName: matchingRoute.operationName ?? path,
          }
        : { operationName: matchingRoute.operationName ?? path }),
    });

    // Enrich logger with actor metadata if available
    const enrichedLogger = actor
      ? reqLogger.child({ actorId: actor.userId, tenantId: actor.tenantId })
      : reqLogger;

    // Build pipeline request/response
    const pipelineReq: PipelineRequest = {
      method,
      path,
      requestId,
      body: bodyResult.body,
      actor,
      context,
      raw: req,
    };
    const pipelineRes: PipelineResponse = {
      raw: res,
      json: (status, body) => jsonResponse(res, status, body, requestId),
    };

    try {
      enrichedLogger.info({ status: "processing" }, "route matched");
      await matchingRoute.handler(pipelineReq, pipelineRes);
      enrichedLogger.info({ status: 200 }, "request complete");
    } catch (err) {
      enrichedLogger.error({ err }, "unhandled error in route handler");
      const safe = toSafeResponse(err);
      jsonResponse(res, 500, safe, requestId);
    }
  };
}
