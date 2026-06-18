/**
 * Rate limits LIVE Postgres proof (ADR-0065 / ADR-ACT-0257).
 *
 * Proves the rate-limit substrate against the local Compose Postgres:
 *  - operator sets a per-tenant policy (audited, audit-before-change);
 *  - the entitlement bridge denies BEFORE counting when the tenant is not
 *    entitled (deny-by-default; same ordering as quota);
 *  - allow below the limit, deny above it within the fixed window;
 *  - RLS isolates policies per tenant (tenant B sees zero of tenant A's);
 *  - no secret-bearing columns; list reports the live window count.
 *
 * Runs repos as platform_app (RLS enforces). Creates + cleans up its own orgs.
 * SKIPs honestly (exit 0) if Postgres is unavailable; never fake-PASSes.
 *
 * Usage: npm run proof:rate-limits   (requires `make compose-up-default`)
 */

import pg from "pg";
import { loadLocalEnv, requireEnv } from "./lib/local-env.ts";
import { withTenant } from "@platform/adapters-postgres";
import type { AuditEvent, AuditEventPort } from "@platform/audit-events";
import { PostgresRateLimitRepository } from "../src/adapters/postgres-rate-limit-repository.ts";
import { PostgresEntitlementRepository } from "../src/adapters/postgres-entitlement-repository.ts";
import { evaluateRateLimit, listRateLimits, setRateLimit } from "../src/usecases/rate-limits.ts";

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
function capturingAudit(): { port: AuditEventPort; events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  return { events, port: { emit: async (e) => void events.push(e), query: async () => events } };
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
  console.log("# Rate limits LIVE Postgres proof\n");
  if (!(await reachable(APP_URL))) {
    console.log("SKIP  rate-limits proof — Postgres not reachable (run `make compose-up-default`)");
    console.log("\n# SKIPPED (no live Postgres) — not counted as pass or fail");
    process.exit(0);
  }

  const su = new pg.Pool({ connectionString: SU_URL });
  const app = new pg.Pool({ connectionString: APP_URL });
  const rateLimits = new PostgresRateLimitRepository(app);
  const entitlements = new PostgresEntitlementRepository(app);
  const audit = capturingAudit();
  const deps = { rateLimits, entitlements, audit: audit.port };
  let orgA: string | null = null;
  let orgB: string | null = null;

  try {
    for (const t of ["rate_limit_policies", "rate_limit_counters"]) {
      const cols = await su.query<{ c: string }>(
        "SELECT column_name AS c FROM information_schema.columns WHERE table_schema='public' AND table_name=$1",
        [t]
      );
      check(`${t} has no secret-bearing columns`, !cols.rows.some((r) => SECRET_FIELD.test(r.c)));
    }

    orgA = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        ["proof-rl-a-" + Date.now().toString(36), "Proof RL A"]
      )
    ).rows[0]!.id;
    orgB = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        ["proof-rl-b-" + Date.now().toString(36), "Proof RL B"]
      )
    ).rows[0]!.id;

    await entitlements.upsert({
      organisationId: orgA,
      entitlementKey: "api_access",
      state: "granted",
      source: "system",
      updatedBy: "op",
    });

    // operator sets a policy on both A and B (limit 2 / window)
    for (const org of [orgA, orgB]) {
      await setRateLimit(
        {
          organisationId: org,
          policyKey: "api.requests",
          entitlementKey: "api_access",
          limit: 2,
          windowSeconds: 3600,
          actor: ACTOR,
        },
        deps
      );
    }
    check(
      "rate-limit set is audited (audit-before-change)",
      audit.events.some((e) => e.resource === "rate_limit")
    );

    // entitlement bridge: B is not entitled → denied before counting
    const bEval = await evaluateRateLimit(orgB, "api.requests", deps);
    check(
      "not-entitled tenant denied at the entitlement step (bridge)",
      !bEval.allowed && bEval.decidedBy === "entitlement" && bEval.used === 0
    );

    // A entitled: allow, allow, deny (limit = 2)
    const a1 = await evaluateRateLimit(orgA, "api.requests", deps);
    const a2 = await evaluateRateLimit(orgA, "api.requests", deps);
    const a3 = await evaluateRateLimit(orgA, "api.requests", deps);
    check("first request allowed (below limit)", a1.allowed && a1.used === 1);
    check("second request allowed (at limit)", a2.allowed && a2.used === 2);
    check(
      "third request denied (above limit)",
      !a3.allowed && a3.state === "exceeded" && a3.used === 3
    );

    // RLS isolation: orgB tenant context sees zero of orgA's policies (and only its own)
    const crossCount = await withTenant(app as never, orgB, async (client) => {
      const r = await client.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM public.rate_limit_policies WHERE organisation_id=$1",
        [orgA]
      );
      return Number(r.rows[0]?.n ?? "0");
    });
    check("RLS hides orgA's policies from orgB's tenant context (count = 0)", crossCount === 0);

    // list shows the policy + live window count for A
    const listed = await listRateLimits(orgA, deps, { operator: true });
    check(
      "list reports the policy with the live window count",
      listed.policies.some((p) => p.policyKey === "api.requests" && p.used >= 2)
    );
  } catch (err) {
    check("live rate-limits proof", false, err instanceof Error ? err.message : String(err));
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
