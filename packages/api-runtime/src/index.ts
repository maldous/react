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
  gitSha: string | "unknown";
  buildTime: string | "unknown";
  environment: string;
}

/** Creates a health response (always process-alive). */
export function createHealthResponse(): HealthResponse {
  return { status: "ok" };
}

/** Creates a readiness response from a map of dependency checks. */
export function createReadinessResponse(
  dependencies: Record<string, DependencyStatus>
): ReadinessResponse {
  const allOk = Object.values(dependencies).every((s) => s === "ok");
  return { status: allOk ? "ready" : "not-ready", dependencies };
}

/** Creates a version response from available build metadata. */
export function createVersionResponse(options: {
  version: string;
  gitSha?: string;
  buildTime?: string;
  environment: string;
}): VersionResponse {
  return {
    version: options.version,
    gitSha: options.gitSha ?? "unknown",
    buildTime: options.buildTime ?? "unknown",
    environment: options.environment,
  };
}
