/**
 * Alerting LIVE Postgres proof (ADR-0062 / ADR-ACT-0261).
 *
 * Proves against live Postgres: an operator sets a threshold alert rule; evaluating
 * within threshold does NOT fire (no incident); evaluating above threshold FIRES and
 * opens an incident; RLS isolates rules per tenant; no secret-bearing columns; no_data
 * when the signal has no samples.
 *
 * Runs repos as platform_app (RLS enforces). Creates + cleans up its own orgs.
 * SKIPs honestly (exit 0) if Postgres is unavailable; never fake-PASSes.
 *
 * Usage: npm run proof:alerting   (requires `make compose-up-default`)
 */

import pg from "pg";
import { loadLocalEnv, requireEnv } from "./lib/local-env.ts";
import { withTenant } from "@platform/adapters-postgres";
import type { AuditEventPort } from "@platform/audit-events";
import { PostgresObservabilityRepository } from "../src/adapters/postgres-observability-repository.ts";
import { PostgresNotificationRepository } from "../src/adapters/postgres-notification-repository.ts";
import {
  evaluateAlert,
  listAlertRules,
  recordSample,
  registerSignal,
  setAlertRule,
} from "../src/usecases/observability.ts";

loadLocalEnv();
const SU_URL = requireEnv("POSTGRES_URL");
const APP_URL = requireEnv("POSTGRES_APP_URL");
const SECRET_FIELD = /secret|password|token|credential|api[_-]?key|private[_-]?key/i;
const noopAudit: AuditEventPort = { emit: async () => {}, query: async () => [] };
const ACTOR = { actorId: "00000000-0000-0000-0000-000000000000", actorRoles: ["system-admin"] };

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
  console.log("# Alerting LIVE Postgres proof\n");
  if (!(await reachable(APP_URL))) {
    console.log("SKIP  alerting proof — Postgres not reachable");
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
    const cols = await su.query<{ c: string }>(
      "SELECT column_name AS c FROM information_schema.columns WHERE table_schema='public' AND table_name='alert_rules'"
    );
    check(
      "alert_rules has no secret-bearing columns",
      !cols.rows.some((r) => SECRET_FIELD.test(r.c))
    );

    orgA = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        ["proof-alert-a-" + Date.now().toString(36), "Proof Alert A"]
      )
    ).rows[0]!.id;
    orgB = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        ["proof-alert-b-" + Date.now().toString(36), "Proof Alert B"]
      )
    ).rows[0]!.id;

    await registerSignal({ organisationId: orgA, signalKey: "cpu", displayName: "CPU %" }, deps);
    await setAlertRule(
      {
        organisationId: orgA,
        ruleKey: "cpu-high",
        signalKey: "cpu",
        comparator: "gt",
        threshold: 80,
        severity: "critical",
        actor: ACTOR,
      },
      deps
    );
    const ruleId = (await listAlertRules(orgA, deps, { operator: true })).rules.find(
      (r) => r.ruleKey === "cpu-high"
    )!.id;

    // no_data first
    check(
      "evaluates no_data before any sample",
      (await evaluateAlert(ruleId, deps, ACTOR)).kind === "ok"
    );
    const nd = await evaluateAlert(ruleId, deps, ACTOR);
    check("state is no_data with no samples", nd.kind === "ok" && nd.response.state === "no_data");

    // within
    await recordSample(orgA, "cpu", 50, deps);
    const within = await evaluateAlert(ruleId, deps, ACTOR);
    check(
      "within threshold does not fire",
      within.kind === "ok" &&
        within.response.state === "within" &&
        within.response.incidentId === null
    );

    // fired
    await recordSample(orgA, "cpu", 95, deps);
    const fired = await evaluateAlert(ruleId, deps, ACTOR);
    check("above threshold fires", fired.kind === "ok" && fired.response.state === "fired");
    check("fired evaluation opens an incident", fired.kind === "ok" && !!fired.response.incidentId);

    // RLS isolation of rules
    const cross = await withTenant(app as never, orgB!, async (client) => {
      const r = await client.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM public.alert_rules WHERE organisation_id=$1",
        [orgA]
      );
      return Number(r.rows[0]?.n ?? "0");
    });
    check("RLS hides orgA's alert rules from orgB's tenant context (count = 0)", cross === 0);
  } catch (err) {
    check("live alerting proof", false, err instanceof Error ? err.message : String(err));
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
