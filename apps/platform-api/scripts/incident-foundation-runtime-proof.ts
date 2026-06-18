/**
 * Incident foundation LIVE Postgres proof (ADR-0062 / ADR-ACT-0261).
 *
 * Proves against live Postgres: a fired alert opens an incident; the incident
 * lifecycle (open → acknowledged → resolved) transitions and is AUDITED (real
 * Postgres audit port); RLS isolates incidents per tenant; no secret-bearing columns.
 *
 * Runs repos as platform_app (RLS enforces). Creates + cleans up its own orgs.
 * SKIPs honestly (exit 0) if Postgres is unavailable; never fake-PASSes.
 *
 * Usage: npm run proof:incident-foundation   (requires `make compose-up-default`)
 */

import pg from "pg";
import { loadLocalEnv, requireEnv } from "./lib/local-env.ts";
import { withSystemAdmin, withTenant } from "@platform/adapters-postgres";
import { createPostgresAuditEventPort } from "@platform/audit-events";
import { PostgresObservabilityRepository } from "../src/adapters/postgres-observability-repository.ts";
import { PostgresNotificationRepository } from "../src/adapters/postgres-notification-repository.ts";
import {
  evaluateAlert,
  listAlertRules,
  listIncidents,
  recordSample,
  registerSignal,
  setAlertRule,
  updateIncident,
} from "../src/usecases/observability.ts";

loadLocalEnv();
const SU_URL = requireEnv("POSTGRES_URL");
const APP_URL = requireEnv("POSTGRES_APP_URL");
const SECRET_FIELD = /secret|password|token|credential|api[_-]?key|private[_-]?key/i;
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
  console.log("# Incident foundation LIVE Postgres proof\n");
  if (!(await reachable(APP_URL))) {
    console.log("SKIP  incident-foundation proof — Postgres not reachable");
    console.log("\n# SKIPPED (no live Postgres) — not counted as pass or fail");
    process.exit(0);
  }
  const su = new pg.Pool({ connectionString: SU_URL });
  const app = new pg.Pool({ connectionString: APP_URL });
  const repo = new PostgresObservabilityRepository(app);
  const audit = createPostgresAuditEventPort(app);
  const deps = {
    metrics: repo,
    alerts: repo,
    incidents: repo,
    audit,
    notifications: { notifications: new PostgresNotificationRepository(app), audit },
  };
  let orgA: string | null = null;
  let orgB: string | null = null;
  try {
    const cols = await su.query<{ c: string }>(
      "SELECT column_name AS c FROM information_schema.columns WHERE table_schema='public' AND table_name='incidents'"
    );
    check(
      "incidents has no secret-bearing columns",
      !cols.rows.some((r) => SECRET_FIELD.test(r.c))
    );

    orgA = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        ["proof-inc-a-" + Date.now().toString(36), "Proof Inc A"]
      )
    ).rows[0]!.id;
    orgB = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        ["proof-inc-b-" + Date.now().toString(36), "Proof Inc B"]
      )
    ).rows[0]!.id;

    await registerSignal({ organisationId: orgA, signalKey: "lat", displayName: "latency" }, deps);
    await setAlertRule(
      {
        organisationId: orgA,
        ruleKey: "lat-high",
        signalKey: "lat",
        comparator: "gte",
        threshold: 100,
        actor: ACTOR,
      },
      deps
    );
    const ruleId = (await listAlertRules(orgA, deps, { operator: true })).rules[0]!.id;
    await recordSample(orgA, "lat", 250, deps);
    const fired = await evaluateAlert(ruleId, deps, ACTOR);
    check("fired alert opens an incident", fired.kind === "ok" && !!fired.response.incidentId);
    const incidentId = fired.kind === "ok" ? fired.response.incidentId! : "";

    // lifecycle
    const ack = await updateIncident({ incidentId, status: "acknowledged", actor: ACTOR }, deps);
    check("incident → acknowledged", ack.kind === "ok" && ack.incident.status === "acknowledged");
    const resolved = await updateIncident({ incidentId, status: "resolved", actor: ACTOR }, deps);
    check("incident → resolved", resolved.kind === "ok" && resolved.incident.status === "resolved");

    // audit trail (incident.opened + incident.updated x2) persisted for this tenant
    const auditCount = await withSystemAdmin(app as never, async (client) => {
      const r = await client.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM public.audit_events WHERE tenant_id=$1 AND action IN ('incident.opened','incident.updated')",
        [orgA]
      );
      return Number(r.rows[0]?.n ?? "0");
    });
    check("incident lifecycle is audited (>=3 audit rows)", auditCount >= 3, `rows=${auditCount}`);

    // RLS isolation
    const cross = await withTenant(app as never, orgB!, async (client) => {
      const r = await client.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM public.incidents WHERE organisation_id=$1",
        [orgA]
      );
      return Number(r.rows[0]?.n ?? "0");
    });
    check("RLS hides orgA's incidents from orgB's tenant context (count = 0)", cross === 0);

    // operator list shows the incident
    check(
      "operator incident list returns the incident",
      (await listIncidents(orgA, deps, { operator: true })).incidents.length === 1
    );
  } catch (err) {
    check(
      "live incident-foundation proof",
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
