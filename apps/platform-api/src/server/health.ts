import pg from "pg";
import {
  createHealthResponse,
  createReadinessResponse,
  createVersionResponse,
  type HealthResponse,
  type ReadinessResponse,
  type VersionResponse,
} from "@platform/api-runtime";

export { type HealthResponse, type ReadinessResponse, type VersionResponse };

export function getHealth(): HealthResponse {
  return createHealthResponse();
}

export async function getReadiness(postgresUrl?: string): Promise<ReadinessResponse> {
  const dbUrl =
    postgresUrl ??
    process.env["POSTGRES_URL"] ??
    "postgresql://platform:platformpassword@localhost:5433/platform";
  let dbStatus: "ok" | "failed" = "failed";
  const client = new pg.Client(dbUrl);
  try {
    await client.connect();
    await client.query("SELECT 1");
    dbStatus = "ok";
  } catch {
    dbStatus = "failed";
  } finally {
    await client.end().catch(() => undefined);
  }
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
