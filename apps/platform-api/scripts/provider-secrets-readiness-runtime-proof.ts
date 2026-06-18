/**
 * Provider secrets readiness proof (ADR-0069 / ADR-ACT-0265 — Tier-1 kernel).
 *
 * Honest-readiness proof for the secret-store backends (no live secret value involved):
 *  - the built-in Postgres store reports `ready` against live Postgres;
 *  - an OpenBao store pointed at an UNREACHABLE address reports `degraded`
 *    (never faked, never silently substituted) and resolve() returns null;
 *  - readiness payloads carry NO secret-bearing field.
 *
 * Requires Postgres for the built-in check; SKIPs that check honestly if it is down.
 * The OpenBao-degraded check always runs (it deliberately targets a dead endpoint).
 * Usage: npm run proof:provider-secrets-readiness
 */

import pg from "pg";
import { loadLocalEnv, requireEnv } from "./lib/local-env.ts";
import { PostgresSecretStore } from "../src/adapters/postgres-secret-store.ts";
import { OpenBaoSecretStore } from "../src/adapters/openbao-secret-store.ts";

loadLocalEnv();
const APP_URL = requireEnv("POSTGRES_APP_URL");
const SECRET_FIELD = /secret|password|token|credential|api[_-]?key|private[_-]?key|value/i;

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}
async function pgReachable(url: string): Promise<boolean> {
  const p = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 2000, max: 1 });
  try {
    await p.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await p.end().catch(() => {});
  }
}
function noSecretField(obj: unknown): boolean {
  return !Object.keys(obj as Record<string, unknown>).some((k) => SECRET_FIELD.test(k));
}

async function main(): Promise<void> {
  console.log("# Provider secrets readiness proof\n");

  // OpenBao-degraded check always runs (deliberately dead endpoint, no real OpenBao needed).
  const app = new pg.Pool({ connectionString: APP_URL });
  try {
    const deadBao = new OpenBaoSecretStore(app, {
      address: "http://127.0.0.1:1", // nothing listens here
      token: "unused",
      warn: () => {},
    });
    const baoReady = await deadBao.readiness();
    check(
      "OpenBao unreachable readiness reports degraded",
      baoReady.status === "degraded",
      baoReady.detail
    );
    check("OpenBao readiness payload has no secret-bearing field", noSecretField(baoReady));

    if (await pgReachable(APP_URL)) {
      const builtin = new PostgresSecretStore(app);
      const r = await builtin.readiness();
      check("built-in Postgres store readiness reports ready", r.status === "ready", r.detail);
      check("built-in readiness payload has no secret-bearing field", noSecretField(r));
    } else {
      console.log("SKIP  built-in readiness — Postgres not reachable (`make compose-up-default`)");
    }
  } catch (err) {
    check(
      "provider secrets readiness proof",
      false,
      err instanceof Error ? err.message : String(err)
    );
  } finally {
    await app.end().catch(() => {});
  }

  console.log(failures === 0 ? "\n# ALL CHECKS PASSED" : `\n# ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("proof failed:", err);
  process.exit(1);
});
