/**
 * Metering LIVE Postgres proof (ADR-0067 / ADR-ACT-0256).
 *
 * Proves the built-in metering substrate against the local Compose Postgres:
 * idempotent recording (tenant+meter+idempotency key); invalid meter key rejected;
 * negative quantity rejected unless an explicit adjustment; entitlement gate on
 * recording; RLS tenant isolation of usage; windowed aggregation; no secret columns.
 *
 * Runs repos as platform_app (RLS enforces). Creates + cleans up its own v4 test
 * orgs. SKIPs honestly (exit 0) if Postgres is unavailable; never fake-PASSes.
 *
 * Usage: npm run proof:metering   (requires `make compose-up-default`)
 */

import pg from "pg";
import { loadLocalEnv, requireEnv } from "./lib/local-env.ts";
import { withSystemAdmin, withTenant } from "@platform/adapters-postgres";
import { PostgresMeteringRepository } from "../src/adapters/postgres-metering-repository.ts";
import { PostgresEntitlementRepository } from "../src/adapters/postgres-entitlement-repository.ts";
import { recordMeterEvent } from "../src/usecases/metering.ts";

loadLocalEnv();
const SU_URL = requireEnv("POSTGRES_URL");
const APP_URL = requireEnv("POSTGRES_APP_URL");
const SECRET_FIELD = /secret|password|token|credential|api[_-]?key|private[_-]?key/i;

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
  console.log("# Metering LIVE Postgres proof\n");
  if (!(await reachable(APP_URL))) {
    console.log("SKIP  metering proof — Postgres not reachable (run `make compose-up-default`)");
    console.log("\n# SKIPPED (no live Postgres) — not counted as pass or fail");
    process.exit(0);
  }

  const su = new pg.Pool({ connectionString: SU_URL });
  const app = new pg.Pool({ connectionString: APP_URL });
  const metering = new PostgresMeteringRepository(app);
  const entitlements = new PostgresEntitlementRepository(app);
  const deps = { metering, entitlements };
  let orgA: string | null = null;
  let orgB: string | null = null;

  try {
    // no secret columns
    const cols = await su.query<{ c: string }>(
      "SELECT column_name AS c FROM information_schema.columns WHERE table_schema='public' AND table_name='meter_events'"
    );
    check(
      "meter_events has no secret-bearing columns",
      !cols.rows.some((r) => SECRET_FIELD.test(r.c))
    );

    orgA = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        ["proof-meter-a-" + Date.now().toString(36), "Proof Meter A"]
      )
    ).rows[0]!.id;
    orgB = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        ["proof-meter-b-" + Date.now().toString(36), "Proof Meter B"]
      )
    ).rows[0]!.id;

    // grant the webhooks entitlement to A only (recording requires it)
    await entitlements.upsert({
      organisationId: orgA,
      entitlementKey: "webhooks",
      state: "granted",
      source: "system",
      updatedBy: "op",
    });

    // entitlement gate: B is not entitled → recording denied
    let denied = false;
    try {
      await recordMeterEvent(
        {
          organisationId: orgB,
          meterKey: "webhooks.deliveries",
          quantity: 1,
          idempotencyKey: "b1",
        },
        deps
      );
    } catch {
      denied = true;
    }
    check("recording denied when tenant lacks the meter's entitlement", denied);

    // idempotent recording
    const r1 = await recordMeterEvent(
      { organisationId: orgA, meterKey: "webhooks.deliveries", quantity: 2, idempotencyKey: "k1" },
      deps
    );
    check("first record is recorded", r1.kind === "ok" && r1.recorded && !r1.deduplicated);
    const r1b = await recordMeterEvent(
      { organisationId: orgA, meterKey: "webhooks.deliveries", quantity: 2, idempotencyKey: "k1" },
      deps
    );
    check(
      "replay with same idempotency key is deduplicated",
      r1b.kind === "ok" && !r1b.recorded && r1b.deduplicated
    );
    await recordMeterEvent(
      { organisationId: orgA, meterKey: "webhooks.deliveries", quantity: 3, idempotencyKey: "k2" },
      deps
    );

    // invalid meter key
    const bad = await recordMeterEvent(
      { organisationId: orgA, meterKey: "not.a.meter", quantity: 1, idempotencyKey: "k3" },
      deps
    );
    check("unknown meter key is rejected", bad.kind === "unknown_meter");

    // negative quantity rejected unless adjustment
    let negThrew = false;
    try {
      await recordMeterEvent(
        {
          organisationId: orgA,
          meterKey: "webhooks.deliveries",
          quantity: -1,
          idempotencyKey: "k4",
        },
        deps
      );
    } catch {
      negThrew = true;
    }
    check("negative quantity rejected without adjustment", negThrew);
    const adj = await recordMeterEvent(
      {
        organisationId: orgA,
        meterKey: "webhooks.deliveries",
        quantity: -1,
        idempotencyKey: "k5",
        metadata: { adjustment: true },
      },
      deps
    );
    check(
      "negative quantity accepted as an explicit adjustment",
      adj.kind === "ok" && adj.recorded
    );

    // aggregation: 2 (k1) + 3 (k2) - 1 (k5 adjustment) = 4
    const usage = await metering.aggregateAsOperator(orgA, "webhooks.deliveries", "lifetime");
    check("windowed aggregation sums quantity (incl. adjustment)", usage === 4, `usage=${usage}`);

    // RLS isolation: under orgB's tenant context, an unfiltered count is 0
    const crossCount = await withTenant(app as never, orgB, async (client) => {
      const r = await client.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM public.meter_events"
      );
      return Number(r.rows[0]?.n ?? "0");
    });
    check("RLS hides orgA's meter events from orgB's context (count = 0)", crossCount === 0);
    const opCount = await withSystemAdmin(app as never, async (client) => {
      const r = await client.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM public.meter_events WHERE organisation_id=$1",
        [orgA]
      );
      return Number(r.rows[0]?.n ?? "0");
    });
    check("operator (rls_bypass) sees orgA's meter events", opCount >= 1);
  } catch (err) {
    check("live metering proof", false, err instanceof Error ? err.message : String(err));
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
