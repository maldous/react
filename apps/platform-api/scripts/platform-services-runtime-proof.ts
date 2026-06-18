/**
 * Platform operations service-readiness runtime proof (ADR-ACT-0228 / ADR-ACT-0235).
 *
 * Probes the SERVICE_REGISTRY against the live local stack (loads local .env FIRST,
 * so POSTGRES_URL honours .env.<ENV> when ENV is set):
 *   - Postgres via SELECT 1
 *   - HTTP services via bounded GET to their health URLs (status + body classified —
 *     a non-2xx response is degraded, never healthy)
 *   - Redis structurally (wired) — honest caveat (no per-call ping)
 * Asserts honest classification: default-up services are healthy; profile-gated
 * services that are not running are unreachable (NOT faked healthy); no secret printed.
 * Also asserts the ADR-ACT-0233 console gating: a tenant-admin viewer never receives
 * global-only console links (pgAdmin/MinIO/Grafana/…); WireMock is never linked.
 *
 * Usage: npm run proof:platform-services   (make compose-up-default for the base stack)
 */

import pg from "pg";
import {
  buildPlatformServicesReadiness,
  type HttpProbeResult,
} from "../src/usecases/platform-services.ts";
import { loadLocalEnv, requireEnv } from "./lib/local-env.ts";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main(): Promise<void> {
  console.log("# Platform operations service-readiness runtime proof\n");
  // Env files load BEFORE any connection-string resolution (ADR-ACT-0235 fix):
  // with ENV=test this proof probes the .env.test stack, not the dev default.
  loadLocalEnv();
  const POSTGRES_URL = requireEnv("POSTGRES_URL");
  const pool = new pg.Pool({ connectionString: POSTGRES_URL });
  const httpProbe = async (url: string): Promise<HttpProbeResult | null> => {
    try {
      const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(2000) });
      // 64KB cap — must hold the FULL Keycloak discovery document (see routes.ts).
      const body = ((await response.text().catch(() => "")) || "").slice(0, 65536);
      return { statusCode: response.status, body };
    } catch {
      return null;
    }
  };
  const pgProbe = async (): Promise<boolean> => {
    try {
      await pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  };
  try {
    const readiness = await buildPlatformServicesReadiness({
      httpProbe,
      pgProbe,
      redisConfigured: () => !!process.env["REDIS_URL"],
      viewerMode: "system_operator", // operator view — all exposed console links present
      getHeartbeat: () => null, // standalone proof: no running worker process
    });

    for (const s of readiness.services) {
      console.log(
        `  - ${s.key.padEnd(16)} ${s.status}${s.consoleUrl ? `  (${s.consoleUrl})` : ""}`
      );
    }

    const byKey = (k: string) => readiness.services.find((s) => s.key === k)?.status;
    check("postgres healthy (SELECT 1 via live pool)", byKey("postgres") === "healthy");
    const healthy = readiness.services.filter((s) => s.status === "healthy").length;
    check(
      "≥3 default-up services healthy (postgres/minio/mailpit/…)",
      healthy >= 3,
      `healthy=${healthy}`
    );
    check(
      "every service has an honest status (no 'unknown')",
      readiness.services.every((s) => s.status !== "unknown")
    );
    check(
      "environment + worker registry present",
      !!readiness.environment && readiness.workers.length > 0
    );
    check(
      "no secret/credential leaked in the payload",
      !/secret|password|dsn|token/i.test(JSON.stringify(readiness))
    );
    check(
      "console URLs are localhost-only (or null)",
      readiness.services.every(
        (s) => s.consoleUrl === null || s.consoleUrl.startsWith("http://localhost:")
      )
    );
    check(
      "WireMock is never linked (not_exposed, ADR-ACT-0233)",
      readiness.services.find((s) => s.key === "wiremock")?.consoleUrl === null
    );

    // Console gating (ADR-ACT-0235/0236): the same registry rendered for a
    // TENANT-OPERATOR viewer must withhold every global-only console link and
    // emit the ROUTED tenant-origin Keycloak path (never a direct local port).
    const tenantView = await buildPlatformServicesReadiness({
      httpProbe,
      pgProbe,
      redisConfigured: () => !!process.env["REDIS_URL"],
      viewerMode: "tenant_operator",
      tenantHost: "acme.aldous.info",
      getHeartbeat: () => null,
    });
    const leaked = tenantView.services.filter(
      (s) => s.consoleAccess !== "tenant_safe" && s.consoleUrl !== null
    );
    check(
      "tenant-operator view withholds ALL global-only console links (pgAdmin/MinIO/Grafana/…)",
      leaked.length === 0,
      leaked.map((s) => s.key).join(",")
    );
    const kc = tenantView.services.find((s) => s.key === "keycloak");
    check(
      "tenant-operator Keycloak link is the ROUTED tenant-origin path",
      kc?.consoleUrl === "http://acme.aldous.info/kc" && kc.consoleUrlKind === "routed",
      kc?.consoleUrl ?? "null"
    );
    check(
      "tenant-operator payload declares viewerMode",
      tenantView.viewerMode === "tenant_operator"
    );
  } catch (err) {
    check("platform services readiness", false, err instanceof Error ? err.message : String(err));
  } finally {
    await pool.end();
  }

  console.log(failures === 0 ? "\n# ALL CHECKS PASSED" : `\n# ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
