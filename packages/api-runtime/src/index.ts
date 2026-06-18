export const PACKAGE_NAME = "@platform/api-runtime";

/** Response shape for GET /healthz ? process liveness. */
export interface HealthResponse {
  status: "ok";
}

/** Dependency readiness status. */
export type DependencyStatus = "ok" | "failed" | "unknown";

/** Response shape for GET /readyz ? dependency readiness. */
export interface ReadinessResponse {
  status: "ready" | "not-ready";
  dependencies: Record<string, DependencyStatus>;
}

/** Response shape for GET /version ? build metadata. */
export interface VersionResponse {
  version: string;
  commit: string;
  buildTime: string;
  environment: string;
}

/** Creates a health response (always process-alive). */
export function createHealthResponse(): HealthResponse {
  return { status: "ok" };
}

/**
 * Creates a readiness response from a map of dependency checks.
 *
 * Status rules:
 *   "ok"      — dependency is confirmed healthy
 *   "failed"  — dependency is confirmed unhealthy → blocks readiness (503)
 *   "unknown" — check could not be completed (e.g. admin API unreachable) →
 *               degraded but does NOT block readiness; traffic can still be served
 *
 * Only "failed" blocks readiness. "unknown" is surfaced in the response body
 * for observability but does not return 503.
 */
export function createReadinessResponse(
  dependencies: Record<string, DependencyStatus>
): ReadinessResponse {
  const anyFailed = Object.values(dependencies).some((s) => s === "failed");
  return { status: anyFailed ? "not-ready" : "ready", dependencies };
}

/** Creates a version response from available build metadata. */
export function createVersionResponse(options: {
  version: string;
  commit?: string;
  buildTime?: string;
  environment: string;
}): VersionResponse {
  return {
    version: options.version,
    commit: options.commit ?? "unknown",
    buildTime: options.buildTime ?? "unknown",
    environment: options.environment,
  };
}
