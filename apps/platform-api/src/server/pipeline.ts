import http from "node:http";
import crypto from "node:crypto";
import { createLogger } from "@platform/platform-logging";
import {
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
  toSafeResponse,
} from "@platform/platform-errors";
import { getFixtureSession } from "./session.ts";

// Types
export interface PipelineRequest {
  method: string;
  path: string;
  requestId: string;
  body: unknown;
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
      res.writeHead(405, { Allow: allowed, "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          code: "METHOD_NOT_ALLOWED",
          message: `Method ${method} not allowed for ${path}`,
        })
      );
      return;
    }

    // Auth check
    if (matchingRoute.requiresAuth) {
      const actor = getFixtureSession();
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

    // Build pipeline request/response
    const pipelineReq: PipelineRequest = {
      method,
      path,
      requestId,
      body: bodyResult.body,
      raw: req,
    };
    const pipelineRes: PipelineResponse = {
      raw: res,
      json: (status, body) => jsonResponse(res, status, body, requestId),
    };

    try {
      await matchingRoute.handler(pipelineReq, pipelineRes);
    } catch (err) {
      reqLogger.error({ err }, "unhandled error in route handler");
      const safe = toSafeResponse(err);
      jsonResponse(res, 500, safe, requestId);
    }
  };
}
