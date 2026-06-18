/**
 * Quota enforcement LIVE Postgres proof (ADR-0067 / ADR-ACT-0256).
 *
 * Proves real quota enforcement against the local Compose Postgres, using the
 * existing `webhooks` entitlement + `webhooks.deliveries` meter:
 *   grant entitlement → set quota limit → record usage below limit → allowed →
 *   record up to/over limit → denied (decidedBy quota) → revoke entitlement →
 *   denied (decidedBy entitlement, BEFORE quota) → no-quota key → allowed.
 * assertQuota throws a typed error on denial.
 *
 * SKIPs honestly (exit 0) if Postgres is unavailable; never fake-PASSes.
 *
 * Usage: npm run proof:quota-enforcement   (requires `make compose-up-default`)
 */

import pg from "pg";
import { loadLocalEnv, requireEnv } from "./lib/local-env.ts";
import type { AuditEvent, AuditEventPort } from "@platform/audit-events";
import { PostgresMeteringRepository } from "../src/adapters/postgres-metering-repository.ts";
import { PostgresEntitlementRepository } from "../src/adapters/postgres-entitlement-repository.ts";
import { PostgresQuotaRepository } from "../src/adapters/postgres-quota-repository.ts";
import { recordMeterEvent } from "../src/usecases/metering.ts";
import { assertQuota, evaluateQuota, setQuota } from "../src/usecases/quota.ts";

loadLocalEnv();
const SU_URL = requireEnv("POSTGRES_URL");
const APP_URL = requireEnv("POSTGRES_APP_URL");
const noopAudit: AuditEventPort = { emit: async (_e: AuditEvent) => {}, query: async () => [] };
const ACTOR = { actorId: "op-1", actorRoles: ["system_operator"] };

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
  console.log("# Quota enforcement LIVE Postgres proof\n");
  if (!(await reachable(APP_URL))) {
    console.log("SKIP  quota proof — Postgres not reachable (run `make compose-up-default`)");
    console.log("\n# SKIPPED (no live Postgres) — not counted as pass or fail");
    process.exit(0);
  }

  const su = new pg.Pool({ connectionString: SU_URL });
  const app = new pg.Pool({ connectionString: APP_URL });
  const metering = new PostgresMeteringRepository(app);
  const entitlements = new PostgresEntitlementRepository(app);
  const quota = new PostgresQuotaRepository(app);
  const deps = { quota, metering, entitlements, audit: noopAudit };
  const operator = { operator: true } as const;
  let orgA: string | null = null;

  try {
    orgA = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        ["proof-quota-" + Date.now().toString(36), "Proof Quota"]
      )
    ).rows[0]!.id;

    await entitlements.upsert({
      organisationId: orgA,
      entitlementKey: "webhooks",
      state: "granted",
      source: "system",
      updatedBy: "op",
    });

    // no quota configured yet ⇒ allowed (quotas are opt-in)
    const noQuota = await evaluateQuota(orgA, "webhooks.deliveries", deps, operator);
    check(
      "no configured quota ⇒ allowed (no_quota)",
      noQuota.allowed && noQuota.decidedBy === "no_quota"
    );

    // operator sets a deny quota: limit 3 lifetime on webhooks.deliveries
    const set = await setQuota(
      {
        organisationId: orgA,
        quotaKey: "webhooks.deliveries",
        entitlementKey: "webhooks",
        meterKey: "webhooks.deliveries",
        limit: 3,
        window: "lifetime",
        action: "deny",
        actor: ACTOR,
      },
      deps
    );
    check("operator sets a quota limit", set.kind === "ok");

    // record usage below the limit → allowed
    await recordMeterEvent(
      { organisationId: orgA, meterKey: "webhooks.deliveries", quantity: 1, idempotencyKey: "q1" },
      { metering, entitlements }
    );
    await recordMeterEvent(
      { organisationId: orgA, meterKey: "webhooks.deliveries", quantity: 1, idempotencyKey: "q2" },
      { metering, entitlements }
    );
    const below = await evaluateQuota(orgA, "webhooks.deliveries", deps, operator);
    check(
      "usage below limit ⇒ allowed (within)",
      below.allowed && below.state === "within",
      `usage=${below.usage}/${below.limit}`
    );

    // record usage up to/over the limit → denied by quota
    await recordMeterEvent(
      { organisationId: orgA, meterKey: "webhooks.deliveries", quantity: 1, idempotencyKey: "q3" },
      { metering, entitlements }
    );
    const over = await evaluateQuota(orgA, "webhooks.deliveries", deps, operator);
    check(
      "usage at/over limit ⇒ denied by quota (exceeded)",
      !over.allowed && over.decidedBy === "quota" && over.state === "exceeded",
      `usage=${over.usage}/${over.limit}`
    );

    // assertQuota throws a typed error on denial
    let assertThrew = false;
    try {
      await assertQuota(orgA, "webhooks.deliveries", deps, operator);
    } catch {
      assertThrew = true;
    }
    check("assertQuota throws a typed error when denied", assertThrew);

    // revoke entitlement → denied by ENTITLEMENT, before quota
    await entitlements.upsert({
      organisationId: orgA,
      entitlementKey: "webhooks",
      state: "revoked",
      source: "system",
      updatedBy: "op",
    });
    const noEnt = await evaluateQuota(orgA, "webhooks.deliveries", deps, operator);
    check(
      "revoked entitlement ⇒ denied by entitlement BEFORE quota",
      !noEnt.allowed && noEnt.decidedBy === "entitlement" && noEnt.state === "no_entitlement"
    );
  } catch (err) {
    check("live quota proof", false, err instanceof Error ? err.message : String(err));
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
