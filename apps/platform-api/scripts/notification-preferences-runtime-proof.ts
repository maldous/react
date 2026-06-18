/**
 * Notification preferences LIVE Postgres proof (ADR-0068 / ADR-ACT-0260).
 *
 * Proves against the local Compose Postgres: a user reads defaults, sets preferences,
 * and reads them back; preferences are tenant + user scoped (RLS isolation: a foreign
 * tenant context sees 0); no secret-bearing columns.
 *
 * Runs repos as platform_app (RLS enforces). Creates + cleans up its own orgs.
 * SKIPs honestly (exit 0) if Postgres is unavailable; never fake-PASSes.
 *
 * Usage: npm run proof:notification-preferences   (requires `make compose-up-default`)
 */

import pg from "pg";
import { loadLocalEnv, requireEnv } from "./lib/local-env.ts";
import { withTenant } from "@platform/adapters-postgres";
import type { AuditEventPort } from "@platform/audit-events";
import { PostgresNotificationRepository } from "../src/adapters/postgres-notification-repository.ts";
import { getMyPreferences, updateMyPreferences } from "../src/usecases/notifications.ts";

loadLocalEnv();
const SU_URL = requireEnv("POSTGRES_URL");
const APP_URL = requireEnv("POSTGRES_APP_URL");
const SECRET_FIELD = /secret|password|token|credential|api[_-]?key|private[_-]?key/i;
const noopAudit: AuditEventPort = { emit: async () => {}, query: async () => [] };

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}` + (detail ? ` — ${detail}` : ""));
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
  console.log("# Notification preferences LIVE Postgres proof\n");
  if (!(await reachable(APP_URL))) {
    console.log("SKIP  notification-preferences proof — Postgres not reachable");
    console.log("\n# SKIPPED (no live Postgres) — not counted as pass or fail");
    process.exit(0);
  }

  const su = new pg.Pool({ connectionString: SU_URL });
  const app = new pg.Pool({ connectionString: APP_URL });
  const deps = { notifications: new PostgresNotificationRepository(app), audit: noopAudit };
  const actor = { actorId: "user-1", actorRoles: ["tenant-admin"] };
  let orgA: string | null = null;
  let orgB: string | null = null;

  try {
    const cols = await su.query<{ c: string }>(
      "SELECT column_name AS c FROM information_schema.columns WHERE table_schema='public' AND table_name='notification_preferences'"
    );
    check(
      "notification_preferences has no secret-bearing columns",
      !cols.rows.some((r) => SECRET_FIELD.test(r.c))
    );

    orgA = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        ["proof-np-a-" + Date.now().toString(36), "Proof NP A"]
      )
    ).rows[0]!.id;
    orgB = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        ["proof-np-b-" + Date.now().toString(36), "Proof NP B"]
      )
    ).rows[0]!.id;

    check(
      "defaults to no preferences",
      (await getMyPreferences(orgA, "user-1", deps)).preferences.length === 0
    );

    await updateMyPreferences(
      {
        organisationId: orgA,
        userId: "user-1",
        preferences: [
          { channel: "email", category: "security", enabled: true },
          { channel: "webhook", category: "security", enabled: false },
        ],
        actor,
      },
      deps
    );
    const read = await getMyPreferences(orgA, "user-1", deps);
    check("preferences are written and read back", read.preferences.length === 2);
    check(
      "the enabled/disabled flags round-trip",
      read.preferences.find((p) => p.channel === "email")?.enabled === true &&
        read.preferences.find((p) => p.channel === "webhook")?.enabled === false
    );

    // RLS isolation
    const crossCount = await withTenant(app as never, orgB, async (client) => {
      const r = await client.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM public.notification_preferences WHERE organisation_id=$1",
        [orgA]
      );
      return Number(r.rows[0]?.n ?? "0");
    });
    check("RLS hides orgA's preferences from orgB's tenant context (count = 0)", crossCount === 0);
  } catch (err) {
    check(
      "live notification-preferences proof",
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
