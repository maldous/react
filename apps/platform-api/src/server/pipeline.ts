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
import { getSessionStore } from "./dependencies.ts";

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
  requiredPermission?: string;
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
    "Access-Control-Allow-Origin": "*",
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
  const logger = createLogger({ name: "platform-api" });

  return async (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
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
      const err = new ValidationError("Malformed JSON body");
      jsonResponse(res, 400, toSafeResponse(err), requestId);
      return;
    }

    // Find matching route
    const matchingMethod = routes.filter((r) => r.path === path);
    const matchingRoute = matchingMethod.find((r) => r.method === method.toUpperCase());

    if (matchingMethod.length === 0) {
      jsonResponse(res, 404, { code: "NOT_FOUND", message: `${path} not found` }, requestId);
      return;
    }
    if (!matchingRoute) {
      const allowed = matchingMethod.map((r) => r.method).join(", ");
      res.setHeader("Allow", allowed);
      jsonResponse(
        res,
        405,
        { code: "METHOD_NOT_ALLOWED", message: `Method ${method} not allowed for ${path}` },
        requestId
      );
      return;
    }

    // Auth check — resolve actor (null when unauthenticated)
    //
    // Precedence (Tier 1 fixture always wins for deterministic E2E tests):
    //   1. LOCAL_FIXTURE_SESSION env var → fixture actor (no Redis/DB)
    //   2. session cookie → real Redis-backed session actor
    //   3. neither → unauthenticated (null)
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
            // Redis unavailable — treat as unauthenticated (do not crash)
          }
        }
      }
      if (!actor) {
        const err = new UnauthorizedError("Authentication required");
        jsonResponse(res, 401, toSafeResponse(err), requestId);
        return;
      }
      if (
        matchingRoute.requiredPermission &&
        !actor.permissions.includes(matchingRoute.requiredPermission)
      ) {
        const err = new ForbiddenError(`Permission required: ${matchingRoute.requiredPermission}`);
        jsonResponse(res, 403, toSafeResponse(err), requestId);
        return;
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
