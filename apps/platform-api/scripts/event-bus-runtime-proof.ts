/**
 * Event bus LIVE Postgres proof (ADR-0059 / ADR-ACT-0259).
 *
 * Proves the built-in Postgres outbox against the local Compose Postgres:
 * publish persists; idempotent publish dedups on (org, type, key); tenant id is
 * preserved; secret-bearing payload fields are rejected; RLS isolates events per
 * tenant (foreign-tenant context sees 0); no secret-bearing columns.
 *
 * Runs repos as platform_app (RLS enforces). Creates + cleans up its own orgs.
 * SKIPs honestly (exit 0) if Postgres is unavailable; never fake-PASSes.
 *
 * Usage: npm run proof:event-bus   (requires `make compose-up-default`)
 */

import pg from "pg";
import { loadLocalEnv } from "./lib/local-env.ts";
import { withTenant } from "@platform/adapters-postgres";
import type { AuditEventPort } from "@platform/audit-events";
import { PostgresEventBus, PostgresWorkerRegistry } from "../src/adapters/postgres-event-bus.ts";
import { getEvents, publishEvent } from "../src/usecases/events.ts";

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
  console.log("# Event bus LIVE Postgres proof\n");
  if (!(await reachable(APP_URL))) {
    console.log("SKIP  event-bus proof — Postgres not reachable (run `make compose-up-default`)");
    console.log("\n# SKIPPED (no live Postgres) — not counted as pass or fail");
    process.exit(0);
  }

  const su = new pg.Pool({ connectionString: SU_URL });
  const app = new pg.Pool({ connectionString: APP_URL });
  const deps = {
    bus: new PostgresEventBus(app),
    workers: new PostgresWorkerRegistry(app),
    audit: noopAudit,
  };
  let orgA: string | null = null;
  let orgB: string | null = null;

  try {
    const cols = await su.query<{ c: string }>(
      "SELECT column_name AS c FROM information_schema.columns WHERE table_schema='public' AND table_name='platform_events'"
    );
    check(
      "platform_events has no secret-bearing columns",
      !cols.rows.some((r) => SECRET_FIELD.test(r.c)),
      cols.rows.map((r) => r.c).join(",")
    );

    orgA = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        ["proof-evt-a-" + Date.now().toString(36), "Proof Evt A"]
      )
    ).rows[0]!.id;
    orgB = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        ["proof-evt-b-" + Date.now().toString(36), "Proof Evt B"]
      )
    ).rows[0]!.id;

    // secret payload rejected
    let secretThrew = false;
    try {
      await publishEvent(
        {
          organisationId: orgA,
          eventType: "x",
          idempotencyKey: "s1",
          payload: { api_key: "leak" },
        },
        deps
      );
    } catch {
      secretThrew = true;
    }
    check("secret-bearing payload rejected at publish", secretThrew);

    // publish persists
    const p1 = await publishEvent(
      {
        organisationId: orgA,
        eventType: "thing.created",
        idempotencyKey: "k1",
        payload: { ok: true },
      },
      deps
    );
    check("publish persists a new event", p1.published && !p1.deduplicated);
    // idempotent dedup
    const p2 = await publishEvent(
      { organisationId: orgA, eventType: "thing.created", idempotencyKey: "k1" },
      deps
    );
    check("idempotent publish dedups on (org, type, key)", !p2.published && p2.deduplicated);

    // publish for B
    await publishEvent(
      { organisationId: orgB, eventType: "thing.created", idempotencyKey: "k1" },
      deps
    );

    // tenant id preserved
    const aEvents = await getEvents(orgA, deps);
    check(
      "tenant id is preserved through publish → list",
      aEvents.events.length === 1 && aEvents.events[0]?.organisationId === orgA
    );

    // RLS isolation: orgB tenant context sees only its own event(s), not orgA's
    const crossCount = await withTenant(app as never, orgB, async (client) => {
      const r = await client.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM public.platform_events WHERE organisation_id=$1",
        [orgA]
      );
      return Number(r.rows[0]?.n ?? "0");
    });
    check("RLS hides orgA's events from orgB's tenant context (count = 0)", crossCount === 0);
  } catch (err) {
    check("live event-bus proof", false, err instanceof Error ? err.message : String(err));
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
