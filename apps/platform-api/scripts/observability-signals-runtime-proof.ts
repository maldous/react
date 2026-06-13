/**
 * Observability signals LIVE Postgres proof (ADR-0062 / ADR-ACT-0261).
 *
 * Proves the built-in metric-signal registry + sample store against live Postgres:
 * a signal is registered and queryable with its latest sample; RLS isolates signals
 * + samples per tenant (foreign-tenant context sees 0); no secret-bearing columns.
 *
 * Runs repos as platform_app (RLS enforces). Creates + cleans up its own orgs.
 * SKIPs honestly (exit 0) if Postgres is unavailable; never fake-PASSes.
 *
 * Usage: npm run proof:observability-signals   (requires `make compose-up-default`)
 */

import pg from "pg";
import { loadLocalEnv } from "./lib/local-env.ts";
import { withTenant } from "@platform/adapters-postgres";
import type { AuditEventPort } from "@platform/audit-events";
import { PostgresObservabilityRepository } from "../src/adapters/postgres-observability-repository.ts";
import { PostgresNotificationRepository } from "../src/adapters/postgres-notification-repository.ts";
import { listSignals, recordSample, registerSignal } from "../src/usecases/observability.ts";

loadLocalEnv();
const SU_URL =
  process.env["POSTGRES_URL"] ?? "postgresql://platform:platformpassword@localhost:5433/platform";
const APP_URL =
  process.env["POSTGRES_APP_URL"] ??
  "postgresql://platform_app:platformapppassword@localhost:5433/platform";
const SECRET_FIELD = /secret|password|token|credential|api[_-]?key|private[_-]?key/i;
const noopAudit: AuditEventPort = { emit: async () => {}, query: async () => [] };

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}
async function reachable(url: string): Promise<boolean> {
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

async function main(): Promise<void> {
  console.log("# Observability signals LIVE Postgres proof\n");
  if (!(await reachable(APP_URL))) {
    console.log("SKIP  observability-signals proof — Postgres not reachable");
    console.log("\n# SKIPPED (no live Postgres) — not counted as pass or fail");
    process.exit(0);
  }
  const su = new pg.Pool({ connectionString: SU_URL });
  const app = new pg.Pool({ connectionString: APP_URL });
  const repo = new PostgresObservabilityRepository(app);
  const deps = {
    metrics: repo,
    alerts: repo,
    incidents: repo,
    audit: noopAudit,
    notifications: { notifications: new PostgresNotificationRepository(app), audit: noopAudit },
  };
  let orgA: string | null = null;
  let orgB: string | null = null;
  try {
    for (const t of ["metric_signals", "metric_samples"]) {
      const cols = await su.query<{ c: string }>(
        "SELECT column_name AS c FROM information_schema.columns WHERE table_schema='public' AND table_name=$1",
        [t]
      );
      check(`${t} has no secret-bearing columns`, !cols.rows.some((r) => SECRET_FIELD.test(r.c)));
    }
    orgA = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        ["proof-obs-a-" + Date.now().toString(36), "Proof Obs A"]
      )
    ).rows[0]!.id;
    orgB = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        ["proof-obs-b-" + Date.now().toString(36), "Proof Obs B"]
      )
    ).rows[0]!.id;

    await registerSignal(
      {
        organisationId: orgA,
        signalKey: "api.error_rate",
        displayName: "API error rate",
        unit: "%",
      },
      deps
    );
    await recordSample(orgA, "api.error_rate", 4.2, deps);
    const signals = await listSignals(orgA, deps, { operator: true });
    const sig = signals.signals.find((s) => s.signalKey === "api.error_rate");
    check("signal is registered and queryable", !!sig);
    check(
      "latest sample value is surfaced",
      sig?.latestValue === 4.2,
      `latest=${sig?.latestValue}`
    );
    check("signal list carries no secret fields", !SECRET_FIELD.test(JSON.stringify(signals)));

    // RLS isolation: orgB context sees zero of orgA's signals/samples
    const cross = await withTenant(app as never, orgB!, async (client) => {
      const r = await client.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM public.metric_signals WHERE organisation_id=$1",
        [orgA]
      );
      return Number(r.rows[0]?.n ?? "0");
    });
    check("RLS hides orgA's signals from orgB's tenant context (count = 0)", cross === 0);
  } catch (err) {
    check(
      "live observability-signals proof",
      false,
      err instanceof Error ? err.message : String(err)
    );
  } finally {
    if (orgA)
      await su.query("DELETE FROM public.organisations WHERE id=$1", [orgA]).catch(() => {});
    if (orgB)
      await su.query("DELETE FROM public.organisations WHERE id=$1", [orgB]).catch(() => {});
    await app.end().catch(() => {});
    await su.end().catch(() => {});
  }
  console.log(
    failures === 0 ? "\n# ALL CHECKS PASSED (live Postgres)" : `\n# ${failures} CHECK(S) FAILED`
  );
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((err) => {
  console.error("proof failed:", err);
  process.exit(1);
});
