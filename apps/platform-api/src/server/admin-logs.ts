import { toSafeResponse } from "@platform/platform-errors";
import type { LogSearchQuery } from "@platform/adapters-loki";
import { searchLogs } from "../usecases/logs.ts";
import { getLokiAdapter } from "./dependencies.ts";
import type { PipelineHandler } from "./pipeline.ts";
import { createLogger } from "@platform/platform-logging";

// GET /api/admin/logs/search — operator log search (ADR-0035, ADR-ACT-0194).
// Authentication + global-host scope are enforced by the pipeline; this handler
// runs only for actors with platform.logs.read.
//
// Query params: service, level, requestId, traceId, tenantId, actorId,
// organisationId, text, start, end, limit, direction.

function parseQuery(rawUrl: string | undefined): LogSearchQuery {
  const url = new URL(rawUrl ?? "/", "http://internal");
  const p = url.searchParams;
  const str = (k: string): string | undefined => {
    const v = p.get(k);
    return v && v.trim().length > 0 ? v : undefined;
  };
  const query: LogSearchQuery = {};
  const service = str("service");
  if (service) query.service = service;
  const level = str("level");
  if (level) query.level = level;
  const requestId = str("requestId");
  if (requestId) query.requestId = requestId;
  const traceId = str("traceId");
  if (traceId) query.traceId = traceId;
  const tenantId = str("tenantId");
  if (tenantId) query.tenantId = tenantId;
  const actorId = str("actorId");
  if (actorId) query.actorId = actorId;
  const organisationId = str("organisationId");
  if (organisationId) query.organisationId = organisationId;
  const text = str("text");
  if (text) query.text = text;
  const start = str("start");
  if (start) query.start = start;
  const end = str("end");
  if (end) query.end = end;
  const limit = str("limit");
  if (limit && Number.isFinite(Number(limit))) query.limit = Number(limit);
  if (str("direction") === "forward") query.direction = "forward";
  return query;
}

export const handleSearchLogs: PipelineHandler = async (req, res) => {
  const query = parseQuery(req.raw.url);
  try {
    const result = await searchLogs(query, { loki: getLokiAdapter() });
    res.json(200, result);
  } catch (err) {
    // Loki unreachable / query error — surface as 502 (upstream dependency),
    // log server-side for correlation, never leak Loki internals to the client.
    createLogger({ name: "admin-logs" }).error(
      { err, requestId: req.requestId },
      "log search failed"
    );
    res.json(502, toSafeResponse(new Error("log.search.unavailable")));
  }
};
