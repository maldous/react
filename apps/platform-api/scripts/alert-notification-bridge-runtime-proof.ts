/**
 * Alert→notification bridge LIVE Postgres proof (ADR-0062 / ADR-ACT-0261).
 *
 * Proves against live Postgres that a fired alert dispatches a notification through
 * the Phase-6 substrate, gated by the target user's preferences: an ENABLED channel
 * is sent, a DISABLED channel is suppressed; the dispatch is logged; the alert payload
 * carries no secret fields.
 *
 * Runs repos as platform_app (RLS enforces). Creates + cleans up its own org.
 * SKIPs honestly (exit 0) if Postgres is unavailable; never fake-PASSes.
 *
 * Usage: npm run proof:alert-notification-bridge   (requires `make compose-up-default`)
 */

import pg from "pg";
import { loadLocalEnv, requireEnv } from "./lib/local-env.ts";
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
import { updateMyPreferences } from "../src/usecases/notifications.ts";

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
  console.log("# Alert→notification bridge LIVE Postgres proof\n");
  if (!(await reachable(APP_URL))) {
    console.log("SKIP  alert-notification-bridge proof — Postgres not reachable");
    console.log("\n# SKIPPED (no live Postgres) — not counted as pass or fail");
    process.exit(0);
  }
  const su = new pg.Pool({ connectionString: SU_URL });
  const app = new pg.Pool({ connectionString: APP_URL });
  const repo = new PostgresObservabilityRepository(app);
  const notifRepo = new PostgresNotificationRepository(app);
  const notifications = { notifications: notifRepo, audit: noopAudit };
  const deps = { metrics: repo, alerts: repo, incidents: repo, audit: noopAudit, notifications };
  const userId = "alert-target-user";
  let orgA: string | null = null;
  try {
    orgA = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        ["proof-anb-a-" + Date.now().toString(36), "Proof ANB A"]
      )
    ).rows[0]!.id;

    // target user prefs: email(system) enabled, webhook(system) disabled
    await updateMyPreferences(
      {
        organisationId: orgA,
        userId,
        preferences: [
          { channel: "email", category: "system", enabled: true },
          { channel: "webhook", category: "system", enabled: false },
        ],
        actor: { actorId: userId, actorRoles: ["tenant-admin"] },
      },
      notifications
    );

    await registerSignal({ organisationId: orgA, signalKey: "errs", displayName: "errors" }, deps);
    await setAlertRule(
      {
        organisationId: orgA,
        ruleKey: "errs-high",
        signalKey: "errs",
        comparator: "gt",
        threshold: 0,
        severity: "critical",
        notifyUserId: userId,
        notifyCategory: "system",
        actor: ACTOR,
      },
      deps
    );
    await recordSample(orgA, "errs", 7, deps);
    const ruleId = (await listAlertRules(orgA, deps, { operator: true })).rules[0]!.id;
    const fired = await evaluateAlert(ruleId, deps, ACTOR);
    check("alert fired", fired.kind === "ok" && fired.response.state === "fired");
    if (fired.kind !== "ok") throw new Error("alert did not fire");

    const byChannel = Object.fromEntries(fired.response.notified.map((n) => [n.channel, n.status]));
    check(
      "enabled channel (email) is sent via the notification substrate",
      byChannel["email"] === "sent"
    );
    check("disabled channel (webhook) is suppressed", byChannel["webhook"] === "suppressed");
    check(
      "alert notification payload carries no secret fields",
      !SECRET_FIELD.test(JSON.stringify(fired.response))
    );

    // durable dispatch log recorded for the target user
    const logged = await notifRepo.countLog(orgA, userId);
    check("dispatch is logged durably", logged >= 2, `log rows=${logged}`);
  } catch (err) {
    check(
      "live alert-notification-bridge proof",
      false,
      err instanceof Error ? err.message : String(err)
    );
  } finally {
    if (orgA)
      await su.query("DELETE FROM public.organisations WHERE id=$1", [orgA]).catch(() => {});
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
