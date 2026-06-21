/**
 * Alert-to-incident closure runtime proof.
 *
 * Proves the built-in observability path can fire an alert, open an incident,
 * transition it, and leave an auditable trail. This is the bridge the composed
 * Alertmanager route will eventually feed.
 */

import { strict as assert } from "node:assert";
import pg from "pg";
import { loadLocalEnv, requireEnv } from "./lib/local-env.ts";
import { PostgresObservabilityRepository } from "../src/adapters/postgres-observability-repository.ts";
import { PostgresNotificationRepository } from "../src/adapters/postgres-notification-repository.ts";
import { createPostgresAuditEventPort } from "@platform/audit-events";
import { evaluateAlert, updateIncident } from "../src/usecases/observability.ts";

async function main(): Promise<void> {
  loadLocalEnv();
  const POSTGRES_URL = requireEnv("POSTGRES_URL");
  const pool = new pg.Pool({ connectionString: POSTGRES_URL });
  const repo = new PostgresObservabilityRepository(pool);
  const audit = createPostgresAuditEventPort(pool);
  const deps = {
    metrics: repo,
    alerts: repo,
    incidents: repo,
    audit,
    notifications: { notifications: new PostgresNotificationRepository(pool), audit },
  };

  const org = (
    await pool.query<{ id: string }>(
      "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
      ["proof-alert-incident-" + Date.now().toString(36), "Proof Alert Incident"]
    )
  ).rows[0]!.id;

  try {
    await repo.registerSignal({
      organisationId: org,
      signalKey: "proof.alert.metric",
      displayName: "Proof alert metric",
      unit: "count",
    });
    await repo.recordSample(org, "proof.alert.metric", 99);
    await repo.upsertRule({
      organisationId: org,
      ruleKey: "proof.alert.rule",
      signalKey: "proof.alert.metric",
      comparator: "gt",
      threshold: 10,
      severity: "critical",
      enabled: true,
      notifyCategory: "system",
      updatedBy: "proof",
    });
    const rule = (await repo.listRulesAsOperator(org)).find(
      (r) => r.ruleKey === "proof.alert.rule"
    );
    assert.ok(rule, "alert rule created");

    const fired = await evaluateAlert(rule.id, deps, {
      actorId: "proof",
      actorRoles: ["system-admin"],
    });
    assert.equal(fired.kind, "ok");
    assert.equal(fired.response.state, "fired");
    assert.ok(fired.response.incidentId);

    const incidentId = fired.response.incidentId!;
    const updated = await updateIncident(
      {
        incidentId,
        status: "resolved",
        actor: { actorId: "proof", actorRoles: ["system-admin"] },
      },
      deps
    );
    assert.equal(updated.kind, "ok");
    assert.equal(updated.incident.status, "resolved");

    const auditRows = await pool.query<{ action: string }>(
      "SELECT action FROM public.audit_events WHERE tenant_id=$1 AND action IN ('incident.opened','incident.updated') ORDER BY id",
      [org]
    );
    assert.equal(auditRows.rows.length >= 2, true);

    console.log(
      JSON.stringify(
        {
          capability: "V2 alert-to-incident closure",
          result: "PASSED",
          organisationId: org,
          incidentId,
          auditActions: auditRows.rows.map((r) => r.action),
        },
        null,
        2
      )
    );
  } finally {
    await pool.query("DELETE FROM public.organisations WHERE id=$1", [org]).catch(() => {});
    await pool.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
