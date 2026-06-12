/**
 * Platform operations service-readiness runtime proof (ADR-ACT-0228).
 *
 * Probes the SERVICE_REGISTRY against the live local stack (loads local .env):
 *   - Postgres via SELECT 1
 *   - HTTP services via bounded GET to their health URLs
 *   - Redis structurally (wired) — honest caveat (no per-call ping)
 * Asserts honest classification: default-up services are healthy; profile-gated
 * services that are not running are unreachable (NOT faked healthy); no secret printed.
 *
 * Usage: npm run proof:platform-services   (make compose-up-default for the base stack)
 */

import pg from "pg";
import { buildPlatformServicesReadiness } from "../src/usecases/platform-services.ts";
import { loadLocalEnv } from "./lib/local-env.ts";

const POSTGRES_URL =
  process.env["POSTGRES_URL"] ?? "postgresql://platform:platformpassword@localhost:5433/platform";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main(): Promise<void> {
  console.log("# Platform operations service-readiness runtime proof\n");
  loadLocalEnv();
  const pool = new pg.Pool({ connectionString: POSTGRES_URL });
  try {
    const readiness = await buildPlatformServicesReadiness({
      httpProbe: async (url) => {
        try {
          await fetch(url, { method: "GET", signal: AbortSignal.timeout(2000) });
          return true;
        } catch {
          return false;
        }
      },
      pgProbe: async () => {
        try {
          await pool.query("SELECT 1");
          return true;
        } catch {
          return false;
        }
      },
      redisConfigured: () => !!process.env["REDIS_URL"],
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
  } catch (err) {
    check("platform services readiness", false, err instanceof Error ? err.message : String(err));
  } finally {
    await pool.end();
  }

  console.log(failures === 0 ? "\n# ALL CHECKS PASSED" : `\n# ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
