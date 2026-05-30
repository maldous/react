import {
  createHealthResponse,
  createReadinessResponse,
  createVersionResponse,
  type HealthResponse,
  type ReadinessResponse,
  type VersionResponse,
} from "@platform/api-runtime";
import { PostgresReadinessAdapter } from "@platform/adapters-postgres";
import { getPostgresReadinessAdapter } from "./dependencies.ts";

export { type HealthResponse, type ReadinessResponse, type VersionResponse };

export function getHealth(): HealthResponse {
  return createHealthResponse();
}

/**
 * Readiness probe.
 *
 * SQL is owned by the PostgresReadinessAdapter ? server/ contains no raw SQL.
 * `postgresUrl` may be passed in by tests; production uses the shared
 * composition root in dependencies.ts.
 */
export async function getReadiness(postgresUrl?: string): Promise<ReadinessResponse> {
  const adapter = postgresUrl
    ? new PostgresReadinessAdapter(postgresUrl)
    : getPostgresReadinessAdapter();
  const dbStatus = await adapter.ping();
  return createReadinessResponse({ database: dbStatus });
}

export function getVersion(): VersionResponse {
  return createVersionResponse({
    version: process.env["APP_VERSION"] ?? "0.1.0",
    gitSha: process.env["GIT_SHA"] ?? "unknown",
    buildTime: process.env["BUILD_TIME"] ?? "unknown",
    environment: process.env["NODE_ENV"] ?? "development",
  });
}
